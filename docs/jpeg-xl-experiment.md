# Progressive JPEG XL experiment

Branch `experiment/jpeg-xl-progressive` starts at the verified PNG/preview checkpoint `11c268c`. It is an experiment, not a merge decision.

The progressive path works without OS JPEG XL support. The initial implementation at `881fc54` loaded slowly because it reconstructed full-resolution pixels for the first coarse image. The follow-up keeps the same WASM codec and removes that work before considering a native codec. Keep this branch unmerged pending visual acceptance and the measurements below.

The app prepares one 200 DPI JPEG XL master at quality 80 (libjxl distance 1.9). The drawing canvas no longer requests a preview image while that master loads. Its decoder publishes a coarse image targeting half the displayed page's device-pixel dimensions, then an image targeting the displayed page's dimensions, then the full master. Geometry and camera stay in page coordinates throughout. The loading indicator remains until the master finishes. Sidebar thumbnails remain independent PNGs.

The intermediate images come from the same codestream, are held only for display, and never enter the page cache. The encoded file supplies discrete passes, typically intended ratios 8, 4, 2 and 1; arbitrary exact viewport checkpoints are not available. The viewer chooses useful passes and sizes their display bitmaps to the current camera and device pixel ratio. It can skip an intermediate stage if the stream cannot supply it before completion. Changing camera or window size during a load does not restart decoding; the full master still follows.

This affects reopening prepared images. A never-prepared page must first rasterize its PDF. Its original raster displays before compression, then JPEG XL bytes are saved in the background. Initial raw display and later lossy cache display can differ. Background disk preparation continues, with no speculative full-page RAM loading. Existing PNG caches use different keys and remain available when returning to the checkpoint branch.

## Implementation and tradeoffs

libjxl 0.12.0 is bundled as a single-thread SIMD WASM codec with source, build instructions and notices under [codecs/jpeg-xl](../codecs/jpeg-xl/README.md). Each encode runs in a disposable worker so its large WASM heap is released afterward. The app creates this worker alongside the PDF worker: nested module workers failed on the Tauri resource origin even though they worked in development browsers. Pixel buffers transfer through the app coordinator without UI pixel reading or copying. A cache decoder worker processes a single image at a time, yields between input chunks/passes for cancellation, and retires when its queue drains to release its WASM heap. No codec work runs on the UI thread. Existing native bridge 9 stores arbitrary encoded bytes; no native codec dependency or bridge change is required. Complete web releases include the codec and its licenses.

The cache still reads the complete compressed file before decoding. Progressive output starts before full decoding, rather than before completion of disk transfer. At the first 8x checkpoint, a bounded decoder patch converts the existing low-resolution DC image directly into sRGB pixels. A 7,200 by 9,600 sheet supplies a 900 by 1,200 RGBA image (4.32 MB) without reconstructing the full sheet first. JavaScript creates its early bitmaps from that small buffer. When those samples already meet screen resolution, both coarse and screen bitmaps come from that checkpoint, and later intermediate passes need no full-size flush.

The fast exporter supports Bluewing's opaque, single-frame XYB encoding with the expected color transform and no unsupported image features; other cases retain the normal flush path. A zoomed view that needs a finer checkpoint still uses full-resolution reconstruction for that intermediate image. The decoder continues through the same codestream, and final pixels remain unchanged. It still reserves the full-size final output buffer, so this is a rendering-cost improvement rather than removal of all full-size memory. JPEG XL does not reduce the final RGBA bitmap's memory use or PDF rasterization time. Worker buffers and codec heaps are additional to the 512 MiB decoded-page cache.

The encoder's unmodified upstream allocation pattern exceeded the wasm32 4 GiB heap on a 69.12 MP sheet. A pinned source patch releases unused or finished encoder buffers without changing the coding settings. Synthetic 9,600 × 7,200 quality-80 tests produced 2,220,760 bytes, taking approximately 2.65–2.68 seconds to encode and 10.5–14.5 seconds to decode all progressive passes in Node. On the final run, the flushed coarse pass arrived at 2.97 seconds, the next passes at 5.97 and 10.97 seconds, and final output at 14.46 seconds. The encode heap approached 3.77 GiB. These results establish feasibility for that fixture, not fast interaction or support for every image up to the app's 100 MP limit. Browser/native measurements and visual review decide whether to keep the experiment.

On this machine, an actual Edge 155 `ImageDecoder.isTypeSupported('image/jxl')` probe returned false. Installed Playwright Chromium 153 and Firefox 155 also returned false. Browser version or general Chrome support is therefore insufficient to choose native image decoding here.

## Initial desktop measurements at 881fc54

At that checkpoint, the native preparation run completed all seven large fixture pages with zero failures, no worker errors and a 17.1 ms worst frame gap while pointer input continued. Reopening used the saved JPEG XL master without rerendering the PDF. The first painted image came from actual progressive pixels.

Two native reopen measurements at that checkpoint differed substantially:

| Run             | First progressive display | Screen pass ready | Full display |
| --------------- | ------------------------: | ----------------: | -----------: |
| Earlier         |                    3.82 s |            7.29 s |      10.51 s |
| Final validated |                    1.29 s |            2.28 s |       3.55 s |

Times begin at the image request; display spans end at draw submission, not physical monitor presentation. These are individual runs, not a controlled performance distribution, and the cause of the variation is unresolved. The same fixture on the PNG checkpoint reached full display in 1.08 s. JPEG XL masters were approximately 2.5 MB versus 10.3 MB for PNG, about 75% less disk space. At that checkpoint, compression reduced disk size but made page switching slower. Artifacts are under ignored `tmp/preparation/jpeg-xl-validated`, `jpeg-xl-final` and `preview-final` directories.

The user permits a Rust implementation but prioritizes fixing unnecessary full-size progressive work first. A native codec would be bundled with Bluewing, either compiled into its Rust backend or shipped as a library beside it. It is not an OS service and requires no separate user-installed codec. We would build and package it for each supported OS/CPU; codec changes would then require a native application update rather than only a web update. That remains an optional later experiment. Complex scans, the 100 MP limit and manual visual acceptance remain unverified.

## Reduced-resolution follow-up

Profiling the same cached 69 MP image separated checkpoint decoding from full-size reconstruction. The first checkpoint required about 130 ms of decoding, while its full-size flush added 1,206 ms. The fix exports its existing 900 by 1,200 DC image directly and avoids waiting for a finer pass when those pixels already meet screen sampling. Codec checks measured 176–195 ms to the first small image, including 32–35 ms for export/color conversion. Final output bytes exactly matched the old WASM decoder, no-export continuation and flush-all continuation.

The actual Tauri/WebView2 scenario then prepared all seven pages with zero failures, no worker errors and a 33.6 ms worst frame gap during 1,020 pointer movements. It closed and reopened the project three times, clearing decoded page and worker state each time and reusing the saved master without PDF rendering:

| Reopen | First progressive display | Screen pass ready | Full display |
| ------ | ------------------------: | ----------------: | -----------: |
| 1      |                   0.447 s |           0.453 s |      3.798 s |
| 2      |                   0.378 s |           0.385 s |      3.671 s |
| 3      |                   0.378 s |           0.383 s |      4.136 s |

This fixes the slow first image on the measured fixture. Full-resolution completion remains slower than PNG, and the final output buffer, encoder settings and cache format remain unchanged. It does not establish the same timing for every PDF, zoom level or machine. Raw reports are in ignored `tmp/preparation/jpeg-xl-dc/reopened.json`, `reopened-2.json`, `reopened-3.json` and `summary.json`; console output is in `tmp/jxl/dc-native.log`.

## Verification

At `881fc54`, `bun run verify` passed: typecheck, lint, formatting, 9 tooling tests (2 existing platform skips), 238 core tests (1 existing POSIX-only skip), 13 platform tests, all 204 development browser tests, the production build and all 32 production browser tests. Browser suites ran in Chromium and Firefox with one worker through the resource guard. The real JPEG XL test checks encoded cache bytes, changing coarse/screen pixels, final dimensions and image fidelity; UI tests cover pending feedback, camera stability and rapid navigation. That full run is recorded in ignored `tmp/jxl/verify-final.log`.

`BLUEWING_PROFILE_LABEL=jpeg-xl-validated bun run test:desktop:performance` also passed in the actual Tauri WebView2 runtime. It prepared all seven pages, kept pointer movement responsive, asserted a real progressive first display and reused the saved master without PDF rerasterization. The codec smoke separately verifies whole/chunked input equivalence, opaque linework, final dimensions and unsigned pointers above 2 GiB. Native Rust code was unchanged; Rust unit tests were not rerun for this web implementation.

For the reduced-resolution follow-up, 14 focused Chromium/Firefox cases passed, including a real-codec assertion that fit-screen coarse and screen images require zero full-size flushes. Static checks, 9 tooling tests (2 existing skips), 238 core tests (1 existing skip) and 13 platform tests passed again. The full development run passed 203 of 204 cases; the remaining Firefox quantities-editing case reported one `HOT_SCOPE_TIME` warning of 9 ms against its unchanged 8 ms budget. Its visible editing assertions passed, and three focused reruns passed with no diagnostics. No quantities code, test assertions or budgets were changed. Consequently, that `bun run verify` command exited unsuccessfully; the build/production checks were run separately afterward. Logs: `tmp/jxl/dc-browser.log`, `dc-verify.log` and `dc-quantities-rerun.log`; the original failing diagnostic and trace were preserved under `tmp/jxl/dc-quantities-warning`.

The follow-up production build and all 32 production browser cases passed (`tmp/jxl/dc-build-final.log`, `dc-production.log`). The actual native scenario also passed, including all three progressive reopens described above. No Rust implementation was introduced, no full-page RAM preloading was added, and no merge was performed.

For user trials, compare **page.firstDisplay** (first submitted image, possibly progressive), **page.display** (full-resolution draw submission), **page.progress**, and **page.progress.display**. These measure application work and draw submission, not physical monitor presentation. Save recordings and inspect tiny text, thin lines, grayscale scans and colored annotations before choosing a quality setting or merging.
