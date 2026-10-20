# PDF renderer sample

A small plain HTML/JavaScript viewer, separate from Bluewing. It imports no application code and changes no app configuration or dependencies. Uploaded PDFs stay in the browser; the local server only serves static sample and library files.

From the repository root:

```sh
# Download the pinned PDFium browser module, WASM and package license.
bun samples/pdf-renderers/setup-pdfium.mjs

# Optional: download the official Hayro demo's WASM SIMD build and notices.
bun samples/pdf-renderers/setup-hayro.mjs

# Run the viewer through the shared resource guard.
bun scripts/heavy.ts -- bun samples/pdf-renderers/server.mjs
```

Open <http://127.0.0.1:4188>. Pick a PDF, then switch between PDF.js, Hayro and PDFium WASM. The selected page and resolution carry across switches. Set `PDF_SAMPLE_PORT` to use another port. Stop the server with Ctrl-C. The installed root `pdfjs-dist` package supplies PDF.js; run the repository's normal dependency install if it is missing.

**Fit screen** renders only enough pixels for the viewport and device pixel ratio. **200 DPI** renders at paper size, within 100 MP / 16,384-pixel limits. All engines use the same requested scale. Zoom scales the current image without rendering again; use **Render again** to measure another raster in the current document. **Fresh worker + reopen** destroys the current renderer and opens a fresh copy of the loaded PDF bytes in a new worker. The file is read only when selected, then one unchanged source buffer stays in memory until a different file is selected or the viewer closes. This adds memory equal to the source PDF's size, about 348 MB for this drawing set. Browser compilation caches remain uncontrolled; this is not a controlled cold start. Only the selected page is rendered. There is no thumbnail queue, page-image cache, PNG encoding, SQLite or ingest/preparation step.

**Pixels ready** measures the whole action through drawing pixels to the canvas, including the release/reset call when reopening. `Worker.terminate()` does not wait for all browser memory reclamation. This is not measured screen presentation. **Page + render** includes selected-page acquisition, canvas sizing, renderer work, bitmap transfer and main-thread drawing. Compare this combined value across engines: PDFium loads its page during the size lookup, while Hayro reads sizes gathered during document open.

The phase line separates release/reset, file read, adapter import, engine open, page lookup and the render task. For WASM, **Worker init** includes worker startup, module loading and WASM initialization; **PDF open** includes source copying, parsing and document metadata. These are breakdowns _within_ Engine open. **Worker compute**, **Bitmap** and **Other overhead** break down the Render task; they are not additional time to add to that task. Other overhead includes canvas sizing, message scheduling/transfer, main-thread drawing and work outside the worker timers. Render again and page/resolution changes report only their own work, with no stale open timings.

**Frame callback wait** observes two animation-frame callbacks separately, after pixels are ready. It never keeps the controls disabled or inflates Pixels ready. A delayed or throttled callback can remain pending. It does not prove when the GPU displayed the page. Each result records tab visibility at start/readiness and at the callbacks when they run.

The input stages are **File read (once)** on initial file selection and **Input copy** for every new renderer/worker. Reopen and engine switching reuse the same cached source bytes and omit another file read. Exports mark these opens with `inputCached: true`. The initial read is still included in that selection's Pixels ready total. Select the file again or reload the viewer to measure another file read.

**Save timings** downloads the last 50 actions as JSON, including each file's name/size, renderer, page, actual pixel dimensions, requested resolution, viewport/DPR, phase timings and visibility. The same records are available in the console as `pdfRendererRuns`. These are local observations, not controlled benchmark results. Keep page, resolution, viewport and browser the same when comparing and examine several runs. Engines can round dimensions differently by a pixel at the same scale. Vendor assets are still served with `no-store`, so fresh workers repeat local asset delivery even though browser compilation caches can remain warm.

PDF.js uses its standard parser worker and draws onto the page canvas. Hayro and PDFium each use a dedicated WASM worker and transfer a bitmap. This isolates ordinary library use; it does not reproduce Bluewing's two-worker PDF.js pipeline. Hayro's published demo renders to viewport size and uses SIMD where supported. Its fast first page should be compared at matching pixel dimensions before drawing conclusions about 200 DPI preparation.

PDFium uses the exported `PDFiumModule` from pinned `@hyzyla/pdfium` 3.0.0. The adapter calls PDFium directly so output dimensions match the viewer's requested canvas and the render flags explicitly exclude LCD text smoothing. Output is full-color RGBA on white, with non-widget annotations enabled and display intent. The selected page stays loaded between its size lookup and raster, then closes. Closing/switching terminates the worker and releases the whole WASM heap, including the source PDF. Password entry and interactive forms are outside this sample's scope. This is a WASM comparison, not the earlier native PDFium measurement.

## Swap a renderer

Add a module under `renderers/` exporting `open(bytes)`, then register its lazy import in `renderers/index.mjs`. The contract is deliberately small:

```js
export async function open(bytes) {
  return {
    pageCount: 1,
    async pageSize(number) {
      return { width: 612, height: 792 };
    },
    async render(number, scale, canvas) {
      /* Draw the requested page. */
    },
    async destroy() {
      /* Release document/worker resources. */
    },
  };
}
```

Page numbers start at one; sizes use PDF points (72 per inch). The adapter may take ownership of the input buffer. The viewer serializes open/render calls and releases the previous engine before switching. Adapters can use JS, WASM or a separate local native service without changing the viewer or Bluewing.

Hayro assets are downloaded once into ignored `tmp/pdf-renderer-sample-vendor/hayro`, with source URLs, hashes and upstream notices. Nothing is fetched from a third party while opening PDFs after setup. The published build is SIMD-only here; a browser with WASM SIMD support is required. The module/assets are experimental and remain outside the product build. Sources: [PDF.js examples](https://mozilla.github.io/pdf.js/examples/), [Hayro demo](https://laurenzv.github.io/hayro/), [Hayro implementation](https://github.com/LaurenzV/hayro/blob/main/hayro-demo/src/lib.rs).

PDFium assets are downloaded once into ignored `tmp/pdf-renderer-sample-vendor/pdfium/3.0.0`, with exact package URLs, SHA-256 hashes and the package license. Setup does not install or modify root dependencies. The adapter, downloaded JS and WASM are served locally; PDF bytes are transferred only to the local worker. Sources: [browser package](https://github.com/hyzyla/pdfium), [PDFium rendering API](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdfview.h).

## Verification, October 16, 2026

Targeted ESLint, Prettier and `git diff --check` passed. Browser checks used the guarded sample server: both engines opened the assessment fixture, a two-page highlighted Bingham plan and the 347.9 MB / 165-page Bingham drawing set. Checked page navigation, engine switching with page/resolution preserved, reopening and CSS zoom without another raster. Both engines displayed drawing page 104 at 200 DPI, with no browser console errors or failed requests. This was functional verification, not a full visual-fidelity review or controlled performance benchmark. Bluewing/native suites were not rerun for these isolated sample files.

One observation on drawing page 104: PDF.js raster was 2,671 ms at 8,401 × 6,001 pixels; Hayro raster was 1,565 ms at 8,400 × 6,000 pixels. These are single observations in one browser session, including each adapter's drawing/bitmap-transfer work. They do not establish a whole-document ingest result.

Read-only source review used Banana Split's configured `default` tier with no tier changes. One root reviewer (`agt_8b2bcf06-e499-4824-87c7-f6c04a75d6e3`) ran with the `default-judgment` preset, resolved GPT-6.1 Sol/high; the observed model was GPT-6.1 Sol, with reasoning effort not separately reported. Zero child agents ran. The host used GPT-6.1 Sol/xhigh. Workflow `wf_db294004-426d-4b03-8c38-9d0956d2d63c` completed with a successful root result. Its timing finding was fixed: the read/open clock now starts after destroying the previous engine. An initial review start with an explicit network override was rejected as permission widening and created no agent; the review ran without that override. The completed workflow reported zero managed-tool rejections, turns without disposition, formal revisions and acceptances. No review edits, heavy jobs, escalations or unresolved findings remained.

## PDFium verification, October 20, 2026

Setup and its cached rerun completed. Targeted ESLint, Prettier and `git diff --check` passed. Guarded Chromium checks covered the assessment fixture at Fit screen and 200 DPI, both pages of the highlighted Bingham plan, and pages 104/105 of the 347.9 MB / 165-page drawing set at 200 DPI. Switching through PDF.js, Hayro and PDFium preserved page and resolution. Reopen worked; changing CSS zoom left canvas dimensions and raster timings unchanged. A malformed PDF reported an error and the next valid document opened successfully. The black/white assessment image had 13,252 nonwhite pixels and zero pixels whose RGB channels differed by more than two at 200 DPI, checking the text-fringe regression. The final viewer snapshot showed drawing content, no console errors, no failed requests and no off-origin requests.

PDFium's first observed page-load plus raster time was 1.742 seconds for drawing page 104 and 2.609 seconds for page 105, including bitmap transfer/drawing in the raster interval. A later reopen/render of page 105 took 2.941 seconds for those stages. These are single browser observations with OS/browser caches and varying machine load, not controlled throughput results or the earlier native PDFium benchmark. Full-set preparation, comprehensive fidelity, other browsers and native webviews were not tested. Bluewing's application suites were not rerun for this isolated sample addition.

The Banana Split review start and runtime-list call both returned `runtime_unavailable: connect ECONNREFUSED 127.0.0.1:43891`; no workflow or root agent started, and runtime configuration/tier/diagnostics could not be read. The fallback was one T3-owned Codex/GPT-6.1 Sol read-only child with inherited settings, reasoning effort not separately reported, and no descendants. Task `node:delegated-task:command%3Amcp%3Ab1efb330-cf6c-4101-9d63-77aacab4658f%3Adelegate-task%3Apdfium-sample-review-2026-10-20-1` completed with no findings. It inspected APIs, resources, dimensions, flags, timing boundaries and asset paths; it made no edits and did not repeat host browser checks. The host used GPT-6.1 Sol/xhigh. No review revisions or unresolved findings remained.

## Reopen timing investigation, October 20, 2026

The user reported intermittent 7-second versus 2-second Reopen results with both WASM engines. The 7-second outlier was not reproduced. On drawing page 105 at 200 DPI, three original PDFium `Open → display` readings were 1.903/1.909/1.972 seconds; Hayro readings were 2.768–2.851 seconds. Those old totals mixed worker/document setup and rendering with a two-frame callback wait, while excluding release/reset. They were not pure rendering measurements or measured presentation. The earlier figures above retain those historical definitions.

The revised timer includes release/reset in Pixels ready, separates the frame callback observation, splits WASM worker initialization from PDF opening, and records worker computation/bitmap creation inside the render interval. Redundant same-size canvas resets were removed. Only the latest idle action can update its displayed frame result; late callbacks cannot restore older timings during a new reopen. Vendor `no-store` and fresh-worker behavior remain explicit, and browser/OS caches and memory reclamation are uncontrolled.

Three revised PDFium repeats on that same page measured 1.825–1.908 seconds to pixels ready; Hayro measured 2.885–3.131 seconds. Worker computation occupied most of those runs; frame callbacks added roughly 0.1 seconds separately. These observations do not explain the user's 7-second run or establish whole-set throughput. The retained per-action stage breakdown is intended to identify the slow stage when an outlier occurs.

Targeted ESLint, Prettier and diff checks passed. Guarded browser verification exercised the large-plan repeats, both WASM adapters and PDF.js, JSON export payloads, and warm rendering without stale open metrics. A controlled fixture check withheld frame callbacks: pixels became ready in 10 ms and controls unlocked while the callbacks remained pending. Releasing them later updated their separate duration without changing the ready time. A second controlled check held a new reopen at its file read, released the previous action's delayed callbacks, and verified that its old timing panel remained cleared while the reopen was busy. Private measurements and review results are in ignored `tmp/pdf-renderer-reopen-2026-10-20/`. No application/native suites were rerun for these sample-only changes.

Two T3-owned read-only review children completed: investigation task suffix `reopen-timing-investigation-2026-10-20-1` and implementation task suffix `reopen-timing-fix-review-2026-10-20-2`, both under task prefix `node:delegated-task:command%3Amcp%3Ab1efb330-cf6c-4101-9d63-77aacab4658f%3Adelegate-task%3A`. Both used Codex/GPT-6.1 Sol with inherited settings and separately unreported reasoning effort; neither spawned descendants or edited files. The implementation review's one stale-frame display finding was fixed and checked with the controlled file-read test. The host used GPT-6.1 Sol/xhigh. Banana Split was unavailable earlier in this session, so no Banana tier or workflow ran for these reviews. The intermittent 7-second outlier remains an open observation, with no proven root cause yet.

## Uploaded timing capture and input reuse, October 20, 2026

The user's subsequent ten-run JSON capture identifies the dominant slow stage. Every run used the same 347,928,354-byte PDF and page 1. Five complete-file reads took 4.446–4.744 seconds, before the selected renderer opened the PDF; the three later PDFium reads took 0.209–0.222 seconds. At 200 DPI, PDF.js fresh reopen took 7.454 seconds with 4.619 seconds in Read and 2.788 seconds in Page + render. Hayro's fresh reopens took 6.695–6.758 seconds, with 4.446–4.638 seconds in Read and 1.876–1.962 seconds in Page + render. PDFium's later fresh reopens took 1.817–1.846 seconds, with about 0.22 seconds in Read and 1.475–1.513 seconds in Page + render. Frame callback waits were small in those reopen samples. This locates most of the extra delay in `File.arrayBuffer()`, including its browser scheduling/allocation costs; it does not isolate physical disk service time or prove why those reads varied. It was a whole-file read on each reopen/switch, not a read of the whole file on every page turn.

The sample now reads each selected file once, retains unchanged bytes, and copies them for each fresh worker because adapters can transfer/detach their input. Initial file-read and per-worker input-copy times remain explicit. This removes repeated file reads from engine comparisons while retaining the initial load cost; it does not speed up that first read or eliminate CPU/memory/scheduling variance. It also retains one additional source-sized buffer. Bluewing product code and root dependencies were not changed.

Lint and formatting passed. Browser verification used an instrumented `File.arrayBuffer()` counter: the 8.56 MB highlighted plan was read exactly once through PDFium → Hayro → PDF.js → PDFium and a further fresh reopen, all successfully rendered at 200 DPI. Cached opens contained Input copy and `inputCached: true`, with no repeated File read phase. Selecting the assessment fixture produced exactly the second read and `inputCached: false`. The current remote automation browser rejected the 348 MB upload with `Cannot transfer files larger than 50Mb to a browser not co-located with the server`, so the new source-buffer change was verified with the smaller real plan rather than claimed as a new large-plan pass. The user's supplied large-plan measurements establish the diagnosis independently of that automation limit.
