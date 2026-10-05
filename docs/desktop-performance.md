# Desktop responsiveness, October 5, 2026

This work addresses the reported Windows lag during large-plan import, page changes, mouse movement, menus, and typing. The separate agent-created Python title-extraction process started after that lag; it does not explain the original problem. The Windows machine has not been profiled locally, so the changes below fix verified sources of unnecessary work without claiming a complete diagnosis of that machine.

## Product changes

- Sidebar previews render only for visible rows and an open preview. Scrolling or hiding the sidebar cancels obsolete work and releases its decoded images and object URLs. Duplicate sheets share one source preview.
- Sidebar row state updates by sheet ID. One fieldset disables sheet actions during edits/saves; group membership is indexed once rather than scanned separately for every row. Saving an edit preserves collapsed groups.
- Native PDF imports and saved projects read requested byte ranges from disk through bounded IPC. Automatic whole-file prefetch is disabled. Import parsing finishes before the saved sheets appear, so viewers reopen the saved asset rather than retaining the temporary import snapshot.
- PDF rendering yields between chunks so input and painting can run. It still works while the native window is in the background. Superseded renders are canceled; at most two idle PDF workers remain cached, while active operations stay pinned.
- Canvas paints coalesce into animation frames. Unsnapped mouse movement before drawing does not repaint the plan, unchanged canvas dimensions are not reassigned, and a hidden plan stops rendering while preserving its view.
- CLI metadata publications no longer clone and republish unchanged project data. Material diagnostic matching uses ID sets instead of repeated scans. Construction forms resolve reference choices only when those fields need them. Wingman retains an unchanged plan raster across geometry edits.
- Copied connection prompts select the running desktop profile explicitly, preventing an inherited test-profile environment variable from selecting an old app. Runtime inspection distinguishes the running development/cached web source from the cache's selected version. `bun run desktop` builds the matching sibling CLI before starting Tauri.

PDF.js cancellation exposed an upstream [range-reader destruction hang](https://github.com/mozilla/pdf.js/issues/22051). A small Bun patch rejects range retries after abort and lets document-initialization callbacks end quietly after termination. Vite minifies the patched readable worker using its existing toolchain. The dependency version and Solid package pins are unchanged. Revisit the patch on a PDF.js upgrade rather than carrying it indefinitely.

## Real Bingham plan

The guarded native detailed workflow ran against the private original PDF on the local 8 GiB Apple Silicon Mac, using fresh debug native binaries with production web assets. No full-document Python extraction or rendering was used.

| Measurement                    | Result                                    |
| ------------------------------ | ----------------------------------------- |
| Source                         | 349,354,454 bytes, 164 sheets             |
| Import and durable save        | 4.51 seconds                              |
| First requested render, page 1 | 13.25 seconds                             |
| Page 83 render                 | 7.85 seconds                              |
| Page 164 render                | 2.81 seconds                              |
| Project close                  | 0.061 seconds                             |
| Reopen                         | Last-page pixels matched the prior render |
| Peak physical footprint        | 2,517 MiB, about 2.46 GiB                 |
| Peak resident memory           | 1,721 MiB, about 1.68 GiB                 |

Render requests used the real CLI with a 1,024-pixel maximum dimension. Their timings include CLI transport and any concurrent viewer work, not isolated PDF parsing. Import completion is not the same as the first page finishing its render. These are single-run observations, not timing gates or before/after speedup claims.

The memory sample sums the isolated native test process tree and newly spawned WebKit helpers at roughly 200 ms intervals. Physical footprint includes compressed memory; it differs from resident memory. It excludes the pre-existing editor and other apps. macOS reported warning pressure during the run; the resource guard remained enabled and did not report critical pressure.

An earlier run imported and rendered the pages but timed out while closing, exposing the PDF.js bug. The results above are from a successful rerun after the cancellation and close-order fixes, before the final sidebar row-state optimization. The three exported pages were also visually checked for actual plan content.

Ignored evidence: `tmp/detailed-workflow/large-plan.json`, `commands.json`, `large-page-1.png`, `large-page-83.png`, `large-page-164.png`, `large-reopened.png`, and `tmp/memory-profile/bingham-ranged-fixed.json`. The source PDF is not committed.

## Verification scope

| Check                              | Result                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Frozen dependency install          | Passed; applies the pinned PDF.js patch                                                                   |
| TypeScript, lint, formatting       | Passed on the final source                                                                                |
| Core                               | 180 passed                                                                                                |
| Tooling/resource guard             | 11 passed                                                                                                 |
| Platform storage                   | 11 passed                                                                                                 |
| Rust unit tests                    | 14 passed                                                                                                 |
| Focused PDF browsers               | 20 passed across Chromium/WebKit                                                                          |
| Final focused sidebar/navigation   | 8 passed across Chromium/WebKit                                                                           |
| Final full development run         | All 39 Chromium cases passed; WebKit stopped after its first 2 passes when macOS pressure became critical |
| Production browsers                | 32 passed before the final sidebar row-state optimization                                                 |
| Web/native builds                  | Passed before the final sidebar row-state optimization                                                    |
| Native smoke and detailed workflow | Passed, including the real Bingham run above, before the final sidebar row-state optimization             |

The remaining full WebKit pass, rebuilt production verification, and native rerun are not claimed as final passes. The guard stopped the last development run with exit code 75 and cleaned up its processes. Subsequent checks reported warning memory pressure and load around 49–54 on eight CPU cores, above the guard's startup limit of 16. After load recovered to 9 and the guard reported no startup problem, a WebKit-only retry started but was also stopped by critical memory pressure before completing a test. No guard threshold was bypassed or changed.

Once the host can sustain heavy work, complete `bun run test:dev --project=webkit`, `bun run build`, `bun run test:production`, and `bun run native:build`, then rerun `tests/desktop/detailed.py` with `BLUEWING_TEST_DETAILED_PLAN` pointing to the original Bingham PDF. Keep the guard enabled and run these sequentially. The native workflow should retain its current import/render/close timing evidence; the optional macOS memory monitor is in ignored `tmp/memory-profile/`.

Focused PDF regressions cover real vector output while yielding to input, background-compatible scheduling, pending-load and pending-render cancellation, late byte delivery, failed reads and retry, idle-worker eviction, active-worker pinning, and sparse range access without reading unused streams. Pixel assertions check that scheduling and cancellation changes preserve output.

Canvas checks count actual paints and backing-buffer assignments during pointer bursts and hidden views. Sidebar checks cover visibility, scrolling, preview priority, duplicate source sharing, cancellation, and resource release. A close regression holds PDF cleanup pending and verifies that the UI detaches before it completes, then reopens the saved project.

The 164-row sidebar test records Solid diagnostics during selection, scrolling, and collapse after initial setup. It asserts visible-row rendering and cancellation directly, rather than imposing a wall-clock limit on mounting all 164 DOM rows. The shared navigation workflow checks disabled actions during an edit and preserved collapsed groups after saving. A WebKit reload race in that persistence test was resolved by waiting for reopened images before reloading; cancellation retains separate regression coverage and worker warnings remain failures.

The native detailed workflow also checks calculated pieces and finishes, previews, undo/redo, PNGs, snippets, review state, live assembly overrides, restart equality, and explicit backup. Native smoke covers CLI discovery, profile identity, SQLite, cached web activation, and offline reopening. Browser tests exercise Chromium and WebKit with one worker; native checks exercise macOS WebKit, not Windows WebView2.

## Remaining limits

- PDF.js still reserves a source-length worker buffer and retains fetched source bytes until worker destruction. Random-access input avoids eager copies and reads; it is not a constant-memory PDF engine. Browser development still reads imported assets in full.
- Complex pages still need seconds for their first render. The input-yielding tests establish scheduling behavior, not a measured Windows interaction latency.
- The real-plan workflow rendered three representative pages and one reopened page. It did not scroll through and render every page, measure a long estimating session, or profile the original Windows machine.
- The actual Windows development app still needs checking with Bingham after these changes, including WebView2 rendering and the copied CLI prompt. Solid diagnostics are already enabled in development; see the README for recording instructions.
