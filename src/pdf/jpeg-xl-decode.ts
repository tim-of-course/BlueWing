import { jpegXlModule } from './jpeg-xl';
import type { RasterStage } from './raster';

/** Decode one codestream, publishing at most two smaller, transient bitmaps. */
export async function decodeJpegXl(
  bytes: Uint8Array,
  active: () => boolean,
  progress?: (bitmap: ImageBitmap, stage: RasterStage) => void,
  screenDimension?: number,
): Promise<ImageBitmap> {
  const module = await jpegXlModule();
  const decoder = module._bw_decoder_new();
  if (!decoder) throw new Error('JPEG XL decoder allocation failed');
  const chunkSize = 256 * 1024;
  const input = module._malloc(Math.min(chunkSize, bytes.length));
  let offset = 0;
  let status = 2;
  let coarse = false;
  let screen = false;
  async function snapshot(dimension?: number, dcPixels = 0) {
    const ratio = dcPixels ? 8 : 1;
    const width = Math.ceil(module._bw_decoder_width(decoder) / ratio);
    const height = Math.ceil(module._bw_decoder_height(decoder) / ratio);
    const pointer = dcPixels || module._bw_decoder_pixels(decoder);
    if (!pointer || !width || !height)
      throw new Error('JPEG XL pixels are unavailable');
    const pixels = new ImageData(
      new Uint8ClampedArray(
        module.HEAPU8.buffer as ArrayBuffer,
        pointer,
        width * height * 4,
      ),
      width,
      height,
    );
    const scale = dimension
      ? Math.min(1, dimension / Math.max(width, height))
      : 1;
    return createImageBitmap(pixels, {
      resizeWidth: Math.max(1, Math.ceil(width * scale)),
      resizeHeight: Math.max(1, Math.ceil(height * scale)),
      resizeQuality: 'high',
    });
  }
  try {
    if (!input) throw new Error('JPEG XL input allocation failed');
    while (active()) {
      let length = 0;
      if (status === 2) {
        length = Math.min(chunkSize, bytes.length - offset);
        if (!length) throw new Error('JPEG XL image is incomplete');
        module.HEAPU8.set(bytes.subarray(offset, offset + length), input);
        offset += length;
      }
      status = module._bw_decoder_feed(decoder, length ? input : 0, length);
      if (status === 0) return await snapshot();
      if (status !== 1 && status !== 2)
        throw new Error('JPEG XL decoding failed');
      if (status === 1 && progress && screenDimension && !screen) {
        const available =
          Math.max(
            module._bw_decoder_width(decoder),
            module._bw_decoder_height(decoder),
          ) / Math.max(1, module._bw_decoder_ratio(decoder));
        if (!coarse || available >= screenDimension) {
          // The first pass already contains a small XYB image. Convert it
          // directly instead of expanding it to the full 200 DPI master.
          const dcPixels =
            module._bw_decoder_ratio(decoder) === 8
              ? module._bw_decoder_dc(decoder)
              : 0;
          if (!dcPixels && module._bw_decoder_flush(decoder) !== 0)
            throw new Error('JPEG XL progressive flush failed');
          const publish = async (dimension: number, stage: RasterStage) => {
            const bitmap = await snapshot(dimension, dcPixels);
            if (active()) progress(bitmap, stage);
            else bitmap.close();
          };
          if (!coarse) {
            await publish(Math.min(screenDimension / 2, available), 'coarse');
            coarse = true;
          }
          // A coarse encoded pass can already contain enough samples for the
          // whole screen. Do not wait for or flush a needlessly finer pass.
          if (active() && available >= screenDimension) {
            await publish(screenDimension, 'screen');
            screen = true;
          }
        }
      }
      // Cancellation reaches the worker between passes, without moving codec work to the UI.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('JPEG XL decoding was cancelled');
  } finally {
    if (input) module._free(input);
    module._bw_decoder_delete(decoder);
  }
}
