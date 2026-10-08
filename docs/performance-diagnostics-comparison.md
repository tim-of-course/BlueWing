# Performance diagnostics comparison

October 7, 2026. Compared the PDF pipeline at `ac0f5e8` with the worker pipeline at `c76a7a8`. The recorder introduced with the worker changes was backported to the isolated earlier checkout without changing its PDF implementation. This comparison measures the whole refactor, including PDF.js 6.3.289/print intent versus 6.4.299/display intent, scheduling, image ownership and encoding.

## Conclusion

The recorder detected actual UI stalls in the earlier renderer on real Bingham pages. Those stalls were absent in the corresponding worker-renderer sample. It also captured a remaining multi-second page wait. Moving the rendering work off the UI thread improved responsiveness in this sample; it did not make every first page visit faster.

The experiment exposed a diagnostics defect: ordinary frame samples quickly overwrite the detailed PDF timings, while the old summary preserves only browser metrics. The accompanying change retains bounded whole-session activity totals, the slowest completed span and the latest event for each activity group. Preparation progress is now recorded as well. This addresses evidence loss without increasing the detailed timeline or running additional observers.

## Real Bingham workload

The existing three-page Bingham excerpt contains the partition types sheet, office enlarged plan and reflected ceiling plan. Its size is 7,743,656 bytes; SHA-256 is `ef902d24ec1072fb6e32714dbe95ecf8a5d11df41d136d7d7bb465f358817d1c`. Both checkouts read the same file through HTTP byte ranges. Both used Chromium on this Mac, a visible focused tab, 1280 × 900 viewport, and the real page-image/PDF modules at 3,300 pixels with 640-pixel previews and browser cache storage. Each fresh browser context imported a new asset ID, so completed-image cache entries did not carry between runs. OS file caches were not purged.

The renderer fixture displayed the three pages in order, returned to the office plan, prepared all pages, and accepted four eight-character typing bursts. Input deferred new preparation using the same 750 ms policy. The matched saved checkpoints contain all three first visits, one memory return, all three prepared pages and 32 keydowns on each side. First visits can join a background render already underway; these are not independent fresh-worker render benchmarks.

| Measurement at that checkpoint                  |        Earlier renderer | Worker renderer |
| ----------------------------------------------- | ----------------------: | --------------: |
| Browser main-thread tasks over 50 ms            | 2, lasting 87 and 88 ms |               0 |
| Worst animation-frame gap                       |                 83.3 ms |         16.8 ms |
| Frame gaps over 50 ms                           |                       2 |               0 |
| Worst extra delay on an independent 50 ms timer |                 95.4 ms |          5.8 ms |
| Partition sheet, request to image ready         |                  2.91 s |          2.63 s |
| Office plan, first selection to image ready     |                  1.25 s |          1.25 s |
| Ceiling plan, first selection to image ready    |                  4.06 s |          4.56 s |
| Office plan, memory return to image ready       |                  3.9 ms |          0.1 ms |
| UI-thread PNG encoding calls                    |                       6 |               0 |
| All three pages prepared, from recording start  |            about 9.21 s |    about 9.65 s |

These are individual observations, not stable speedup estimates. In particular, the ceiling result does not establish a repeatable regression. Both recordings had frame p95 near 16.7 ms despite the earlier renderer's stalls, demonstrating why p95 alone is insufficient. Long-task counts, worst gaps and an independent timer exposed the difference.

The two earlier long tasks occurred inside the partition and ceiling PDF render intervals. This establishes temporal overlap, not the exact responsible call stack. The recorder is not a CPU profiler.

The worker report identifies where the ceiling wait remained: the successful worker attempt reported 4,836 ms for page/operator acquisition and drawing, 30 ms for preview/bitmap preparation and 77 ms for subsequent PNG encoding. The raster request took 4,868 ms overall. The selected request joined that job after it began and waited 4,563 ms. Encoding finished after image delivery. These nested timings overlap and must not be added together. Further work should investigate the worker's page acquisition/drawing cost and preparation throughput, rather than infer UI blocking from the page wait.

Evidence: ignored `tmp/diagnostic-comparison/renderer-{before,after}-1-switch-8000.json`. The `renderer-after-1-active.json` checkpoint additionally contains the subsequent ceiling memory return and fifth typing burst. The comparison above deliberately uses the earlier matched checkpoints.

## Full-app check and resource limits

A separate fixture mounted the real App and imported all 15 Behavioral Health pages. The saved first-switch checkpoints measured floor-plan image acquisition at 350 ms before and 178 ms after. The corresponding external click-action-to-canvas-draw measurements were 457 and 231 ms, including Playwright action overhead. Neither checkpoint contained a long task. The earlier version reached 15 prepared pages around 9.30 s and returned to cached pages quickly. This easier plan did not reproduce the Bingham stalls.

The resource guard stopped these browser processes when macOS pressure became critical. It also stopped the Bingham runs after their saved comparison checkpoints, before the planned tails completed. All numbers above come from saved completed operations; no whole browser-test pass or sustained 5–10 minute run is claimed. Attempts were sequential, at one worker, and resumed only after the guard's resource check recovered. A final shortened repeat was refused before launch. The guard was not modified or bypassed.

The Bingham fixture isolates the real rendering/preparation pipeline with actual typing. It does not mount the full App. The earlier checkout's renderer-only server omitted the unused Solid compiler and reused its already-generated exact PDF assets to reduce setup memory; the worker sample used the normal development server. Compilation completed before capture. This is another reason to treat the observations as preliminary, rather than precise speedup percentages.

The comparison does not establish native SQLite/IPC performance, macOS WKWebView behavior, Windows WebView2/GPU selection, GPU memory use or responsiveness throughout the original 164-page import. Those remain unverified.

## Diagnostics correction and verification

A lightweight retention probe replayed the worker recording's actual events through the recorder and then appended 2,700 ordinary frame samples, representing 45 seconds at 60 Hz. Before the fix, all 45 captured spans disappeared from the detailed timeline and no page-load timing survived in the summary. The summary could report normal frame timing while omitting the recorded 4.56-second page wait. The appended frames are synthetic; this is a retention test, not another runtime measurement.

After the fix, `summary.activities` retains the 4,563 ms selected-page span and its page ID/time even after timeline eviction. Each group retains count, timed count, total duration, worst completed span and latest event. Groups distinguish activity, purpose, resolution, cache source and priority; page IDs do not create groups. The limit is 64 groups, with overflow explicitly counted. `page.preparation` records total/completed/failed/running/paused state on existing progress notifications, without polling. No observers run while recording is inactive.

The detailed timeline is still bounded. Frame p95 still covers retained samples only; browser counts/means/worst values cover the whole recording. Completed-stage totals can overlap, unfinished spans remain absent, and the report still lacks a direct selection-to-first-full-draw span and exact CPU-stack/GPU attribution. Those are useful next additions; they are not solved by the summary correction.

Verification: 19 focused recorder and page-image lease tests passed, including ten minutes of simulated frame eviction, retained worst page timing, separate preview/selected groups, latest preparation state, bounded group count, independent snapshots and session reset. TypeScript and targeted ESLint passed. The actual-event retention replay preserved the slow selected-page evidence with 13 groups and no overflow. Native and production build checks were not run for this diagnostic-only change; browser verification remains resource-limited as described above.

Private artifacts and both experiment fixtures are in ignored `tmp/diagnostic-comparison/`. The renderer fixture uses the production modules; the earlier checkout only receives the recorder and measurement fixture. Neither private PDF is committed.

## Independent review

One Banana Split root completed a read-only audit successfully; there were no children. It used the configured `default` tier/catalog, observed GPT-6.1-Sol routing and resolved xhigh reasoning, with no tier changes, approvals, retries, revisions, failures or managed tool rejections. The host used GPT-6-Astra with ultra reasoning. Workflow `wf_1d5001e2-fc18-44d9-b121-b0800b4e339f`, root `agt_1880caea-34e6-48a9-847a-6a77960cbdca`; retained review data is `tmp/diagnostic-comparison/review.json`. Mechanical review completion is separate from the interrupted benchmark runs.
