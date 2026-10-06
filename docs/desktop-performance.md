# Desktop responsiveness, October 5, 2026

This work addresses the reported Windows lag during large-plan import, page changes, mouse movement, menus, and typing. The separate agent-created Python title-extraction process started after that lag; it does not explain the original problem. The Windows machine has not been profiled locally, so the changes below fix verified sources of unnecessary work without claiming a complete diagnosis of that machine.

## Product changes

- The sidebar requests previews only for visible rows and an open preview. Scrolling or hiding it cancels obsolete requests and releases displayed images and object URLs. A separate bounded cache retains reusable page images and previews; idle preparation covers the whole project. Duplicate sheets share one source preview.
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

## Page switching and cache experiment

Additional measurements on October 5 used the same original Bingham PDF, an Apple M1 with 8 GiB RAM, production web assets from this branch, and the existing debug native bridge. These measure the normal 3,000-pixel main viewer, rather than the earlier 1,024-pixel CLI exports. No product cache or loading transition was added by this experiment.

A temporary entry mounts the real `App` with `Application(true)`. The real CLI creates/imports or opens an isolated saved project. After its initially selected page finishes rendering, the harness invokes the actual sheet-row click handler for pages 83 and 164. The sidebar is collapsed and Wingman has no rendered view. Instrumentation confirms neither target page had a thumbnail or main render before its first selection. The saved-project runs initially selected page 134; its shared document resources could already be warm. OS disk caches were not purged.

The following timings cover selection through the first correct drawing-canvas paint, plus two subsequent animation frames. Both completed runs had a visible, focused window throughout these switches. The extra frames make this a conservative presentation proxy, not a physical display scanout measurement.

| Action                                               | A5-9, stair/elevator details, page 83 | K400, kitchen/building works, page 164 |
| ---------------------------------------------------- | ------------------------------------- | -------------------------------------- |
| First visit to previously unrendered page            | 2.17–2.30 s                           | 0.517–0.521 s                          |
| Return after viewing the other page, current product | 1.63–1.69 s                           | 0.224–0.257 s                          |
| Return with temporary completed-image cache          | 0.057–0.061 s                         | 0.057–0.061 s                          |

The cache experiment retained two completed 3,000 × 2,143 base-PDF canvases, including the current page, and returned the same canvas on a matching request. There were twelve cache-hit switches across two runs. Source images were available within 1–15 ms of selection, with no additional PDF byte reads or rendering. The normal viewer still painted its current overlays. The retained pixel buffers total 49.05 MiB, about 24.52 MiB more than retaining just one; browser/GPU copies and transient rendering allocations are additional. This prototype does not establish a production eviction policy or test cache invalidation across project lifecycles.

Returning to page 83 without the cache needed no additional file bytes but still spent about 1.6 seconds rendering. Keeping the document worker alive already avoids rereading those bytes. Increasing the idle-document limit would not remove this rendering work.

To distinguish document reuse from genuinely unloaded renderer state, a second experiment destroyed the PDF worker before each render. These are render-completion timings, without the extra UI frames:

| Maximum image dimension      | Page 83, fresh worker | Page 164, fresh worker |
| ---------------------------- | --------------------- | ---------------------- |
| 3,000 px, current main image | 2.508 s               | 1.061 s                |
| 640 px, sidebar preview size | 2.734 s               | 1.105 s                |
| 1,500 px                     | 2.786 s               | 1.130 s                |
| 2,400 px                     | 2.483 s               | 1.020 s                |

Starting a 640 px preview and 3,000 px render together on a fresh worker did not produce an earlier preview: page 83's full image completed at 2.995 s and its preview at 3.247 s; page 164 completed at 1.042 s and 1.046 s respectively. These single samples do not prove smaller images are slower in general. They show no useful first-load improvement from reducing resolution on these two pages. Reading/parsing and executing the page's drawing instructions remain necessary at preview size.

The full experiment stayed at normal macOS memory pressure. The two successful runs peaked at 1,821 and 1,710 MiB physical footprint for the isolated native/Python harness plus new WebKit helpers. These are whole-run peaks, not incremental cache cost. An initial attempt ran with a hidden, unfocused native window and timed out waiting for animation frames after the PDF finished. It is excluded from the page-switch results. The temporary harness gained an explicit screenshot-hook fallback for hidden windows; neither successful run used that fallback.

### Initial recommendation, superseded by the implemented cache

The initial recommendation was a small cache of completed main-view PDF images. A 128 MiB pixel budget would hold about five of these particular pages, with the current image retained and least recently viewed images evicted first. It must cache only source pixels, so takeoff edits, selection, calibration and names remain live. Key by source asset, page, rotation, dimensions and requested resolution; clear it when closing the project. Preserve cancellation of abandoned renders. Explicitly release evicted owned buffers. The pixel budget is not a cap on total app memory.

For slower first visits, reuse an already available sidebar preview while the main image renders. Keep any retained preview bytes bounded and decode only those being displayed. Do not require a new low-resolution render before starting the main render: this experiment found it costs almost as much as the full image. Prioritizing the selected page over queued thumbnails and pre-rendering one likely next page during idle time are further candidates, but their benefit and contention need separate measurement. The user subsequently requested generous memory caching, disposable disk caching and eventual background preparation of every page. The implementation below replaces this initial nearby-only recommendation.

Choose the transition after the production cache is verified. Cache hits should switch directly. An existing preview could remain visible and briefly fade into the completed image on a miss. Blur is optional styling; it does not reduce load time, and a never-previewed page still needs a fallback. Windows WebView2 and a full estimating session remain unmeasured.

Ignored reproducibility files: `tmp/page-load-profile/{bench.tsx,vite.config.ts,run.py,switch-results.json,results.json,page83.png,page164.png}` and `tmp/memory-profile/{page-switch-measured,page-resolution-probes}.json`. Build and native runs used `scripts/heavy.ts` sequentially. The screenshots were inspected to confirm the actual A5-9 and K400 page content. This was a focused performance experiment, not a rerun of the full verification suite below.

Independent read-only review used Banana Split workflow `wf_3df6afab-c73a-4fe8-9b1f-2879e417fb62`, completed successfully. The configured default tier stayed unchanged: one root coordinator, GPT-6.1-Sol with resolved high reasoning, observed Sol routing, and zero child agents. No workflow revisions, rejections, approval requests or retries were recorded. The host, GPT-6-Astra with ultra reasoning, ran the guarded measurements and corrected the initial hidden-window measurement failure. The review supported a recent-image cache and identified ownership and invalidation requirements; it did not run benchmarks or change files.

## Implemented page cache

The main viewer now uses 3,300 pixels along the longest edge, a 10% increase in linear resolution. Previews remain at 640 pixels. Page images use a 256 MiB pixel budget and previews a separate 32 MiB budget. These limits exclude caller-owned display copies, active jobs, PDF workers, GPU storage and encoding/decoding allocations. Background images enter below recent foreground images in eviction priority.

Requests reuse memory first, then a lossless PNG disk image, then render the PDF. The native adapter stores images in `std::env::temp_dir()/bluewing-page-images-v1`, independently of the takeoff file and app profile. It uses blocking-pool file I/O and atomic writes. Cache keys include the immutable source asset, page index, rotation, dimensions, requested resolution and renderer version. Names, calibration, geometry and calculation changes do not change source pixels. Browser development uses Cache Storage instead of the native adapter. Unavailable or corrupt caches fall back to the original PDF.

Closing a project releases memory and cancels preparation, leaving disk images disposable in the OS temporary directory. There is no reboot detector, app-owned age/size cleanup or project migration. Operating systems need not erase temporary files at a particular time. Disk images can be reused after restarting the app or moving the same project file, and can always be regenerated if removed.

Preparation starts near the selected sheet and proceeds through every remaining page, one job at a time. It waits after input, yields between PDF drawing chunks and pauses drawing for foreground work. A foreground request can share an in-progress background image. Full-page completion also generates the preview, avoiding a second PDF render. Existing complete disk pairs are skipped without decoding. PNG writes do not delay foreground image delivery, while preparation waits for each page's writes before starting another.

The loading transition is unchanged. The native bridge is now version 6, so older desktop binaries must be rebuilt.

### Native verification with the implemented cache

The same 164-page Bingham project was opened through the real CLI in an isolated native profile using bridge 6 and production web assets. The harness clicked actual sheet rows in the mounted application. Main images measured 3,300 × 2,358 pixels. Background preparation was initially held so the first visits and cache hits could be measured separately.

| Operation                                          | A5-9, page 83 | K400, page 164 |
| -------------------------------------------------- | ------------- | -------------- |
| Uncached image ready, hidden window                | 3.126 s       | 0.665 s        |
| Memory image ready, visible window                 | 3–4 ms        | 6 ms           |
| Disk image ready, visible window                   | 138–153 ms    | 124–130 ms     |
| Disk image ready after app restart, visible window | 150 ms        | 130 ms         |

Image-ready timings stop when the main viewer receives its owned canvas. The initial cold run had a hidden, unfocused window and used the existing screenshot hook to force a canvas paint; its timings are not screen-presentation measurements and are not directly comparable to the earlier visible-window baseline. In the visible follow-up, memory selections reached the first correct paint plus two animation frames in 60–68 ms, and disk selections in 165–207 ms. These are single-run observations on this Mac, not Windows guarantees or timing gates.

The initial preparation pass reached 159 pages before the temporary harness's 15-minute timeout. No PDF render failure or resource-guard stop occurred. After extending only that harness timeout, the follow-up reused the 159 disk pairs, rendered the remaining five pages, and completed the 164-page preparation pass in 22.525 seconds. This is a resumed pass, not a 22-second cold preparation claim. A subsequent app restart loaded both target pages with **zero PDF renders**. Their recent memory entries also remained usable after preparation. First-render and disk-loaded drawing screenshots matched byte for byte, and the actual A5-9 content was visually inspected.

All 328 PNG files, one main image and one preview per page, were present and totaled 247.54 MiB. The cache retained 215.65 MiB of pixel buffers after the successful follow-up, within the separate full-image and preview budgets. Across the long cold pass, peak physical footprint was 4,112 MiB and peak resident memory was 2,469 MiB for the isolated native/Python harness and new WebKit helpers. The footprint was about 1,806 MiB near the end before app termination. The follow-up/restart run peaked at 2,910 MiB physical footprint and 2,516 MiB resident memory. These whole-process peaks include transient PDF/rendering/browser allocations and are not the incremental cost of retained page images. The cold pass saw normal and warning macOS pressure; the follow-up stayed normal. No critical pressure was recorded.

Given the visible cache-hit measurements, direct switching remains appropriate for memory hits. A future transition should reuse an already available preview only while a slower image is pending, then briefly fade to the completed page. It should not add a delay to cached switches. No blur/fade transition was added here.

Ignored evidence lives in `tmp/page-cache-verification/`: `cold-first.json` preserves the original cold run; `first.json` and `restart.json` record successful completion and restart; `cold-first-A.png` and `cold-disk-A.png` preserve the cold pixel comparison. The harness, Vite config and CLI driver remain there. Memory samples are `tmp/memory-profile/page-cache-all-bingham.json` and `page-cache-bingham-resume.json`. Source plans and these private artifacts are not committed. All builds and native runs used the resource guard sequentially.

### Delegated implementation and review

Both Banana Split workflows completed mechanically with successful root outcomes, and the host reviewed their changes and ran the guarded verification. They used the configured `default` tier with no override or tier change. Each had one root coordinator, observed GPT-6.1-Sol routing with resolved high reasoning, and zero child agents. The host used GPT-6-Astra with ultra reasoning. No managed tool rejections, formal revisions, approvals or retry events were recorded.

- Native adapter: workflow `wf_971417bc-bb76-4a81-bf4a-4e95b766f6df`, root `agt_c2c3d2f0-0395-431c-9b7c-88212dba0a7c`. Added byte read/write commands and four unit cases. The host added the existence command and bridge version update.
- Browser regressions: workflow `wf_356ddfaa-4c17-44d6-881e-a19feb803610`, root `agt_33d9f561-a39d-4392-a7e2-02e5cd79c256`. Added the cache harness and scenarios; no heavy tests ran in the delegated workflow. The agent identified a rejected-existence-check fallback, which the host corrected. The host also fixed a test-only Chromium canvas readback warning and updated the existing sidebar test to observe cache requests instead of requiring redundant PDF rendering, then reran both browser engines successfully.

## Verification scope

| Check                        | Result                                                         |
| ---------------------------- | -------------------------------------------------------------- |
| Frozen dependency install    | Passed earlier on this branch; applies the pinned PDF.js patch |
| TypeScript, lint, formatting | Passed with the page cache                                     |
| Core                         | 180 passed                                                     |
| Tooling/resource guard       | 11 passed earlier on this branch; unchanged by the cache       |
| Platform storage             | 11 passed earlier on this branch; unchanged by the cache       |
| Rust unit tests              | 18 passed, including four page-cache cases                     |
| Full development browsers    | 108 passed across Chromium/WebKit                              |
| Production browsers          | 32 passed across Chromium/WebKit                               |
| Web/native builds            | Passed with bridge 6                                           |
| Native smoke                 | Passed, including actual page-cache read/write/existence IPC   |
| Native detailed workflow     | Passed before the cache; real Bingham results recorded above   |

Earlier full development runs were stopped by critical macOS memory pressure. After resources recovered, the complete development and production suites passed sequentially under the unchanged resource guard, with one browser worker. The final production run reported warning pressure but completed without a guard stop. No threshold was bypassed.

Focused PDF regressions cover real vector output while yielding to input, background-compatible scheduling, pending-load and pending-render cancellation, late byte delivery, failed reads and retry, idle-worker eviction, active-worker pinning, and sparse range access without reading unused streams. Pixel assertions check that scheduling and cancellation changes preserve output.

Canvas checks count actual paints and backing-buffer assignments during pointer bursts and hidden views. Sidebar checks cover visibility, scrolling, preview priority, duplicate source sharing, cancellation, and resource release. A close regression holds PDF cleanup pending and verifies that the UI detaches before it completes, then reopens the saved project.

The 164-row sidebar test records Solid diagnostics during selection, scrolling, and collapse after initial setup. It asserts visible-row rendering and cancellation directly, rather than imposing a wall-clock limit on mounting all 164 DOM rows. The shared navigation workflow checks disabled actions during an edit and preserved collapsed groups after saving. A WebKit reload race in that persistence test was resolved by waiting for reopened images before reloading; cancellation retains separate regression coverage and worker warnings remain failures.

The native detailed workflow also checks calculated pieces and finishes, previews, undo/redo, PNGs, snippets, review state, live assembly overrides, restart equality, and explicit backup. Native smoke covers CLI discovery, profile identity, SQLite, cached web activation, and offline reopening. Browser tests exercise Chromium and WebKit with one worker; native checks exercise macOS WebKit, not Windows WebView2.

Page-image regressions cover memory reuse, independent canvas ownership, PNG disk reuse, missing/corrupt/unavailable caches, eviction and disk reload, source-key invalidation, metadata reuse, shared-request cancellation, clearing active jobs and queued work, nearby-first preparation of all pages, derived previews and foreground priority. Real PDF tests verify that paused background drawing resumes after foreground work and that cancellation releases its scheduling resources. Both Chromium and WebKit run these checks.

## Remaining limits

- PDF.js still reserves a source-length worker buffer and retains fetched source bytes until worker destruction. Random-access input avoids eager copies and reads; it is not a constant-memory PDF engine. Browser development still reads imported assets in full.
- Complex pages still need seconds for their first render. The input-yielding tests establish scheduling behavior, not a measured Windows interaction latency.
- All 164 Bingham pages and their previews were prepared across the cold and resumed native runs. This does not measure a long interactive estimating session or the original Windows machine.
- The actual Windows development app still needs checking with Bingham after these changes, including WebView2 rendering and the copied CLI prompt. Solid diagnostics are already enabled in development; see the README for recording instructions.
