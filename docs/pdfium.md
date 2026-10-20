# PDFium backend

October 20, 2026. Bluewing uses PDFium WebAssembly in the real application. The isolated renderer sample remains separate tooling.

`@embedpdf/engine-runtime` and `@embedpdf/engine-runtime-wasm32` are pinned to `3.0.0-next.15`. This is a prerelease. Its extensions expose `/UserUnit`, progressive page parsing, progressive matrix rendering and widget appearances; the stable wrapper lacks some of these seams. The runtime is based on [PDFium fork commit ed2f716e](https://github.com/embedpdf/runtime/tree/ed2f716e5381e34f096cc1e50e4259a55998d391). Application and engine updates remain web-delivered. This integration requires a native rebuild for bridge 8's saved-asset snapshots; the takeoff format is unchanged.

## Rendering and coordinates

Each document owns one worker. PDFium parses page content and draws RGBA pixels there; an OffscreenCanvas supplies transferable display bitmaps and subsequent PNG encoding. Selected pixels arrive before encoding completes. Background jobs yield between parsing/drawing slices and can be paused, cancelled or preempted by foreground jobs. The 12 ms budget is cooperative: a single expensive native operation can exceed it.

Import reads page dictionaries without parsing all page content. Sheets retain physical points at 72/inch, a top-left origin, positive Y downward and the original-PDF-to-sheet transform. MediaBox/CropBox intersection, inherited rotation and `/UserUnit` determine dimensions and transforms. Rendering normalizes PDFium's intrinsic rotation, then applies the sheet rotation, physical scale and exact region translation. Existing saved sheet geometry stays aligned.

Successful imports retain the parsed worker instead of reopening the same PDF for viewing. Import finishes its original snapshot reads before saving. Future missing ranges switch lazily to the identical saved asset; sheets become visible only after the atomic save, and the original import snapshot then closes. Failed imports or saves still release the worker.

The main viewer keeps one cached 200 DPI master at all zoom levels, with grayscale text antialiasing and high-quality display smoothing. Sidebar previews derive from that master. An engine-specific cache key regenerates old PDF.js pixels without migrating projects. PNG encoding, memory leases, disk caching, preparation and Wingman region reuse retain their existing contracts.

Ordinary display annotations and widget appearances are enabled. LCD text and printing flags are disabled. Page labels and positioned embedded text support existing import names and auto-name review. Scanned or outlined text still requires manual names.

## Sources and memory

Native PDFs use the asynchronous asset bridge with 256 KiB cached chunks and adjacent transfers up to 1 MiB. Opening a saved SQLite asset streams its BLOB once into an immutable temporary file. Subsequent range reads use that file, avoiding repeated traversal of SQLite overflow pages. The snapshot closes with its PDF worker or project; it adds temporary disk use equal to the source size while open. PDFium's synchronous file callback serves cached chunks; its availability API requests missing ranges before loading documents or pages. Some document-level dependencies, including hidden-layer settings, fall outside those hints. Native operations track missing reads and discard/retry incomplete output after fetching them, even if PDFium reports success. Held reads can be interrupted by foreground scheduling without abandoning data needed by another job. Failed reads discard the document worker so retry opens a fresh source.

Fetched chunks remain resident for that document. Availability recovery can request the entire PDF, so selective reads are an optimization, not a memory bound. Browser imports still load source bytes in full. Two idle workers remain cached; active workers, page bitmaps, the WASM heap and browser/GPU copies are outside the page-image cache budget. A document's worker termination releases its engine and source memory.

Vite emits the WASM binary as a versioned local asset. Complete web-release manifests include it and runtime notices, including the CloudPDF NOTICE and pinned third-party license texts. No CDN is used at runtime. PDF.js is a development dependency for the independent reference renderer and comparison sample; its assets are excluded from production builds.

## Known rendering differences

The synthetic fixture suite exposes these PDFium differences from PDF.js:

- A transfer function applies to solid colors, images and tiling patterns, but PDFium leaves the shading gradient in the transfer fixture uninverted. This can change colors in PDFs using transfer-filtered shading.
- A cropped isolated knockout transparency group can composite differently from the independent reference and the full-page render. Ordinary alpha/luminosity masks and display annotations pass their color probes. Prepared full-image crops continue to reuse the same source pixels.
- Font antialiasing differs. Tests bound the pixel difference, verify actual ink coverage, and keep neutral grayscale text and colored-markup checks.

These are recorded engine limits, not claims of exact cross-engine parity. PNG round trips and transient-versus-cached PDFium output remain exact. Geometry and annotation comparisons retain tight limits.

## Verification

Windows verification passed with the resource guard enabled and browser tests at one worker:

- `bun run verify`: static checks, nine tooling tests (two platform skips), 238 core tests (one platform skip), 13 platform tests, all 194 development browser cases and all 32 production cases.
- A later real-plan reopen failure was reproduced by a new four-page nested-tree fixture. PDFium can enter its whole-file recovery state without issuing a byte hint; the adapter now probes that next state before waiting. The fixture fails before the correction and passes afterward. All 74 final PDF cases pass in Chromium/Firefox, including the two added cases; static checks and all 32 production cases pass again on the corrected build.
- All 19 Rust tests pass, including snapshot immutability, release, streaming saves, rollback and reopen. Release binaries build successfully. Native IPC/cache smoke and the full desktop takeoff/reopen workflow pass.
- Complete web delivery passes with `pdfium-integration-2026-10-20-verified`: 17 manifest files, bridge 8, the local 7,634,095-byte WASM binary and notices. After activation and server shutdown, restarting, reopening the project, **importing a fresh PDF and rendering it** all pass. The fresh asset forces PDF engine startup even if old PNGs are cached.
- The 8.4 MB sparse fixture passes the native workflow and pixel-identical reopen, exercising missing ranges after the original import snapshot closes.
- The real 347,928,354-byte plan imports all 165 sheets; CLI exports of sheets 1, 83 and 165 pass, and sheet 165 reopens with identical pixels. This run imports in 5.359 seconds; its 1024-pixel CLI exports take 3.266, 0.203 and 0.110 seconds respectively, including app scheduling/cache work. These are not isolated engine raster times. The three exported sheets were visually checked for complete content and orientation.

A fresh-profile capture after import-worker retention gives the following comparison with the earlier PDF.js capture on this machine. Both keep the navigator visible and use the same real source at 200 DPI. These are individual captures, not repeated benchmark averages or whole-set completion times.

| Measurement                                    | Earlier PDF.js |   PDFium |
| ---------------------------------------------- | -------------: | -------: |
| Whole 165-sheet CLI import                     |        2.288 s |  5.242 s |
| First selected-page display, from its request  |        6.942 s |  1.400 s |
| First display, from recording start            |        9.154 s |  6.578 s |
| Four masters prepared by, from recording start |       16.826 s | 12.421 s |

The PDFium capture opens one document worker, completes four master rasters and encodings, makes no separate 640-pixel PDF raster requests, and reports zero preparation failures. Source reading and engine setup happen once per PDF, while pages reuse the loaded document. The native availability API requested the whole source in this capture, making import heavier than the earlier PDF.js sample. Retention removes its second transfer/open, and subsequent page rendering is fast. Initial native attempts stalled on repeated SQLite BLOB traversal; saved-asset snapshots resolved that bottleneck. Trial memory mapping was insufficient and is not in the product.

Evidence is retained in ignored `tmp/pdfium-integration-2026-10-20/`: `verify-final.log`, `pdf-after-nested-fix.log`, `nested-before.log`, `production-verified.log`, `native-tests.log`, `native-final-{performance,summary}.json`, `large-desktop-verified/`, `sparse-desktop-final/`, `offline-desktop-verified/` and the matching build/native logs. The source PDF and rendered pages are not committed. Earlier assembly diagnostic timing outliers passed focused reruns and the clean full verification; diagnostic budgets were not changed.

macOS and Linux native builds were not run. Windows WebKit lacks worker OffscreenCanvas, so Chromium/Firefox establish PDF browser results here; its PDF-independent IndexedDB check passes. The isolated comparison sample is unchanged. Takeoff format 4 is unchanged, and renderer updates after this bridge-8 rebuild remain web-delivered.

Workflow `pdfium-integration-2026-10-20` uses the [Banana Split skill](C:/Users/TimothyCardoza/.agents/skills/banana-split/SKILL.md); see the [agent directory](../.banana-split/pdfium-integration-2026-10-20/directory.md). Host/root outcome: success. The host/root is thread `cf0d72d7-7832-410b-bbf6-ad5ef72b648e`, GPT-6.1 Sol/xhigh. Eight distinct children used the default tier: four GPT-6.1 Sol/xhigh and four GPT-6.1 Sol/medium, with zero descendants or tier changes; nine agents including the host. One API assessment and seven fresh source reviews are accepted. Two review corrections addressed sparse hidden-layer reads, page-box fallbacks and distribution notices. Native captures then drove saved-asset snapshots and import-worker retention; trial memory mapping was insufficient and removed. Source reviews report no high/medium findings. The host owns runtime verification, including before/after reproductions of the hidden-layer issue and the final small nested-tree correction. No escalations or cancellations occurred.
