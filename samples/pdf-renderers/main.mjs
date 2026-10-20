/* global document, window, performance, requestAnimationFrame, ResizeObserver, Blob, URL, setTimeout */
import { renderers } from './renderers/index.mjs';

const byId = (id) => document.getElementById(id);
const controls = byId('controls');
const canvas = byId('canvas');
const viewport = byId('viewport');
const status = byId('status');
const renderer = byId('renderer');
const pageInput = byId('page');
const resolution = byId('resolution');
const zoom = byId('zoom');
let file;
let sourceBytes;
let pdf;
let size;
let busy = false;
const runs = [];
globalThis.pdfRendererRuns = runs;
const ms = (n) => `${n.toFixed(1)} ms`;

function showTiming(run) {
  const describe = (phases) =>
    Object.entries(phases || {})
      .map(([name, time]) => `${name} ${ms(time)}`)
      .join(' | ');
  const details = [];
  if (run.openDetails)
    details.push(`Within Engine open: ${describe(run.openDetails)}`);
  if (run.renderDetails)
    details.push(`Within Render task: ${describe(run.renderDetails)}`);
  byId('timings').textContent =
    `#${run.id} ${run.action} | Pixels ready ${ms(run.totalMs)} | Page + render ${ms(run.pageAndRenderMs)} | ${run.width} × ${run.height} px | ${run.dpi.toFixed(1)} DPI\n` +
    describe(run.phases) +
    (details.length ? `\n${details.join(' ; ')}` : '') +
    `\nFrame callback wait ${run.frameCallbackMs === null ? 'pending' : ms(run.frameCallbackMs)} (not screen presentation)`;
}

renderers.forEach((engine, index) => {
  const option = document.createElement('option');
  option.value = String(index);
  option.textContent = engine.name;
  renderer.append(option);
});

function fitScale() {
  return Math.min(
    (viewport.clientWidth - 40) / size.width,
    (viewport.clientHeight - 40) / size.height,
  );
}
function displaySize() {
  if (!size) return;
  const scale = (fitScale() * Number(zoom.value)) / 100;
  canvas.style.width = `${size.width * scale}px`;
  canvas.style.height = `${size.height * scale}px`;
  byId('zoom-label').textContent = `${zoom.value}%`;
}
function updateControls() {
  controls.disabled = busy;
  pageInput.disabled = !pdf;
  byId('previous').disabled = !pdf || Number(pageInput.value) <= 1;
  byId('next').disabled = !pdf || Number(pageInput.value) >= pdf.pageCount;
  byId('render').disabled = byId('reopen').disabled = !pdf;
  byId('save-timings').disabled = runs.length === 0;
}
async function work(action, name) {
  if (busy) return;
  const started = performance.now();
  const run = {
    id: (runs.at(-1)?.id || 0) + 1,
    action: name,
    timestamp: new Date().toISOString(),
    file: {
      name: file?.name,
      bytes: file?.size,
      lastModified: file?.lastModified,
    },
    renderer: renderers[Number(renderer.value)].name,
    resolution: resolution.value,
    viewport: {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
      dpr: window.devicePixelRatio,
    },
    visibilityStart: document.visibilityState,
    phases: {},
    frameCallbackMs: null,
  };
  busy = true;
  updateControls();
  status.dataset.error = 'false';
  try {
    Object.assign(run, await action());
    run.totalMs = performance.now() - started;
    run.visibilityReady = document.visibilityState;
    showTiming(run);
    // Frame scheduling is separate from renderer readiness, so a background tab
    // cannot inflate the ready time or leave the controls locked waiting on RAF.
    const ready = performance.now();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        run.frameCallbackMs = performance.now() - ready;
        run.visibilityFrame = document.visibilityState;
        if (!busy && runs.at(-1) === run) showTiming(run);
      }),
    );
  } catch (error) {
    status.textContent = String(error);
    status.dataset.error = 'true';
    run.error = String(error);
    run.totalMs = performance.now() - started;
    byId('timings').textContent = `Failed after ${ms(run.totalMs)}`;
  } finally {
    runs.push(run);
    if (runs.length > 50) runs.shift();
    busy = false;
    updateControls();
  }
}
async function draw() {
  const start = performance.now();
  const number = Math.max(
    1,
    Math.min(pdf.pageCount, Math.trunc(Number(pageInput.value)) || 1),
  );
  pageInput.value = String(number);
  status.textContent = `Rendering page ${number}…`;
  size = await pdf.pageSize(number);
  const acquired = performance.now();
  const scale =
    resolution.value === 'fit'
      ? fitScale() * window.devicePixelRatio
      : Number(resolution.value) / 72;
  const width = Math.ceil(size.width * scale);
  const height = Math.ceil(size.height * scale);
  // Keep an oversized roll drawing from allocating an unbounded canvas.
  if (width * height > 100_000_000 || Math.max(width, height) > 16384) {
    throw new Error(
      'This resolution exceeds 100 MP or 16,384 pixels per side. Choose Fit screen.',
    );
  }
  const rasterStart = performance.now();
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const details = await pdf.render(number, scale, canvas);
  const rendered = performance.now();
  if (details)
    details['Other overhead'] = Math.max(
      0,
      rendered - rasterStart - details['Worker compute'] - details.Bitmap,
    );
  canvas.hidden = false;
  displaySize();
  status.textContent = `${file.name} · ${renderers[Number(renderer.value)].name} · page ${number} of ${pdf.pageCount}`;
  return {
    page: number,
    width: canvas.width,
    height: canvas.height,
    dpi: scale * 72,
    pageAndRenderMs: rendered - start,
    phases: { Page: acquired - start, 'Render task': rendered - rasterStart },
    renderDetails: details,
  };
}
async function reopen() {
  if (!file) return;
  const releaseStart = performance.now();
  status.textContent = 'Opening PDF…';
  byId('timings').textContent = '';
  canvas.hidden = true;
  canvas.width = canvas.height = 0;
  await pdf?.destroy();
  pdf = undefined;
  size = undefined;
  const start = performance.now();
  const inputCached = sourceBytes !== undefined;
  if (!inputCached) sourceBytes = new Uint8Array(await file.arrayBuffer());
  const read = performance.now();
  // Adapters may transfer/detach their input. Keep one unchanged master and
  // give each fresh worker a copy instead of timing another file read.
  const bytes = sourceBytes.slice();
  const copied = performance.now();
  const module = await renderers[Number(renderer.value)].load();
  const loaded = performance.now();
  pdf = await module.open(bytes);
  const opened = performance.now();
  pageInput.max = String(pdf.pageCount);
  byId('pages').textContent = `/ ${pdf.pageCount}`;
  const result = await draw();
  result.phases = {
    'Release call': start - releaseStart,
    ...(!inputCached ? { 'File read (once)': read - start } : {}),
    'Input copy': copied - read,
    'Adapter import': loaded - copied,
    'Engine open': opened - loaded,
    ...result.phases,
  };
  result.inputCached = inputCached;
  result.openDetails = pdf.openTimings;
  return result;
}

byId('file').onchange = (event) => {
  file = event.target.files[0];
  sourceBytes = undefined;
  pageInput.value = '1';
  if (file) void work(reopen, 'Open file');
};
renderer.onchange = () => {
  if (file) void work(reopen, 'Switch renderer');
};
byId('reopen').onclick = () => void work(reopen, 'Fresh worker + reopen');
byId('render').onclick = () => void work(draw, 'Render current document');
resolution.onchange = () => {
  if (pdf) void work(draw, 'Change resolution');
};
pageInput.onchange = () => void work(draw, 'Change page');
byId('previous').onclick = () => {
  pageInput.value = String(Number(pageInput.value) - 1);
  void work(draw, 'Previous page');
};
byId('next').onclick = () => {
  pageInput.value = String(Number(pageInput.value) + 1);
  void work(draw, 'Next page');
};
byId('save-timings').onclick = () => {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          { schema: 1, userAgent: window.navigator.userAgent, runs },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    ),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'pdf-renderer-timings.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
zoom.oninput = displaySize;
new ResizeObserver(displaySize).observe(viewport);
updateControls();
