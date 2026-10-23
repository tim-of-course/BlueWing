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

`libjxl-dc.patch` separately appends a private decoder exporter to `decode.cc`.
It reads decoded DC into a small linear image using `OpsinToLinear`, converts
with the default CMS from `ColorEncoding::LinearSRGB()` to sRGB, and packs RGBA8.
The explicit linear profile matters: `output_encoding_info.linear_color_encoding`
has changed transfer-function fields but can retain a nonlinear ICC profile.
The exporter never calls `FrameDecoder::Flush` and never writes decoded DC or
the full output buffer. The build applies both patches independently and copies
the modification notice alongside upstream notices.

## Build

Install Python 3, Git, CMake, Ninja, and Bun on PATH. From the repository root:

```sh
bun scripts/heavy.ts -- python codecs/jpeg-xl/build.py
bun scripts/heavy.ts -- node codecs/jpeg-xl/smoke.mjs
bun scripts/heavy.ts -- node codecs/jpeg-xl/smoke.mjs --high-pointers
bun scripts/heavy.ts -- node codecs/jpeg-xl/smoke.mjs --large
bun scripts/heavy.ts -- node codecs/jpeg-xl/dc-smoke.mjs
bun scripts/heavy.ts -- node codecs/jpeg-xl/dc-smoke.mjs --high-pointers
bun scripts/heavy.ts -- node codecs/jpeg-xl/dc-smoke.mjs --cache <cached-jxl-file>
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
3. Status `1` means a progression event. At ratio 8, call `_bw_decoder_dc(decoder)`
   for a bounded snapshot. A nonzero pointer contains packed RGBA8 sRGB at
   `ceil(width / 8)` by `ceil(height / 8)`, valid until the next DC call or decoder
   deletion. No flush is needed for this buffer. Zero means unsupported; use
   `_bw_decoder_flush(decoder)` and read the full buffer when a snapshot is needed.
   Resume with `_bw_decoder_feed(decoder, 0, 0)`. The decoder
   retains all unconsumed bytes, including when the entire file was passed once.
4. Status `2` needs more bytes. Status `0` is the final image. Negative values
   mean failure. `_bw_decoder_flush` returns zero on success or a negative error.
5. `_bw_decoder_width/height` give normalized output dimensions.
   `_bw_decoder_pixels` points to **full-width, full-height RGBA8 sRGB** at every
   stage. Call flush before reading a progression stage; final pixels are ready
   immediately. Pixels are opaque with transparent input composited onto white.
6. `_bw_decoder_ratio` reports libjxl's intended downsampling ratio for the last
   progression event, or 1 for final output. The buffer remains full size: a ratio
   of 8 does not mean the full buffer contains a packed 1/8 image. The separate
   `_bw_decoder_dc` buffer does contain that packed image. Scale it when making a
   display bitmap. Events use `kLastPasses`; the encoder determines the available
   discrete ratios, so an arbitrary viewport ratio is not guaranteed.
7. Call `_bw_decoder_delete(decoder)` to release the decoder and its pixel buffer.

The decoder accepts a still image and rejects animations. A truncated input can
return `2`; the caller knows whether more source bytes exist and should treat
exhaustion without status `0` as incomplete input.

The DC exporter supports Bluewing's opaque, single displayed frame, XYB VarDCT
images with identity orientation, no crop, no resampling or chroma subsampling,
default opsin, and RGB sRGB output. Noise, patches, splines, extra channels,
other transforms, and other checkpoints return zero. Full output allocation is
preserved for the final image. Each export only allocates reduced-size images;
it does not make the decoder's other allocations proportional to DC dimensions.

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

The DC rebuild passed tiny 16 by 16, odd 17 by 9 and 513 by 385 fixtures, 127-byte
incremental input, repeated snapshots, opaque alpha, and pointers above 2 GiB.
An exploratory 1 by 1 encoded fixture exhausted input after ratio 4. Its baseline
behavior was not investigated; these checks do not establish that edge case.
The 513 by 385 image produced 65 by 49 DC pixels (12,740 bytes). Interior sampled
DC patches exactly matched RGB `(245,247,250)`, `(20,35,55)`, `(210,45,35)`,
`(25,175,60)`, `(35,65,210)`, and `(128,128,128)`, including paper brightness.
Every final byte matched decoding without a DC export, flushing every checkpoint,
and the original pre-DC WASM assets. To repeat the original-asset comparison,
save the old JS as `tmp/jxl/baseline-jxl.mjs` and WASM as
`tmp/jxl/baseline-jxl.wasm` before rebuilding, then add `--baseline` to DC smoke.

The existing cached 7200 by 9600 page decoded to 900 by 1200 DC pixels
(4,320,000 bytes), without re-encoding. Whole-file and 64 KiB incremental DC
hashes matched. Its final RGBA SHA-256 was
`4b7480a2910cd480c29ca8c4b64ca11945ea806cb928f0ba89cf678447852972`
in all four paths above. First-feed plus direct-DC times were 160 + 35 ms and
143 + 32 ms (195 and 176 ms to the first snapshot). Final decode with DC export
and skipped later flushes took 1,509 and 1,546 ms. Full-size flush comparison
varied: first flush 1,293 and 2,736 ms; all-stage decode 4,659 and 11,905 ms.
These are local Node timings, excluding module startup, image upload and display;
they establish bounded export cost, not native-viewer latency. Raw local reports
are `tmp/jxl/dc-small.log`, `dc-high-pointers.log`, and `dc-large.log`.

The final generated artifacts have these SHA-256 hashes (file content bytes):

```text
bluewing-jxl.js    3e0ed1b652b6efc56af4986b10a9d0eb6dcd21fbe3bf7cfa9c81721e18a581df
bluewing-jxl.wasm  2aa0bb977bb394b6c1712b98d7e8dfa1b1f915f6a724e0cc617ed490cfa476ad
facade.cc         44fda85e24d3ad917a2d677ae02c0433fc8aec2be4297f31c6998a3fb2857ec9
libjxl-dc.patch   e83cbb90d1af5b08d70ecb4fc58be6319db9df13bc6d21eaf7ab01b72b4935d7
libjxl-memory.patch d0f84e4cdf3be6d1faed9b4d829bd390d3182b68d27ac145f4ccf08a0b245c5d
```

The implementation follows libjxl's public APIs and its
[WASM decoder example](https://github.com/libjxl/libjxl/blob/v0.12.0/tools/wasm_demo/jxl_decoder.cc).
See upstream's [WASM build notes](https://github.com/libjxl/libjxl/blob/v0.12.0/doc/building_wasm.md).
