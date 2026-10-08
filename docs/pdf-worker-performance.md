# PDF worker refactor and verification

October 7, 2026. Work is isolated on `perf/off-thread-pdf`, based on `ac0f5e8`. This record describes the new implementation and its verification limits. The timings in [desktop-performance.md](desktop-performance.md) describe the earlier main-thread renderer and must not be treated as measurements of this refactor.

## Changes

PDF.js previously parsed in a worker but drew PDF instructions into canvases on the UI thread. Background preparation also resized images, encoded PNGs, and sent base64 cache writes through that thread. Yielding between drawing chunks could not interrupt a single expensive drawing operation.

The new backend gives each document a parser worker and a raster worker, connected directly by a MessageChannel. Operator lists, fonts and image data do not pass through the UI. The raster worker draws to OffscreenCanvas with native worker font support. It delivers transferable ImageBitmaps before encoding their PNGs. PDF.js is deliberately pinned to 6.4.299, whose CPU filter paths support transfer maps without DOM SVG filters. Display intent preserves visible annotations and layer settings. Native range reads remain bounded at 256 KiB with automatic fetching disabled.

One raster job runs at a time per document. Selected pages take priority over visible previews and background preparation. Higher-priority work can cancel and restart lower-priority drawing. At most two PNG encoders retain canvases, including canceled encoding that the browser cannot interrupt. The host terminates both document workers on close or fatal range failure and settles pending requests immediately. Two recent idle documents remain reusable; active operations and outstanding encoding keep their documents alive.

The main plan viewer holds immutable ImageBitmaps through reference-counted leases instead of making a full-page canvas copy. Eviction releases the cache's reference without erasing a page held by the viewer. Wingman continues to request a small cropped raster through the same worker backend, preserving detail at its view's zoom. Main images have a 256 MiB decoded-pixel budget and previews have a separate 32 MiB budget. These budgets exclude encoded PNGs, active leases beyond the cache, PDF source buffers, worker canvases, browser/GPU copies and transient allocations. PDF.js still reserves a source-length buffer and retains fetched bytes; this is not a constant-memory PDF engine.

A lazy image worker serializes cached PNG decoding and preview derivation. Canceled queued decodes are dropped; late active output is discarded. A full PDF render produces its 640-pixel preview once. A missing preview can also be derived from an existing full-page disk PNG, without reopening the PDF. Sidebar requests still cover visible rows and an open hover preview.

Disposable native cache writes now use raw-byte IPC and atomic temporary-file replacement without a durable flush. Project storage retains its existing durability behavior. The web/native bridge is version 7 and requires a rebuilt desktop binary. A new renderer key prevents reuse of older page images; no takeoff format migration is introduced.

Preparation still covers all pages, beginning near the selected sheet. Input defers new work for 750 ms. Typing and saves do not repeatedly throw away background drawing already running off the UI thread. Actual foreground PDF work preempts it, and the user can explicitly pause or resume preparation. The footer reports completed and failed pages. A memory-cached preview can remain visible while full resolution loads, followed by a short reveal only for slower loads; memory hits acquire no artificial delay. These loading behaviors still need browser and native verification.

## Performance recording

The footer's **Record performance** button starts an on-demand recording; **Save performance recording** stops it and exports JSON. The CLI exposes `performance.start`, `performance.status`, `performance.stop` and `performance.export`. These commands bypass the ordinary project queue so a long import or export does not hold the recorder controls, while still respecting Pause CLI.

Recordings include application spans for import, range reads, raster requests, worker drawing/resizing/encoding, cache reads/decodes/writes, and the selected page's first canvas paint. Browser observers capture frame gaps, input timing, long tasks and long animation frames where supported. The report explicitly lists supported APIs. There are no observers or frame loops while recording is inactive. The default ring retains 2,048 events and reports dropped samples; counts, means and worst values cover the whole recording, while percentiles use retained samples. Data fields exclude plan text, file paths, screenshots and DOM targets.

Use recordings alongside development Solid diagnostics and browser/native profilers. A recording identifies delays but does not attribute GPU process memory or prove which graphics adapter WebView2 selected. No Windows-only GPU preference was added.

## Verification results

| Check                                        | Result                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| TypeScript                                   | Passed on the final source                                                                                 |
| ESLint                                       | Passed                                                                                                     |
| Prettier                                     | Passed                                                                                                     |
| Core                                         | 225 passed across 31 files                                                                                 |
| Tooling/resource guard                       | 11 passed                                                                                                  |
| Production web build                         | Passed on the final source, including the parser startup-message filter; both workers emitted              |
| Rust formatting / native smoke Python syntax | Passed                                                                                                     |
| Focused browser worker rendering             | Six Chromium checks passed: isolation and five fidelity fixtures; broader suites were stopped by the guard |
| Native unit tests/build/runtime              | Guard stopped verification; no native runtime pass claimed                                                 |
| Real-plan renderer check                     | Behavioral Health page 4 passed in Chromium; full desktop/preparation benchmarks remain pending            |

The focused Chromium test passed, confirming real parser/raster workers, display pixels before PNG encoding, and no PDF drawing/encoding on UI canvases. The focused WebKit attempt started that test before the guard stopped it with exit 75; a subsequent five-fixture WebKit fidelity attempt was also stopped before results. A full 158-test development attempt stopped after its first case; a 92-test focused attempt stopped after 13 Chromium cache cases, including disk preview repair, eviction, cancellation and late-result cleanup. Neither suite completed. Earlier browser/prototype/baseline attempts and a native test retry were also stopped. These are resource stops, not assertion failures or passes. The guard remains enabled and browser tests remain at one worker. Manual T3 preview navigation also failed with a client automation error, including a retry while the guarded Vite server was alive and returned HTTP 200.

The new passing core tests cover bounded recording, lifecycle and inactive behavior, data filtering, session isolation, observer cleanup, shared raster ownership through eviction/clear, early pixel delivery, full/preview sharing, independent cancellation, late output cleanup, and recovery after encoder failure. Five focused Chromium fidelity tests also passed: transfer maps, transparency, embedded fonts, rotated crops and viewable nonprinting annotations. They compare full and region worker rasters with the official display-intent DOM renderer and confirm lossless PNG round trips. Other browser regressions have been added for priority/preemption, range failure and close, preparation progress/pause, and recorder control/export during queued rendering. Their presence is not a claimed full browser pass.

The private Behavioral Health permit set was found in Downloads and copied to ignored `tmp/reference-plans/behavioral-health.pdf`: 12,359,347 bytes, 15 sheets. A guarded Chromium check on this Mac successfully rendered its page 4 floor plan through the production worker and page-image modules at 3,300 by 2,200 pixels. After metadata import, the first document workers were destroyed before selection so the selected page began with fresh workers and no completed-image cache entry. Image-ready time was 455.1 ms and the harness canvas drew it and reached its next animation frame at 460.9 ms. A subsequent memory acquisition measured 0 ms, below the timer's resolution. During the 757.5 ms recording, 44 frame gaps averaged 16.67 ms with a worst gap of 16.8 ms; no long tasks were observed. No input events were tested in that short recording. The screenshot was visually inspected for the actual floor plan and title block.

This is one isolated renderer sample in a visible, focused browser, using HTTP source ranges and browser cache storage. It does not measure native SQLite/IPC, the full application, disk-cache return time, interactive all-page preparation, physical screen scanout, or Windows performance. OS/network caches were not purged. There is no successful same-page baseline comparison yet, so it is not a measured speedup. Ignored reproducibility artifacts are `tmp/pdf-performance/{optimized.ts,optimized.html,optimized.dev.spec.ts,playwright.optimized.config.ts,optimized-chromium.json,optimized-chromium.png}`.

Neither private PDF is committed. Next verification should measure full-app cold selection through first correct canvas paint, memory and disk returns, preparation progress, input/frame gaps while preparing, and whole-process memory, followed by the 164-sheet Bingham set. Compare the same pages and resolution with the earlier backend, distinguishing hidden-window image-ready timings from visible presentation. Confirm native worker APIs, offline worker URLs and visual fidelity before merging. Windows WebView2 and native macOS WKWebView both remain required runtime targets.

## October 8 Windows and Linux verification

The page raster now lets PDF.js open its opaque page context, matching the official DOM renderer. Scratch canvases retain alpha for masks and transparency groups. The renderer cache key is `pdfjs-6.4.299-display-worker-v2`, so saved images from the earlier context configuration regenerate. Canvas leases now belong to the imperative painter, with derived loading/error feedback, rather than relaying image state through effects. Navigator projections retain immutable group records and stable group-kind outputs.

Windows Chromium and Firefox passed the complete 162-test development suite and all 32 production tests. Subsequent shared-fixture changes also passed focused development/production rechecks. Ubuntu 26.04 WSL WebKit passed all 23 PDF worker tests, including five fidelity fixtures at unchanged tolerances, plus the page-image cache/lease tests and all 16 production workflows. Its complete development result was 79 passed and two timing failures, described in [workflow-performance.md](workflow-performance.md#october-8-windows-and-linux-verification). Static checks and production web builds passed on Windows; the Linux production web build also passed.

Windows native verification also passed: 18 Rust unit tests, a rebuilt debug binary, the native smoke test and all four desktop workflows. The main workflow verified a complete local web release through download, activation, server-offline restart, project reopen and PDF render. Native workflows use the public CLI; native desktop source picking and UI screenshot gestures are not covered by those scripts. The browser suites cover those interactions.

The pinned Windows WebKit worker lacks native OffscreenCanvas. The common full-suite targets are now Chromium and Firefox on all operating systems, with WebKit added on macOS/Linux and a PDF-independent WebKit storage check retained on Windows. [README verification](../README.md#verify) documents WSL and version-matched Linux Docker options. Linux WebKit passes do not establish native macOS WKWebView or Linux WebKitGTK behavior. The private large plans were unavailable for this run, so no new real-plan timings or speedup are claimed.

## Delegated work

Seven independent Banana Split workflows completed mechanically with successful root outcomes. All used the configured `default` tier and catalog with no overrides or tier changes. Each had one root coordinator and zero children, for seven distinct managed roots and no descendant agents. Observed model routing was GPT-6.1-Sol for all seven; xhigh reasoning was the resolved setting, not an independently observed effort field. The host used GPT-6.1-Sol with ultra reasoning earlier and GPT-6-Astra with ultra reasoning for integration and final review.

| Assignment                | Workflow                                  | Root                                       |
| ------------------------- | ----------------------------------------- | ------------------------------------------ |
| Recorder                  | `wf_2540b7b0-857b-45a6-9aac-d21603fb5a89` | `agt_af57fabf-533a-42c8-82e9-1da0550a3e1c` |
| Binary page cache         | `wf_971cb708-3d9b-43dd-b0f5-ca1f4ee942ee` | `agt_84567059-e8ac-4ba5-baca-c6cfbad45512` |
| Worker feasibility probe  | `wf_8d687447-aa6d-4827-980d-d2a4dc5c5211` | `agt_3512b1e1-2a6d-4206-b360-fac82eda726a` |
| Raster engine             | `wf_0fa91c38-fc3f-4689-9ef3-d53755f85733` | `agt_99335420-15fa-4a69-aae8-375b1b3124d6` |
| Loading UI                | `wf_fafebde0-9d7a-46c2-bdb4-b1c797f905da` | `agt_b5ac4d78-ea4f-4570-a7e0-0c47da85ca97` |
| Browser regressions       | `wf_23aa7802-0fa4-4e38-aa28-5fa0a657544a` | `agt_6b51a101-22b9-4c8c-8df3-e7db0d0d469a` |
| Independent source review | `wf_7f0c3545-37bc-489c-8f26-c3559780c682` | `agt_da7d10da-cf04-4afc-af86-02f10b8e399b` |

Runtime diagnostics recorded two managed `banana_send:not_found` rejections in the engine workflow, zero no-disposition turns, zero formal revisions and zero acceptances. Recorder, probe, engine and test roots each resumed once after a finish-deferred context continuation. The host approved three scoped local operations: the isolated feasibility patch, in-memory engine control-flow checks, and the assigned test-harness rewrite. No managed Computer Use request was needed. A host follow-up to the already completed reviewer returned `recipient_unavailable` without side effects.

The independent review found three source-level issues, all addressed before the final build: print intent changing visible plan content, failed encoding poisoning cached previews, and missing previews bypassing available full-page disk PNGs. Source/mock control-flow checks establish neither native browser fidelity nor a real-plan speedup. Mechanical agent completion and passing lightweight checks do not complete the pending runtime verification.
