import { imageDimension, PAGE_PREVIEW_DIMENSION } from './image-resolution';
import { PdfiumDocument, PDFIUM_VERSION } from './pdfium-document';
import type { PdfiumSource } from './pdfium-source';
import type { SheetNameSuggestion } from './sheet-names';
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
type RenderRequest = Extract<PdfWorkerRequest, { type: 'render' }>;
interface RenderJob extends RenderRequest {
  cancelled: boolean;
  preempted: boolean;
  stage: 'queued' | 'drawing' | 'encoding';
  interrupt: (() => void) | undefined;
}
interface Operation {
  cancelled: boolean;
}
const jobs = new Map<number, RenderJob>();
const operations = new Map<number, Operation>();
const names = new Map<string, Promise<SheetNameSuggestion>>();
let pdf: PdfiumDocument | undefined;
let rangeTransport: PdfiumSource | undefined;
let active: RenderJob | undefined;
let opened = false;
let pumping = false;
let fatalError: Error | undefined;
const MAX_ENCODING_JOBS = 1;
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
    job.interrupt?.();
  }
  jobs.clear();
  // The client settles every pending RPC and terminates the worker.
  post({ type: 'fatal', error: errorDetails(error) });
}

function documentProxy(): PdfiumDocument {
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
  pdf = await PdfiumDocument.open(
    message.source,
    (rangeId, begin, end) => {
      post({ type: 'range', rangeId, begin, end });
    },
    (source) => {
      rangeTransport = source;
    },
    check,
  );
  check();
  post({
    type: 'ready',
    id: message.id,
    value: { numPages: pdf.numPages, version: PDFIUM_VERSION },
  });
}

async function importSheets(
  message: Extract<PdfWorkerRequest, { type: 'import' }>,
  check: () => void,
): Promise<void> {
  const sheets = await documentProxy().import(
    message.assetId,
    message.name,
    check,
  );
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
    pending = document.name(sheet, check);
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
  }
  const job = jobs.get(id);
  if (!job) return;
  job.cancelled = true;
  jobs.delete(id);
  job.interrupt?.();
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
    active.interrupt?.();
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
  let encodingOwnsCanvases = false;
  const interrupted = new Promise<never>((_resolve, reject) => {
    job.interrupt = () => {
      reject(abortError());
    };
  });
  void interrupted.catch(() => undefined);
  try {
    const { bounds } = job;
    const scale =
      (job.encode
        ? imageDimension(bounds, job.dimension)
        : Math.min(4096, Math.max(64, job.dimension))) /
      Math.max(bounds.width, bounds.height);
    canvas = await documentProxy().draw(
      job.sheet,
      bounds,
      scale,
      () => {
        checkJob(job);
      },
      (pending) => Promise.race([pending, interrupted]),
    );
    checkJob(job);
    const drawMs = performance.now() - started;
    if (job.encode && job.dimension > PAGE_PREVIEW_DIMENSION) {
      // Match the cache's dimensions without compounding full-raster rounding.
      const previewScale =
        PAGE_PREVIEW_DIMENSION / Math.max(bounds.width, bounds.height);
      preview = new OffscreenCanvas(
        Math.ceil(bounds.width * previewScale),
        Math.ceil(bounds.height * previewScale),
      );
      const context = preview.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('PDF preview context unavailable');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(canvas, 0, 0, preview.width, preview.height);
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
    if (job.encode) {
      job.stage = 'encoding';
      encodingOwnsCanvases = true;
      // PNG conversion runs off the UI thread and does not occupy the raster slot.
      void encode(job, canvas, preview, timings, started);
    } else jobs.delete(job.id);
  } finally {
    job.interrupt = undefined;
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
  // Control messages can change these fields while raster() yields.
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
      if (message.error !== undefined) fatal(new Error(message.error));
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
        interrupt: undefined,
      });
      preempt();
      void pump();
      break;
  }
});
