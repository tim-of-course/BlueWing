import {
  getDocument,
  PDFDataRangeTransport,
  PDFWorker,
  version,
} from 'pdfjs-dist';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import type { Sheet } from '../core/types';
import { suggestSheetName, type SheetNameSuggestion } from './sheet-names';
import {
  WorkerCanvasFactory,
  WorkerFilterFactory,
  workerAssetOptions,
  workerFontOwner,
} from './worker-adapters';
import type {
  PdfWorkerError,
  PdfWorkerRequest,
  PdfWorkerResponse,
  PdfWorkerTimings,
} from './worker-protocol';

// Use the existing DOM-only tsconfig without introducing conflicting worker libs.
interface RenderWorkerScope {
  postMessage(message: PdfWorkerResponse, transfer: Transferable[]): void;
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<PdfWorkerRequest>) => void,
  ): void;
}
const scope = globalThis as unknown as RenderWorkerScope;
const factory = new WorkerCanvasFactory();
type RenderRequest = Extract<PdfWorkerRequest, { type: 'render' }>;
interface RenderJob extends RenderRequest {
  cancelled: boolean;
  preempted: boolean;
  stage: 'queued' | 'drawing' | 'encoding';
  task: RenderTask | undefined;
}
interface Operation {
  cancelled: boolean;
}
const jobs = new Map<number, RenderJob>();
const operations = new Map<number, Operation>();
const names = new Map<string, Promise<SheetNameSuggestion>>();
let pdf: PDFDocumentProxy | undefined;
let loadingTask: PDFDocumentLoadingTask | undefined;
let rangeTransport: HostRanges | undefined;
let active: RenderJob | undefined;
let opened = false;
let pumping = false;
let fatalError: Error | undefined;
const MAX_ENCODING_JOBS = 2;
let encodingJobs = 0;

function post(message: PdfWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

function errorDetails(error: unknown): PdfWorkerError {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) };
}

function reportError(id: number, error: unknown): void {
  if (!fatalError) post({ type: 'error', id, error: errorDetails(error) });
}

function abortError(): DOMException {
  return new DOMException('PDF operation cancelled', 'AbortError');
}

function fatal(error: Error): void {
  if (fatalError) return;
  fatalError = error;
  for (const operation of operations.values()) operation.cancelled = true;
  for (const job of jobs.values()) {
    job.cancelled = true;
    job.task?.cancel();
  }
  jobs.clear();
  rangeTransport?.abort();
  // The client settles every pending RPC and terminates both sibling workers.
  post({ type: 'fatal', error: errorDetails(error) });
  void loadingTask?.destroy().catch(() => undefined);
}

class HostRanges extends PDFDataRangeTransport {
  private readonly pending = new Map<number, { begin: number; end: number }>();
  private nextId = 0;
  private stopped = false;

  constructor(length: number) {
    super(length, new Uint8Array(), true);
  }

  override requestDataRange(begin: number, end: number): void {
    if (this.stopped) return;
    const rangeId = ++this.nextId;
    this.pending.set(rangeId, { begin, end });
    post({ type: 'range', rangeId, begin, end });
  }

  override abort(): void {
    this.stopped = true;
    this.pending.clear();
  }

  receive(message: Extract<PdfWorkerRequest, { type: 'range-result' }>): void {
    const request = this.pending.get(message.rangeId);
    if (!request || this.stopped) return;
    this.pending.delete(message.rangeId);
    if (
      message.error !== undefined ||
      !message.bytes ||
      message.bytes.byteLength !== request.end - request.begin
    ) {
      fatal(new Error(message.error ?? 'Incomplete native PDF asset range'));
      return;
    }
    try {
      this.onDataRange(request.begin, message.bytes);
    } catch (error) {
      fatal(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

function documentProxy(): PDFDocumentProxy {
  if (fatalError) throw fatalError;
  if (!pdf) throw new Error('Open the PDF before requesting page operations');
  return pdf;
}

async function operation(
  id: number,
  run: (check: () => void) => Promise<void>,
): Promise<void> {
  const state: Operation = { cancelled: false };
  operations.set(id, state);
  const check = () => {
    if (fatalError) throw fatalError;
    if (state.cancelled) throw abortError();
  };
  try {
    check();
    await run(check);
  } catch (error) {
    if (!state.cancelled) reportError(id, error);
  } finally {
    operations.delete(id);
  }
}

async function open(
  message: Extract<PdfWorkerRequest, { type: 'open' }>,
  check: () => void,
): Promise<void> {
  if (opened) throw new Error('Each PDF requires a fresh render worker');
  opened = true;
  // Older releases silently omit RGB transfer maps when the SVG filter is none.
  if (version !== '6.4.299')
    throw new Error(`PDF worker requires PDF.js 6.4.299; loaded ${version}`);
  const owner = workerFontOwner();
  const assetOptions = workerAssetOptions(message.assetBaseUrl);
  message.parserPort.start();
  // An explicit real parser port bypasses window.location and fake-worker setup.
  // PDF.js types call the port a Worker; its port-backed runtime uses only
  // MessagePort methods and supports the host's transferred MessageChannel.
  const parser = PDFWorker.create({
    port: message.parserPort as unknown as Worker,
  });
  rangeTransport =
    'length' in message.source
      ? new HostRanges(message.source.length)
      : undefined;
  loadingTask = getDocument({
    ...(rangeTransport
      ? { range: rangeTransport }
      : 'bytes' in message.source
        ? { data: message.source.bytes }
        : {}),
    ...assetOptions,
    worker: parser,
    // PDF.js's declarations restrict these public seams to DOM types. At runtime
    // the native font loader reads only .fonts and the renderer uses canvas 2D.
    ownerDocument: owner as HTMLDocument,
    CanvasFactory: WorkerCanvasFactory,
    FilterFactory: WorkerFilterFactory,
    disableFontFace: false,
    disableAutoFetch: true,
    disableStream: true,
    rangeChunkSize: 256 * 1024,
  });
  try {
    pdf = await loadingTask.promise;
    check();
    post({
      type: 'ready',
      id: message.id,
      value: { numPages: pdf.numPages, version },
    });
  } catch (error) {
    if (!loadingTask.destroyed)
      void loadingTask.destroy().catch(() => undefined);
    throw error;
  }
}

async function importSheets(
  message: Extract<PdfWorkerRequest, { type: 'import' }>,
  check: () => void,
): Promise<void> {
  const document = documentProxy();
  const labels = await document.getPageLabels();
  check();
  const sheets: Sheet[] = [];
  for (let index = 0; index < document.numPages; index++) {
    const page = await document.getPage(index + 1);
    check();
    const viewport = page.getViewport({ scale: 1 });
    const transform = viewport.transform;
    sheets.push({
      id: crypto.randomUUID(),
      assetId: message.assetId,
      name: `${labels?.[index] ?? `Sheet ${String(index + 1)}`} · ${message.name.replace(/\.pdf$/i, '')}`,
      pageIndex: index,
      width: viewport.width,
      height: viewport.height,
      rotation: viewport.rotation,
      pdfToPage: [
        transform[0] ?? 1,
        transform[1] ?? 0,
        transform[2] ?? 0,
        transform[3] ?? 1,
        transform[4] ?? 0,
        transform[5] ?? 0,
      ],
    });
  }
  check();
  post({ type: 'result', id: message.id, value: sheets });
}

async function nameSheet(
  message: Extract<PdfWorkerRequest, { type: 'name' }>,
  check: () => void,
): Promise<void> {
  const document = documentProxy();
  const { sheet } = message;
  const key = `${String(sheet.pageIndex)}:${String(sheet.rotation ?? 0)}`;
  let pending = names.get(key);
  if (!pending) {
    pending = (async () => {
      const page = await document.getPage(sheet.pageIndex + 1);
      const viewport = page.getViewport({
        scale: 1,
        rotation: sheet.rotation ?? 0,
      });
      const text = await page.getTextContent();
      return suggestSheetName(
        text.items.filter((item) => 'str' in item),
        viewport,
      );
    })();
    names.set(key, pending);
    void pending.catch(() => names.delete(key));
  }
  const value = await pending;
  check();
  post({ type: 'result', id: message.id, value: { ...value } });
}

function cancel(id: number): void {
  const operation = operations.get(id);
  if (operation && !operation.cancelled) {
    operation.cancelled = true;
    reportError(id, abortError());
    if (!pdf) void loadingTask?.destroy().catch(() => undefined);
  }
  const job = jobs.get(id);
  if (!job) return;
  job.cancelled = true;
  jobs.delete(id);
  job.task?.cancel();
  // After raster delivery the host rejects only the outstanding encoded result.
  reportError(id, abortError());
}

function nextJob(): RenderJob | undefined {
  let next: RenderJob | undefined;
  for (const job of jobs.values()) {
    if (job.stage !== 'queued' || job.paused || job.cancelled) continue;
    if (!next || job.priority > next.priority) next = job;
  }
  return next;
}

function preempt(): void {
  if (
    !active ||
    active.cancelled ||
    active.preempted ||
    active.stage !== 'drawing'
  )
    return;
  const next = nextJob();
  // Compare against a different queued job. Promoting active work cannot cancel it.
  if (
    active.paused ||
    (next && next.id !== active.id && next.priority > active.priority)
  ) {
    active.preempted = true;
    active.task?.cancel();
  }
}

function checkJob(job: RenderJob): void {
  if (fatalError) throw fatalError;
  if (job.cancelled || job.preempted) throw abortError();
}

function releaseCanvas(canvas: OffscreenCanvas | undefined): void {
  if (canvas) canvas.width = canvas.height = 0;
}

async function encode(
  job: RenderJob,
  canvas: OffscreenCanvas,
  preview: OffscreenCanvas | undefined,
  timings: PdfWorkerTimings,
  started: number,
): Promise<void> {
  encodingJobs++;
  const encodingStarted = performance.now();
  try {
    checkJob(job);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    checkJob(job);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    checkJob(job);
    let previewBytes: Uint8Array | undefined;
    if (preview) {
      const previewBlob = await preview.convertToBlob({ type: 'image/png' });
      checkJob(job);
      previewBytes = new Uint8Array(await previewBlob.arrayBuffer());
      checkJob(job);
    }
    const transfer: Transferable[] = [bytes.buffer];
    if (previewBytes) transfer.push(previewBytes.buffer);
    post(
      {
        type: 'encoded',
        id: job.id,
        bytes,
        ...(previewBytes ? { previewBytes } : {}),
        timings: {
          ...timings,
          encodeMs: performance.now() - encodingStarted,
          totalMs: performance.now() - started,
        },
      },
      transfer,
    );
  } catch (error) {
    if (!job.cancelled) reportError(job.id, error);
  } finally {
    releaseCanvas(canvas);
    releaseCanvas(preview);
    jobs.delete(job.id);
    encodingJobs--;
    void pump();
  }
}

async function raster(job: RenderJob): Promise<void> {
  const started = performance.now();
  let canvas: OffscreenCanvas | undefined;
  let preview: OffscreenCanvas | undefined;
  let bitmap: ImageBitmap | undefined;
  let previewBitmap: ImageBitmap | undefined;
  let page: PDFPageProxy | undefined;
  let encodingOwnsCanvases = false;
  const continuation = new MessageChannel();
  let resume: (() => void) | undefined;
  continuation.port1.onmessage = () => {
    const next = resume;
    resume = undefined;
    if (!job.cancelled && !job.preempted) next?.();
  };
  try {
    page = await documentProxy().getPage(job.sheet.pageIndex + 1);
    checkJob(job);
    const { bounds } = job;
    const scale =
      Math.min(4096, Math.max(64, job.dimension)) /
      Math.max(bounds.width, bounds.height);
    const viewport = page.getViewport({
      scale,
      rotation: job.sheet.rotation ?? 0,
      offsetX: -bounds.x * scale,
      offsetY: -bounds.y * scale,
    });
    // Let PDF.js create its opaque page context, as in its DOM renderer.
    // Scratch canvases retain alpha for masks and transparency groups.
    canvas = new OffscreenCanvas(
      Math.ceil(bounds.width * scale),
      Math.ceil(bounds.height * scale),
    );
    job.task = page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport,
      // Display intent preserves visible annotations and layer settings. PDF.js
      // uses microtasks in a real worker; our continuation yields to controls.
      intent: 'display',
    });
    job.task.onContinue = (next: () => void) => {
      resume = next;
      // Yield to pause, priority and cancellation messages between drawing chunks.
      continuation.port2.postMessage(null);
    };
    await job.task.promise;
    job.task = undefined;
    checkJob(job);
    const drawMs = performance.now() - started;
    if (job.dimension === 3300) {
      // Match the cache's dimensions without compounding full-raster rounding.
      const previewScale = 640 / Math.max(bounds.width, bounds.height);
      const entry = factory.create(
        Math.ceil(bounds.width * previewScale),
        Math.ceil(bounds.height * previewScale),
      );
      preview = entry.canvas;
      entry.context.drawImage(canvas, 0, 0, preview.width, preview.height);
    }
    // Snapshot without consuming the canvas: encoding still needs its pixels.
    bitmap = await createImageBitmap(canvas);
    checkJob(job);
    if (preview) {
      previewBitmap = await createImageBitmap(preview);
      checkJob(job);
    }
    const timings: PdfWorkerTimings = {
      thread: 'worker',
      drawMs,
      resizeMs: performance.now() - started - drawMs,
      encodeMs: 0,
      totalMs: performance.now() - started,
    };
    const transfer: Transferable[] = [bitmap];
    if (previewBitmap) transfer.push(previewBitmap);
    post(
      {
        type: 'raster',
        id: job.id,
        bitmap,
        ...(previewBitmap ? { previewBitmap } : {}),
        timings,
      },
      transfer,
    );
    bitmap = previewBitmap = undefined;
    job.stage = 'encoding';
    encodingOwnsCanvases = true;
    // PNG conversion runs off the UI thread and does not occupy the raster slot.
    void encode(job, canvas, preview, timings, started);
  } finally {
    page?.cleanup();
    continuation.port1.close();
    continuation.port2.close();
    job.task = undefined;
    resume = undefined;
    bitmap?.close();
    previewBitmap?.close();
    if (!encodingOwnsCanvases) {
      releaseCanvas(canvas);
      releaseCanvas(preview);
    }
  }
}

async function pump(): Promise<void> {
  if (pumping || fatalError) return;
  pumping = true;
  try {
    let job: RenderJob | undefined;
    // Cancelled encoders retain their slot until convertToBlob releases pixels.
    // Bound canvas memory while delivering each raster before its own PNG work.
    while (encodingJobs < MAX_ENCODING_JOBS && (job = nextJob())) {
      active = job;
      job.preempted = false;
      job.stage = 'drawing';
      try {
        await raster(job);
      } catch (error) {
        recoverRaster(job, error);
      } finally {
        active = undefined;
      }
    }
  } finally {
    pumping = false;
  }
}

function recoverRaster(job: RenderJob, error: unknown): void {
  // Control messages can change these fields while raster() awaits PDF.js.
  if (job.preempted && !job.cancelled && !fatalError) {
    job.stage = 'queued';
  } else {
    jobs.delete(job.id);
    if (!job.cancelled) reportError(job.id, error);
  }
}

scope.addEventListener('message', ({ data: message }) => {
  switch (message.type) {
    case 'range-result':
      rangeTransport?.receive(message);
      break;
    case 'cancel':
      cancel(message.id);
      break;
    case 'pause': {
      const job = jobs.get(message.id);
      if (job) job.paused = message.paused;
      preempt();
      void pump();
      break;
    }
    case 'priority': {
      const job = jobs.get(message.id);
      if (job) job.priority = message.priority;
      preempt();
      void pump();
      break;
    }
    case 'open':
      void operation(message.id, (check) => open(message, check));
      break;
    case 'import':
      void operation(message.id, (check) => importSheets(message, check));
      break;
    case 'name':
      void operation(message.id, (check) => nameSheet(message, check));
      break;
    case 'render':
      if (!pdf || fatalError) {
        reportError(
          message.id,
          fatalError ?? new Error('Open the PDF before rendering'),
        );
        break;
      }
      jobs.set(message.id, {
        ...message,
        cancelled: false,
        preempted: false,
        stage: 'queued',
        task: undefined,
      });
      preempt();
      void pump();
      break;
  }
});
