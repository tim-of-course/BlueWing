# Workflow performance checks

`bun run verify` includes two performance scenarios in the ordinary development browser suite. Run just these scenarios with `bun run test:performance`. Both commands use the resource guard and one browser worker, testing Chromium and Firefox in sequence, plus WebKit on macOS and Linux. No extra browser server or duplicate performance pass is added to `verify`.

The workload uses the committed two-page PDF, 300 path traces, 15 groups and quantity assignments, and a modeled wall. It is a small repeatable regression check, not a replacement for testing Bingham or recording a native desktop slowdown.

## What is measured

| Activity         | Measurement boundary                                                                                                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canvas.pointer` | Synchronous pointer movement, including snapping, selection and pan updates. Deferred reactive work is outside this span.                                                                                                                                                                           |
| `canvas.paint`   | Drawing the plan, traces, selection and draft to the canvas. GPU execution and screen presentation are outside this span.                                                                                                                                                                           |
| `canvas.commit`  | Finishing a trace or edit through command execution and persistence. Excludes the user's time placing points. Includes a success flag.                                                                                                                                                              |
| `page.display`   | The visible canvas requests a page until its first full-image draw finishes. Includes cache acquisition, decode and scheduling; excludes earlier click dispatch, hidden views and GPU presentation. Failed or superseded requests have `success: false`; cancellations also have `cancelled: true`. |
| `cli.command`    | Parsed, known command through dispatch, queue wait and response/message formatting. Excludes CLI process launch, IPC, final JSON serialization and subsequent UI paint. Grouped by command name, never by arguments.                                                                                |

Recording remains opt-in, with no observers or animation loop while inactive. Performance control commands are excluded from CLI timing so stopping or exporting a capture does not alter its contents. Unknown commands and malformed requests do not record arbitrary input as command names. `messages.wait` can legitimately take a long time; its command duration is not CPU time.

## Frames and tasks

`summary.frames` reports cumulative counts **strictly above 17, 33, 50 and 100 ms**. A 60 ms interval contributes to the first three counts. Divide by `frames.count` for rates. Equality is excluded, counts survive timeline eviction, and starting a new recording resets all buckets. Hidden-tab intervals are excluded.

17 ms is a useful target around a 60 Hz frame interval. 33 ms highlights larger gaps. These are observed animation-frame intervals, not an exact count of dropped display frames, especially on displays with a different refresh rate. Inspect them alongside pointer/paint timing and input delay. The browser's [Long Tasks API](https://www.w3.org/TR/longtasks-1/) only exposes tasks exceeding 50 ms; that fixed API threshold remains separate from our frame budgets.

## Regression checks

| Scenario                      | Checks                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trace and pan over 300 traces | Pointer and canvas-paint p95 ≤17 ms; frame-gap p95 ≤33 ms with at least 20 samples; a trace commits within 1 second. Pointer movement reuses the calculation, saving refreshes it, and no PDF rasterization occurs.         |
| Import and navigate           | Cold import records actual raster and completed page-display stages. Six warm page swaps have page-display p95 ≤250 ms, hit memory cache and do not rasterize again.                                                        |
| Find and inspect              | Navigator typing filters the expected sheet. Five repetitions each of `project.inspect`, `quantities.inspect`, `pieces.inspect` and `commands.list` have command p95 ≤33 ms. These readers retain the accepted calculation. |
| Agent view                    | A 320-pixel `sheet.render` completes within 2 seconds and downloads an image; Wingman's 640-pixel preview finishes loading. Those two renders are allowed; page swaps must not add rasterizations.                          |

There is currently no CLI PDF text-search command. The suite covers the existing structured lookup commands and the UI's sheet/group search instead of inventing a substitute command.

Budgets apply to this fixture and development build. They are regression limits, not promises about every PDF or machine. Individual frame overruns are reported without failing a run; the tracing check fails on a sustained p95 overrun. Timing failures should be investigated using the saved report before changing a budget. Guard exits with code 75 are incomplete verification, not a pass or a timing regression.

The suite saves `tracing.json`, `cold-import.json`, `navigation-and-cli.json`, and Solid diagnostics under the scenario's `test-results/dev/` directory. Reports are written before budget assertions and also on action failures when the browser is still available. Missing samples and timeline eviction fail the checks rather than silently passing a partial measurement. Solid diagnostics, silent holds, visible results and calculation/cache reuse are checked alongside timing.

## Native preparation regression

The browser interaction scenarios wait for preparation to finish. Their small PDF and p95 limits did not catch periodic stalls with architectural-size sheets. A native capture had a 16.9 ms p95 alongside a 1,074 ms worst frame. Review the worst gap as well as p95 when background work periodically interrupts an otherwise responsive viewer.

After changes to PDF workers, image caches, native byte transfers or canvas painting, run the Windows native scenario against current release binaries:

```powershell
bun run build
bun scripts/heavy.ts -- cargo build --manifest-path src-tauri/Cargo.toml --locked --bins --release
bun run test:desktop:performance
```

Close other guarded desktop/test sessions first. This uses an isolated project and WebView2 profile, seven generated 36 × 48-inch sheets (7,200 × 9,600 pixels each), real disk caching, and continuous pointer movement with an unfinished path. It requires at least five pages to complete during interaction and fails on a worst frame above 150 ms. It records through PNG persistence, rather than stopping at first display. This limit catches visible stalls; it is not a 60 FPS guarantee. The test runs separately from portable `verify` because it needs Windows WebView2 and native binaries.

Evidence is written before timing assertions to `tmp/preparation/current/{performance,summary}.json`. The test also closes and reopens its project, verifying that the full master decodes from the saved PNG without another PDF render. Use `BLUEWING_PROFILE_LABEL` for another evidence directory. `BLUEWING_PROFILE_TRACE=1` additionally records a Chromium timeline. Node drives Playwright because Bun 1.3.14 on Windows fails the WebView2 CDP handshake.

Pair this repeatable check with **Record performance** while tracing on a representative real plan during preparation. Inspect worst gaps and their timing against raster/encoding/cache events. Do not accept a smooth p95 alone. The large local plan was checked through the native CLI recorder; a CDP-instrumented real-plan trial hung before producing evidence and was stopped.

The fix keeps the PDF worker's raster/encoding canvas CPU-backed and sends native PNG writes in 256 KiB chunks with an event-loop yield between chunks. Bridge 9 accumulates those chunks in a temporary file and atomically publishes the completed image. Earlier bridges still support the original whole-image command, but must be rebuilt before using the new frontend.

## October 20 preparation fix verification

On Windows WebView2, the new seven-sheet scenario reproduced a 2,181.5 ms worst frame with the original implementation, despite a 17 ms p95. CPU-backed worker canvases reduced the worst frame to 268.5 ms. Temporarily bypassing the actual native cache write reduced it to 17.4 ms, identifying the remaining transfer cost; that diagnostic was removed. CPU-backed canvases plus 256 KiB native writes passed with a 17.1 ms worst frame. The final run, including visible crosshair/pointer assertions and disk-cache reopening, passed at **17 ms worst**, with seven pages prepared, zero failed, and no frames above 17 ms. Its reopened master decoded from disk without a PDF render.

The private 348 MB, 165-sheet plan imported through the ordinary native CLI recorder and prepared its first four pages. Its worst frame was 134.2 ms immediately after the first selected-page paint; subsequent background preparation frames stayed within 17 ms. The large CDP-instrumented trial hung before evidence and was stopped. No native macOS/Linux timing result is claimed.

`bun run verify` passed static checks, 9 tooling tests (2 Windows skips), 238 core tests (1 Windows skip), 13 platform tests, all 196 development browser tests and all 32 production browser tests. All 21 Rust unit tests passed, including chunk assembly and failed-chunk atomicity. Bridge 9 release binaries were rebuilt. A final static check passed after the native regression additions. Evidence is under ignored `tmp/preparation/`, with the real-plan CLI capture under `tmp/ingest-profile-2026-10-16/native-real-chunked-*`.

An independent read-only coverage review identified the settled-preparation/small-fixture gap. A second read-only implementation review found that retained timeline events could miss an early stall after eviction. The host accepted that finding and changed the regression to use the cumulative `summary.frames.worstMs`; the native protocol had no significant review findings. Workflow `preparation-stalls-2026-10-20` completed successfully: host/root `cf0d72d7-7832-410b-bbf6-ad5ef72b648e` used GPT-6.1 Sol/high; two standalone reviewers used GPT-6.1 Sol/medium at the default general-workhorse tier. Three distinct agents including the host, no deeper children or tier switches. Both reviews were accepted. See [the workflow directory](../.banana-split/preparation-stalls-2026-10-20/directory.md) for failed trials and the resolved resource-guard refusal.

## Preview-first page loading

The drawing canvas displays a resident preview immediately, or acquires the saved preview alongside the full image. The full image replaces it without changing the camera. Late preview or previous-page results cannot replace the selected full image. Background disk preparation continues; no speculative full-page RAM loading was added.

Verification passed all 202 development and 32 production browser tests, including controlled preview/full-image ordering and rapid page changes in Chromium and Firefox. The native seven-sheet preparation and saved-master reopening check also passed, with a 17 ms worst frame during preparation. Evidence is under ignored `tmp/preparation/preview-verify.log` and `tmp/preparation/preview-final/`.

For future PlanSwift comparisons, the user's usual conversion settings shown on October 20 were PDF-to-TIFF, 200 DPI, grayscale with 16 shades, and “Downsize large TIF files” enabled. Sixteen shades can use 4 bits per pixel: a 7,200 × 9,600 image needs about 33 MiB of packed pixels versus about 264 MiB as RGBA. The screenshot does not establish PlanSwift's actual in-memory format or whether downsizing changed the comparison's pixel dimensions. Bluewing's image format and DPI remain unchanged.

## Cache compression sample

The cache already uses lossless PNG compression. One real 8,401 × 6,001-pixel page was decoded once into a CPU-backed worker canvas and encoded directly as PNG and WebP at quality 0.8 using Chromium's built-in encoder. PNG was 12,070,091 bytes and took 257.2 ms; WebP was 1,907,180 bytes and took 1,855.9 ms. WebP saved about 84% of encoded bytes but added about 1.6 seconds of encoding per page in this sample. This is a single-page timing comparison, not a fidelity approval or a claim about a different WASM encoder. Fine text and thin lines still need visual comparison before changing the cache format. The app retains PNG. Smaller encoded files do not reduce the decoded 200 DPI bitmap's memory footprint. Evidence is under ignored `tmp/preparation/codec/`.

## October 8 Windows and Linux verification

On Windows, the complete Chromium and Firefox development suite passed all 162 tests, including both performance scenarios with the original budgets. All 32 production tests passed. Subsequent shared-fixture corrections were rechecked in 14 development and 16 production tests across those browsers. TypeScript, ESLint, formatting and the 13 platform checks passed. Windows core checks passed 235 tests with one POSIX-only skip; Ubuntu WSL passed all 236 core tests. Resource-guard tooling passed nine tests with two Windows skips and all 11 tests on Linux.

Ubuntu 26.04 WSL, using pinned Bun 1.3.14, Node 22.22.3 and Playwright 1.63.0 WebKit, passed 79 of 81 development tests and all 16 production tests. The tracing scenario still failed its frame-gap budget: p95 was 35 ms against 33 ms, while pointer and paint p95 remained around 1 ms. The Wingman screenshot scenario completed its pixel and persistence checks but recorded `HOT_SCOPE_TIME` in DrawingCanvas's mounted setup at approximately 8 ms against an 8 ms budget. Earlier attempts measured 8–10 ms; one focused attempt passed. These remain timing failures. Running with Linux-local output and a focused tracing attempt with Playwright tracing disabled did not remove the frame-gap failure. Its cause has not been established.

WebKit reports Long Tasks and Long Animation Frames as unsupported here. Zero samples therefore do not prove absence of long work. All runs kept the resource guard enabled and one browser worker; no resource refusal or stop occurred during this verification. Reports and logs are retained under ignored `tmp/stabilization-2026-10-08/`. Native macOS/Linux behavior and the private large-plan benchmarks were not verified on this machine.

## Earlier verification record

All 236 core tests passed, including 16 recorder tests and seven focused CLI timing tests. Coverage includes exact threshold equality, cumulative frame buckets, bounded retention, restart/reset, inactive recording, privacy, success/failure, queue wait and exclusion of recording controls. The full TypeScript, ESLint and formatting checks passed.

Browser timing budgets still require a completed guarded run. Both Chromium attempts were refused before browser startup (exit 75) because macOS reported critical memory pressure. No browser timing result is claimed. WebKit and production browser/build checks remain pending under the same resource condition. Keep these initial budgets provisional until the suite completes on an otherwise usable development machine. Native IPC and native webview timing are outside these browser tests.

On October 8, another Chromium attempt started the two-test suite, then the guard stopped it with exit 75 when memory pressure became critical. It established no completed scenario or calibrated budget. The implementation was subsequently pushed to `main` at `1d3079d`; merging and publishing did not complete the pending browser verification.

Two implementation agents completed their assigned changes through Banana Split using the configured `default` tier/catalog, GPT-6.1-Sol with resolved xhigh reasoning. Workflow `wf_b5d7bcec-62aa-4445-9953-8d4db751530c`, root `agt_4933aed6-f2c9-4af5-a50d-cbd3a03cc7f6`, added frame buckets; workflow `wf_14fa6be7-fb9d-49b4-a56f-09e67fc85a24`, root `agt_7e3a4456-4c3a-4801-89ab-f663012d0945`, added CLI timing. Neither spawned children. Both completed without approval requests, retries, tier changes, failures or managed tool rejections. The host reviewed their changes and ran the combined focused tests.

A third root reviewed the integration read-only: workflow `wf_d6d434f8-aac6-4b28-a50f-671f661f63a9`, root `agt_90393c0f-1163-46f6-9fca-593d03f561cf`. It completed successfully with the same configured tier, model and resolved reasoning, no children or managed tool rejections. The host fixed both findings: explicitly pace pointer moves across animation frames, and await/count Wingman's separate preview raster. Across the three terminal workflows there were three root agents, no descendants, tier changes, formal revisions or approvals. A late host status message to the already-completed reviewer was rejected without effects. The host used GPT-6-Astra with ultra reasoning. Workflow completion does not establish browser verification.
