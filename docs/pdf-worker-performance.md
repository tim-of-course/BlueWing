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

| Check                                                   | Result                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| TypeScript                                              | Passed on the final source                                                                            |
| ESLint                                                  | Passed                                                                                                |
| Prettier                                                | Passed                                                                                                |
| Core                                                    | 225 passed across 31 files                                                                            |
| Tooling/resource guard                                  | 11 passed                                                                                             |
| Production web build                                    | Passed with both workers; rebuilding the final parser startup-message filter was refused by the guard |
| Rust formatting / native smoke Python syntax            | Passed                                                                                                |
| Focused browser worker rendering                        | Stopped by critical macOS memory pressure; no valid result                                            |
| Native unit tests/build/runtime                         | Guard stopped verification; no native runtime pass claimed                                            |
| Real-plan cold load / switching / interaction benchmark | Not completed                                                                                         |

The focused WebKit attempt started the real-worker display test before the guard stopped it with exit 75. Earlier browser/prototype/real-plan baseline attempts were also stopped. Starting a guarded Vite server for manual T3 preview inspection ended the same way. These are resource stops, not assertion failures or passes. The guard remains enabled and browser tests remain at one worker.

The new passing core tests cover bounded recording, lifecycle and inactive behavior, data filtering, session isolation, observer cleanup, shared raster ownership through eviction/clear, early pixel delivery, full/preview sharing, independent cancellation, late output cleanup, and recovery after encoder failure. Browser regressions have been added for worker isolation, priority/preemption, range failure and close, font/filter/transparency/crop parity, viewable nonprinting annotations, disk-preview repair, preparation progress/pause, and recorder control/export during queued rendering. Their presence is not a claimed browser pass.

The private Behavioral Health permit set was found in Downloads and copied to ignored `tmp/reference-plans/behavioral-health.pdf`: 12,359,347 bytes, 15 sheets. It is the first real-plan verification target, followed by the 164-sheet Bingham set. Neither PDF is committed. Next verification should measure cold selection through first correct canvas paint, memory and disk returns, preparation progress, input/frame gaps while preparing, and whole-process memory. Compare the same pages and resolution with the earlier backend, distinguishing hidden-window image-ready timings from visible presentation. Confirm native worker APIs, offline worker URLs and visual fidelity before merging. Windows WebView2 and native macOS WKWebView both remain required runtime targets.

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
