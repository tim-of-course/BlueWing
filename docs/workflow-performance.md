# Workflow performance checks

`bun run verify` includes two performance scenarios in the ordinary development browser suite. Run just these scenarios with `bun run test:performance`. Both commands use the resource guard and one browser worker, testing Chromium and WebKit in sequence. No extra browser server or duplicate performance pass is added to `verify`.

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

## Verification record

All 236 core tests passed, including 16 recorder tests and seven focused CLI timing tests. Coverage includes exact threshold equality, cumulative frame buckets, bounded retention, restart/reset, inactive recording, privacy, success/failure, queue wait and exclusion of recording controls. The full TypeScript, ESLint and formatting checks passed.

Browser timing budgets still require a completed guarded run. Both Chromium attempts were refused before browser startup (exit 75) because macOS reported critical memory pressure. No browser timing result is claimed. WebKit and production browser/build checks remain pending under the same resource condition. Keep these initial budgets provisional until the suite completes on an otherwise usable development machine. Native IPC and native webview timing are outside these browser tests.

Two implementation agents completed their assigned changes through Banana Split using the configured `default` tier/catalog, GPT-6.1-Sol with resolved xhigh reasoning. Workflow `wf_b5d7bcec-62aa-4445-9953-8d4db751530c`, root `agt_4933aed6-f2c9-4af5-a50d-cbd3a03cc7f6`, added frame buckets; workflow `wf_14fa6be7-fb9d-49b4-a56f-09e67fc85a24`, root `agt_7e3a4456-4c3a-4801-89ab-f663012d0945`, added CLI timing. Neither spawned children. Both completed without approval requests, retries, tier changes, failures or managed tool rejections. The host reviewed their changes and ran the combined focused tests.

A third root reviewed the integration read-only: workflow `wf_d6d434f8-aac6-4b28-a50f-671f661f63a9`, root `agt_90393c0f-1163-46f6-9fca-593d03f561cf`. It completed successfully with the same configured tier, model and resolved reasoning, no children or managed tool rejections. The host fixed both findings: explicitly pace pointer moves across animation frames, and await/count Wingman's separate preview raster. Across the three terminal workflows there were three root agents, no descendants, tier changes, formal revisions or approvals. A late host status message to the already-completed reviewer was rejected without effects. The host used GPT-6-Astra with ultra reasoning. Workflow completion does not establish browser verification.
