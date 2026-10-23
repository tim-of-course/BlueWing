# Bluewing JPEG XL facade

The checked-in `assets/jpeg-xl/bluewing-jxl.js` and `.wasm` use libjxl **0.12.0**
(`a7a9c787341cf703dede03c2009fa460cae5e5df`) and Emscripten **4.0.23**
(SDK `aaa43392544d695232b70eda706d751f18980c2a`). The SDK manifest is pinned by
emsdk commit `d7b4130688bfa348392b921ab04015aa15c4f154`. libjxl's submodule
commits pin Brotli, Highway, and skcms. Their notices ship beside the artifacts.

`libjxl-memory.patch` changes buffer lifetimes in the pinned libjxl source: skip
the unused pre-filter float image on the fast heuristic path, shrink completed
group token vectors, and release float images/coefficient storage after their
last use. Encoding still uses the same quality and progression algorithms. The
output callbacks avoid libjxl's additional whole-frame RGB input copy.

## Build

Install Python 3, Git, CMake, Ninja, and Bun on PATH. From the repository root:

```sh
bun scripts/heavy.ts -- python codecs/jpeg-xl/build.py
bun scripts/heavy.ts -- node codecs/jpeg-xl/smoke.mjs
bun scripts/heavy.ts -- node codecs/jpeg-xl/smoke.mjs --high-pointers
bun scripts/heavy.ts -- node codecs/jpeg-xl/smoke.mjs --large
```

The build script downloads its sources and SDK into ignored `tmp/jxl-codec-build`,
builds with two compiler jobs, then copies the assets and license notices.
Keep the resource guard enabled and coordinate the slot with other heavy jobs.
The large smoke fixture is 9600 by 7200 pixels (69.12 MP); it reports encoding and
decoding time, allocated WASM heap bytes, and process RSS. It is synthetic line
art, not a performance claim for every architectural sheet.

This is a single-thread SIMD wasm32 build. Memory grows from 32 MiB up to 4 GiB;
the actual allocation limit also depends on the browser/device. It needs neither
SharedArrayBuffer nor cross-origin isolation. It has no filesystem or embind.

## API

Import the default async `createJxlModule` factory from `bluewing-jxl.js`.
Pass `{ wasmBinary }` to load bundled bytes, or use the adjacent default `.wasm`
URL. The adjacent declaration file describes the numeric C exports and `HEAPU8`.
Re-read `module.HEAPU8` after every codec call or allocation because memory growth
replaces the view. All pointers and sizes are JavaScript numbers.

Encoding:

1. Allocate `width * height * 4` bytes with `_malloc` and copy straight RGBA8 sRGB.
2. Call `_bw_encode(pointer, width, height, 80)`. Zero means failure.
3. Copy `_bw_encoded_size(result)` bytes at `_bw_encoded_data(result)`.
4. Release the result with `_bw_encoded_free(result)` and the input with `_free`.

The caller owns the input until encoding returns. RGB rectangles are converted
on request through libjxl's chunked input API, compositing alpha onto white.
There is one lossy codestream, no embedded preview, and no geometry metadata.
The quality maps through `JxlEncoderDistanceFromQuality`; effort is 3, decode speed
is 2, spectral progressive AC is enabled, progressive DC is 1, resampling is 1,
input buffering is 2, and output mode is 0 (progressive codestream order).

Decoding:

1. Create `_bw_decoder_new()`; zero means failure.
2. Call `_bw_decoder_feed(decoder, inputPointer, byteLength)`. Input bytes are
   copied, so the caller may release/reuse them after the call.
3. Status `1` means a progression event. Call `_bw_decoder_flush(decoder)` and
   read pixels, then resume with `_bw_decoder_feed(decoder, 0, 0)`. The decoder
   retains all unconsumed bytes, including when the entire file was passed once.
4. Status `2` needs more bytes. Status `0` is the final image. Negative values
   mean failure. `_bw_decoder_flush` returns zero on success or a negative error.
5. `_bw_decoder_width/height` give normalized output dimensions.
   `_bw_decoder_pixels` points to **full-width, full-height RGBA8 sRGB** at every
   stage. Call flush before reading a progression stage; final pixels are ready
   immediately. Pixels are opaque with transparent input composited onto white.
6. `_bw_decoder_ratio` reports libjxl's intended downsampling ratio for the last
   progression event, or 1 for final output. The buffer remains full size: a ratio
   of 8 does not mean it contains a packed 1/8 image. Scale it when making a
   display bitmap. Events use `kLastPasses`; the encoder determines the available
   discrete ratios, so an arbitrary viewport ratio is not guaranteed.
7. Call `_bw_decoder_delete(decoder)` to release the decoder and its pixel buffer.

The decoder accepts a still image and rejects animations. A truncated input can
return `2`; the caller knows whether more source bytes exist and should treat
exhaustion without status `0` as incomplete input.

## Local validation, October 23, 2026

Node 22.22.3 on Windows passed whole-file and 127-byte incremental decoding of
the 512 by 384 fixture, including identical progression pixels, opaque alpha,
line/background color checks, invalid input, and result lifetime cleanup. The
fixture encoded to 7,413 bytes. Allocating a 2.2 GB barrier also passed the same
round trip with encoder/result/data/decoder/pixel pointers above 2 GiB; pointer
exports normalize wasm32's signed i32 return values to unsigned JavaScript
numbers. The small fixture's encoded size and all sampled stage pixels matched
the original unpatched libjxl run after the memory patch.

The 9600 by 7200 fixture passed twice with quality 80, effort 3, progressive AC 1,
and progressive DC 1. It encoded to 2,220,760 bytes in 2.65–2.68 seconds. Decoding
took 10.52–14.49 seconds, including flushing all four stages to full-size RGBA.
On the final run, flushed stage times from decoder start were: ratio 8 at 2.968
seconds, ratio 4 at 5.966 seconds, ratio 2 at 10.965 seconds, final at 14.459
seconds. These times include the smoke harness's sampled alpha/color checks
between stages. The allocated WASM heap reached 4,046,585,856 bytes (3.77 GiB);
process RSS after decoding was 3.02–3.82 GB. Heap size is allocated high-water
capacity, not current live codec allocation. Encoding and decoding shared the
same module for this check. This does not establish browser timing or support
for the product's 100 MP maximum. Headroom remains narrow and complex images may
still exceed the wasm32 limit. No DPI reduction or quality fallback is applied.

The final generated artifacts have these SHA-256 hashes:

```text
bluewing-jxl.js    6b007f4bb782e4903ce3de49a3bf938026bc0df8f19475a3269726978ca4b73c
bluewing-jxl.wasm  3211c93661b1f6a5b83f4a44493c669b8e543d1f1896b770ae16dcace2f495f4
facade.cc         4aa044deeba94db1a9799e44e7c91e84e4909dc7dd6a051f7d98bd67098f19a3
libjxl-memory.patch d0f84e4cdf3be6d1faed9b4d829bd390d3182b68d27ac145f4ccf08a0b245c5d
```

The implementation follows libjxl's public APIs and its
[WASM decoder example](https://github.com/libjxl/libjxl/blob/v0.12.0/tools/wasm_demo/jxl_decoder.cc).
See upstream's [WASM build notes](https://github.com/libjxl/libjxl/blob/v0.12.0/doc/building_wasm.md).
