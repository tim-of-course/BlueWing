#include <jxl/color_encoding.h>
#include <jxl/decode.h>
#include <jxl/encode.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <new>
#include <vector>

extern "C" int BluewingDecoderDC(JxlDecoder*, uint8_t*, size_t);

namespace {
struct Encoded { std::vector<uint8_t> bytes; size_t written = 0; };
struct Source { const uint8_t* rgba; uint32_t width; };
struct Decoder {
  JxlDecoder* codec = JxlDecoderCreate(nullptr);
  std::vector<uint8_t> tail;
  std::vector<uint8_t> pixels;
  std::vector<uint8_t> dc_pixels;
  uint32_t width = 0, height = 0;
  size_t ratio = 0;
  bool final = false;
  bool has_alpha = false;
  ~Decoder() { JxlDecoderDestroy(codec); }
};
constexpr JxlPixelFormat rgba_format{4, JXL_TYPE_UINT8, JXL_NATIVE_ENDIAN, 0};

void InputFormat(void*, JxlPixelFormat* format) {
  *format = {3, JXL_TYPE_UINT8, JXL_NATIVE_ENDIAN, 0};
}
const void* InputPixels(void* opaque, size_t x, size_t y, size_t width,
                        size_t height, size_t* stride) {
  const auto& source = *static_cast<Source*>(opaque);
  auto* rgb = static_cast<uint8_t*>(std::malloc(width * height * 3));
  if (!rgb) return nullptr;
  *stride = width * 3;
  for (size_t row = 0; row < height; ++row) {
    const uint8_t* in = source.rgba + ((y + row) * source.width + x) * 4;
    uint8_t* out = rgb + row * *stride;
    for (size_t col = 0; col < width; ++col, in += 4, out += 3) {
      for (size_t c = 0; c < 3; ++c) {
        out[c] = (in[c] * in[3] + 255 * (255 - in[3]) + 127) / 255;
      }
    }
  }
  return rgb;
}
void ReleasePixels(void*, const void* buffer) { std::free(const_cast<void*>(buffer)); }
void* OutputBuffer(void* opaque, size_t* size) {
  auto* result = static_cast<Encoded*>(opaque);
  *size = std::max(*size, size_t{65536});
  result->bytes.resize(result->written + *size);
  return result->bytes.data() + result->written;
}
void ReleaseOutput(void* opaque, size_t written) { static_cast<Encoded*>(opaque)->written += written; }
void FinalizeOutput(void*, uint64_t) {}
void MakeOpaque(Decoder* dec) {
  if (!dec->has_alpha) return;
  for (size_t i = 3; i < dec->pixels.size(); i += 4) {
    const unsigned alpha = dec->pixels[i];
    if (alpha != 255) {
      for (size_t c = i - 3; c < i; ++c) {
        dec->pixels[c] = (dec->pixels[c] * alpha + 255 * (255 - alpha) + 127) / 255;
      }
      dec->pixels[i] = 255;
    }
  }
}
}  // namespace

extern "C" {
Encoded* bw_encode(const uint8_t* rgba, uint32_t width, uint32_t height, float quality) {
  if (!rgba || !width || !height || !std::isfinite(quality) || quality < 0 || quality > 100 ||
      uint64_t(width) * height > std::numeric_limits<size_t>::max() / 4) return nullptr;
  std::unique_ptr<JxlEncoder, decltype(&JxlEncoderDestroy)> enc(JxlEncoderCreate(nullptr), JxlEncoderDestroy);
  if (!enc) return nullptr;
  JxlBasicInfo info;
  JxlEncoderInitBasicInfo(&info);
  info.xsize = width;
  info.ysize = height;
  info.bits_per_sample = 8;
  info.num_color_channels = 3;
  info.uses_original_profile = JXL_FALSE;
  JxlColorEncoding color;
  JxlColorEncodingSetToSRGB(&color, JXL_FALSE);
  if (JxlEncoderSetBasicInfo(enc.get(), &info) != JXL_ENC_SUCCESS ||
      JxlEncoderSetColorEncoding(enc.get(), &color) != JXL_ENC_SUCCESS) return nullptr;
  JxlEncoderFrameSettings* settings = JxlEncoderFrameSettingsCreate(enc.get(), nullptr);
  if (!settings || JxlEncoderSetFrameDistance(settings, JxlEncoderDistanceFromQuality(quality)) != JXL_ENC_SUCCESS)
    return nullptr;
  const struct { JxlEncoderFrameSettingId id; int value; } options[] = {
    {JXL_ENC_FRAME_SETTING_EFFORT, 3}, {JXL_ENC_FRAME_SETTING_DECODING_SPEED, 2},
    {JXL_ENC_FRAME_SETTING_PROGRESSIVE_AC, 1}, {JXL_ENC_FRAME_SETTING_PROGRESSIVE_DC, 1},
    {JXL_ENC_FRAME_SETTING_RESAMPLING, 1}, {JXL_ENC_FRAME_SETTING_BUFFERING, 2},
    {JXL_ENC_FRAME_SETTING_OUTPUT_MODE, 0},
  };
  for (const auto& option : options) {
    if (JxlEncoderFrameSettingsSetOption(settings, option.id, option.value) != JXL_ENC_SUCCESS) return nullptr;
  }
  Source source{rgba, width};
  JxlChunkedFrameInputSource input{};
  input.opaque = &source;
  input.get_color_channels_pixel_format = InputFormat;
  input.get_color_channel_data_at = InputPixels;
  input.release_buffer = ReleasePixels;
  auto result = std::make_unique<Encoded>();
  JxlEncoderOutputProcessor output{result.get(), OutputBuffer, ReleaseOutput, nullptr, FinalizeOutput};
  if (JxlEncoderSetOutputProcessor(enc.get(), output) != JXL_ENC_SUCCESS) return nullptr;
  if (JxlEncoderAddChunkedFrame(settings, JXL_TRUE, input) != JXL_ENC_SUCCESS) {
    std::fprintf(stderr, "JPEG XL input failed: %d\n", int(JxlEncoderGetError(enc.get())));
    return nullptr;
  }
  JxlEncoderCloseInput(enc.get());
  if (JxlEncoderFlushInput(enc.get()) != JXL_ENC_SUCCESS) {
    std::fprintf(stderr, "JPEG XL encoding failed: %d\n", int(JxlEncoderGetError(enc.get())));
    return nullptr;
  }
  result->bytes.resize(result->written);
  return result.release();
}
const uint8_t* bw_encoded_data(const Encoded* result) { return result ? result->bytes.data() : nullptr; }
size_t bw_encoded_size(const Encoded* result) { return result ? result->bytes.size() : 0; }
void bw_encoded_free(Encoded* result) { delete result; }

Decoder* bw_decoder_new() {
  auto dec = std::make_unique<Decoder>();
  if (!dec->codec ||
      JxlDecoderSubscribeEvents(dec->codec, JXL_DEC_BASIC_INFO | JXL_DEC_COLOR_ENCODING |
          JXL_DEC_FULL_IMAGE | JXL_DEC_FRAME_PROGRESSION) != JXL_DEC_SUCCESS ||
      JxlDecoderSetProgressiveDetail(dec->codec, kLastPasses) != JXL_DEC_SUCCESS ||
      JxlDecoderSetUnpremultiplyAlpha(dec->codec, JXL_TRUE) != JXL_DEC_SUCCESS) return nullptr;
  return dec.release();
}
void bw_decoder_delete(Decoder* dec) { delete dec; }
int bw_decoder_feed(Decoder* dec, const uint8_t* input, size_t length) {
  if (!dec || (!input && length)) return -1;
  if (dec->final) return 0;
  if (length) dec->tail.insert(dec->tail.end(), input, input + length);
  if (JxlDecoderSetInput(dec->codec, dec->tail.data(), dec->tail.size()) != JXL_DEC_SUCCESS) return -2;
  auto finish = [&](int result) {
    const size_t remaining = JxlDecoderReleaseInput(dec->codec);
    if (remaining) std::memmove(dec->tail.data(), dec->tail.data() + dec->tail.size() - remaining, remaining);
    dec->tail.resize(remaining);
    return result;
  };
  for (;;) {
    const auto status = JxlDecoderProcessInput(dec->codec);
    switch (status) {
      case JXL_DEC_BASIC_INFO: {
        JxlBasicInfo info;
        if (JxlDecoderGetBasicInfo(dec->codec, &info) != JXL_DEC_SUCCESS || info.have_animation) return finish(-3);
        dec->width = info.xsize;
        dec->height = info.ysize;
        dec->has_alpha = info.alpha_bits != 0;
        size_t size;
        if (JxlDecoderImageOutBufferSize(dec->codec, &rgba_format, &size) != JXL_DEC_SUCCESS) return finish(-4);
        dec->pixels.resize(size);
        break;
      }
      case JXL_DEC_COLOR_ENCODING: {
        JxlColorEncoding color;
        JxlColorEncodingSetToSRGB(&color, JXL_FALSE);
        if (JxlDecoderSetPreferredColorProfile(dec->codec, &color) != JXL_DEC_SUCCESS) return finish(-5);
        break;
      }
      case JXL_DEC_NEED_IMAGE_OUT_BUFFER:
        if (JxlDecoderSetImageOutBuffer(dec->codec, &rgba_format, dec->pixels.data(), dec->pixels.size()) != JXL_DEC_SUCCESS)
          return finish(-6);
        break;
      case JXL_DEC_FRAME_PROGRESSION:
        dec->ratio = JxlDecoderGetIntendedDownsamplingRatio(dec->codec);
        return finish(1);
      case JXL_DEC_FULL_IMAGE:
        dec->ratio = 1;
        dec->final = true;
        MakeOpaque(dec);
        return finish(0);
      case JXL_DEC_NEED_MORE_INPUT: return finish(2);
      case JXL_DEC_SUCCESS: return finish(dec->final ? 0 : -7);
      default: return finish(-8);
    }
  }
}
int bw_decoder_flush(Decoder* dec) {
  if (!dec || dec->pixels.empty()) return -1;
  if (!dec->final && JxlDecoderFlushImage(dec->codec) != JXL_DEC_SUCCESS) return -2;
  MakeOpaque(dec);
  return 0;
}
uint32_t bw_decoder_width(const Decoder* dec) { return dec ? dec->width : 0; }
uint8_t* bw_decoder_dc(Decoder* dec) {
  if (!dec || dec->final || dec->ratio != 8) return nullptr;
  dec->dc_pixels.resize(size_t((dec->width + 7) / 8) * ((dec->height + 7) / 8) * 4);
  return BluewingDecoderDC(dec->codec, dec->dc_pixels.data(), dec->dc_pixels.size())
      ? dec->dc_pixels.data() : nullptr;
}
uint32_t bw_decoder_height(const Decoder* dec) { return dec ? dec->height : 0; }
uint8_t* bw_decoder_pixels(Decoder* dec) { return dec && !dec->pixels.empty() ? dec->pixels.data() : nullptr; }
size_t bw_decoder_ratio(const Decoder* dec) { return dec ? dec->ratio : 0; }
}
