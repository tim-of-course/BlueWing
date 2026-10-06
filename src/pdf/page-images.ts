import type { Sheet } from '../core/types';

export const PAGE_IMAGE_DIMENSION = 3300;
export const PAGE_PREVIEW_DIMENSION = 640;

export interface PageImageStore {
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, bytes: Uint8Array): Promise<void>;
  exists(key: string): Promise<boolean>;
}
type RenderPage = (
  sheet: Sheet,
  dimension: number,
  signal: AbortSignal,
  paused: () => boolean,
) => Promise<HTMLCanvasElement>;
interface ImageEntry {
  canvas: HTMLCanvasElement;
  preview: boolean;
}
interface ImageJob {
  abort: AbortController;
  users: number;
  background: boolean;
  done: boolean;
  promise: Promise<ImageEntry>;
  saved: Promise<void>;
}

// Immutable asset IDs survive moving/copying the project. Metadata and takeoff
// edits do not change source pixels. Bump the renderer tag if PDF output changes.
export function pageImageKey(sheet: Sheet, dimension: number): string {
  return JSON.stringify([
    'pdfjs-6.3.289-print-v1',
    sheet.assetId,
    sheet.pageIndex,
    sheet.rotation ?? 0,
    sheet.width,
    sheet.height,
    Math.min(4096, Math.max(64, dimension)),
  ]);
}
function size(sheet: Sheet, dimension: number) {
  const scale = dimension / Math.max(sheet.width, sheet.height);
  return {
    width: Math.ceil(sheet.width * scale),
    height: Math.ceil(sheet.height * scale),
  };
}
function copy(
  source: HTMLCanvasElement,
  dimensions: { width: number; height: number } = source,
) {
  const canvas = document.createElement('canvas');
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}
function release(entry: ImageEntry) {
  entry.canvas.width = entry.canvas.height = 0;
}
async function decode(
  bytes: Uint8Array,
  dimensions: { width: number; height: number },
) {
  const url = URL.createObjectURL(
    new Blob([bytes.slice().buffer], { type: 'image/png' }),
  );
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    if (
      image.naturalWidth !== dimensions.width ||
      image.naturalHeight !== dimensions.height
    )
      throw new Error('Cached page dimensions changed');
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(image, 0, 0);
    return canvas;
  } finally {
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cancel = () => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException('PDF rendering was cancelled', 'AbortError'),
      );
    };
    signal.addEventListener('abort', cancel, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', cancel);
    });
  });
}

/** Owns immutable PDF rasters. Callers receive their own canvas and may dispose it. */
export class PageImages {
  private readonly images = new Map<string, ImageEntry>();
  private readonly jobs = new Map<string, ImageJob>();
  private readonly prepared = new Set<string>();
  private queue: Sheet[] = [];
  private backgroundRunning = false;
  private foreground = 0;
  private suspended = false;
  private notBefore = 0;
  private epoch = 0;
  private cancelScheduled: (() => void) | undefined;

  constructor(
    private readonly renderPage: RenderPage,
    private readonly store?: PageImageStore,
    private readonly memoryBytes = 256 * 1024 * 1024,
    private readonly previewBytes = 32 * 1024 * 1024,
  ) {}

  async render(
    sheet: Sheet,
    dimension = 2400,
    signal?: AbortSignal,
  ): Promise<HTMLCanvasElement> {
    signal?.throwIfAborted();
    dimension = Math.min(4096, Math.max(64, dimension));
    const key = pageImageKey(sheet, dimension);
    this.deferPreparation();
    const cached = this.images.get(key);
    if (cached) {
      this.images.delete(key);
      this.images.set(key, cached);
      return copy(cached.canvas);
    }
    this.foreground++;
    const job = this.job(sheet, dimension, false);
    job.users++;
    try {
      const entry = await waitFor(job.promise, signal);
      signal?.throwIfAborted();
      job.abort.signal.throwIfAborted();
      return copy(entry.canvas);
    } finally {
      job.users--;
      this.foreground--;
      if (!job.users && !job.background && !job.done) job.abort.abort();
      this.finish(key, job);
      this.schedule();
    }
  }

  /** Nearby sheets first, then every remaining page. Only one background job. */
  prepare(sheets: Sheet[], activeId: string | null, suspended = false) {
    this.suspended = suspended;
    const ordered = [...sheets].sort(
      (a, b) => (a.order ?? a.pageIndex) - (b.order ?? b.pageIndex),
    );
    const index = Math.max(
      0,
      ordered.findIndex((sheet) => sheet.id === activeId),
    );
    const unique = new Map<string, Sheet>();
    ordered
      .map((sheet, position) => ({
        sheet,
        distance: Math.abs(position - index),
      }))
      .sort((a, b) => a.distance - b.distance)
      .forEach(({ sheet }) => {
        const key = pageImageKey(sheet, PAGE_IMAGE_DIMENSION);
        if (!this.prepared.has(key)) unique.set(key, sheet);
      });
    this.queue = [...unique.values()];
    this.deferPreparation();
  }

  deferPreparation() {
    this.notBefore = performance.now() + 750;
    this.cancelScheduled?.();
    this.cancelScheduled = undefined;
    this.schedule();
  }

  clear() {
    this.epoch++;
    this.cancelScheduled?.();
    this.cancelScheduled = undefined;
    this.queue = [];
    this.prepared.clear();
    for (const job of this.jobs.values()) job.abort.abort();
    this.jobs.clear();
    for (const entry of this.images.values()) release(entry);
    this.images.clear();
    // Disposable disk images deliberately remain in the OS temporary directory.
  }

  private job(sheet: Sheet, dimension: number, background: boolean) {
    const key = pageImageKey(sheet, dimension);
    const existing = this.jobs.get(key);
    if (existing && !existing.abort.signal.aborted) return existing;
    const job: ImageJob = {
      abort: new AbortController(),
      users: 0,
      background,
      done: false,
      promise: undefined as unknown as Promise<ImageEntry>,
      saved: Promise.resolve(),
    };
    this.jobs.set(key, job);
    job.promise = Promise.resolve()
      .then(() => this.load(sheet, dimension, job))
      .finally(() => {
        job.done = true;
        this.finish(key, job);
      });
    return job;
  }

  private async load(
    sheet: Sheet,
    dimension: number,
    job: ImageJob,
  ): Promise<ImageEntry> {
    const key = pageImageKey(sheet, dimension);
    const signal = job.abort.signal;
    signal.throwIfAborted();
    let canvas: HTMLCanvasElement | undefined;
    let diskHit = false;
    try {
      if (this.store) {
        try {
          const bytes = await this.store.read(key);
          signal.throwIfAborted();
          if (bytes) {
            canvas = await decode(bytes, size(sheet, dimension));
            diskHit = true;
          }
        } catch {
          // The OS may remove temp files at any time; corrupt/failed reads are misses.
        }
      }
      signal.throwIfAborted();
      if (!canvas && dimension <= PAGE_PREVIEW_DIMENSION) {
        const full = this.images.get(pageImageKey(sheet, PAGE_IMAGE_DIMENSION));
        if (full) canvas = copy(full.canvas, size(sheet, dimension));
      }
      canvas ??= await this.renderPage(
        sheet,
        dimension,
        signal,
        () => job.background && !job.users && this.paused(),
      );
      signal.throwIfAborted();
      const entry = { canvas, preview: dimension <= PAGE_PREVIEW_DIMENSION };
      this.put(key, entry, job.background && !job.users);
      const saves = [diskHit ? Promise.resolve() : this.save(key, canvas)];
      if (dimension === PAGE_IMAGE_DIMENSION) {
        const previewKey = pageImageKey(sheet, PAGE_PREVIEW_DIMENSION);
        if (!this.images.has(previewKey) && !this.jobs.has(previewKey)) {
          const preview = copy(canvas, size(sheet, PAGE_PREVIEW_DIMENSION));
          this.put(previewKey, { canvas: preview, preview: true }, true);
          saves.push(this.save(previewKey, preview));
        }
      }
      job.saved = Promise.all(saves).then(() => undefined);
      return entry;
    } catch (error) {
      if (canvas) canvas.width = canvas.height = 0;
      throw error;
    }
  }

  private async save(key: string, canvas: HTMLCanvasElement) {
    if (!this.store) return;
    try {
      // toBlob snapshots now; encoding and disk writes do not delay the viewer.
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/png');
      });
      if (blob)
        await this.store.write(key, new Uint8Array(await blob.arrayBuffer()));
    } catch {
      // Cache writes are optional. A full/read-only disk must not break the plan.
    }
  }

  private put(key: string, entry: ImageEntry, background: boolean) {
    const previousEntry = this.images.get(key);
    if (previousEntry) {
      this.images.delete(key);
      release(previousEntry);
    }
    if (background) {
      const previous = [...this.images];
      this.images.clear();
      this.images.set(key, entry);
      for (const [id, image] of previous) this.images.set(id, image);
    } else this.images.set(key, entry);
  }

  private finish(key: string, job: ImageJob) {
    if (job.done && !job.users && this.jobs.get(key) === job)
      this.jobs.delete(key);
    for (const preview of [false, true]) {
      let bytes = [...this.images.values()]
        .filter((entry) => entry.preview === preview)
        .reduce(
          (total, entry) =>
            total + entry.canvas.width * entry.canvas.height * 4,
          0,
        );
      const budget = preview ? this.previewBytes : this.memoryBytes;
      for (const [id, entry] of this.images) {
        if (bytes <= budget) break;
        if (entry.preview !== preview || this.jobs.has(id)) continue;
        bytes -= entry.canvas.width * entry.canvas.height * 4;
        this.images.delete(id);
        release(entry);
      }
    }
  }

  private paused() {
    return (
      this.suspended ||
      this.foreground > 0 ||
      performance.now() < this.notBefore
    );
  }

  private schedule() {
    if (
      this.backgroundRunning ||
      this.foreground ||
      this.suspended ||
      this.cancelScheduled ||
      !this.queue.length
    )
      return;
    const timer = setTimeout(
      () => {
        this.cancelScheduled = undefined;
        if (typeof requestIdleCallback === 'function') {
          const idle = requestIdleCallback(
            () => {
              this.cancelScheduled = undefined;
              void this.next();
            },
            { timeout: 1000 },
          );
          this.cancelScheduled = () => {
            cancelIdleCallback(idle);
          };
        } else void this.next();
      },
      Math.max(32, this.notBefore - performance.now()),
    );
    this.cancelScheduled = () => {
      clearTimeout(timer);
    };
  }

  private async next() {
    if (this.paused()) {
      this.schedule();
      return;
    }
    const sheet = this.queue.shift();
    if (!sheet) return;
    const epoch = this.epoch;
    const key = pageImageKey(sheet, PAGE_IMAGE_DIMENSION);
    const previewKey = pageImageKey(sheet, PAGE_PREVIEW_DIMENSION);
    this.backgroundRunning = true;
    try {
      const inMemory = this.images.has(key) && this.images.has(previewKey);
      const onDisk =
        !inMemory &&
        this.store &&
        (await this.store.exists(key).catch(() => false)) &&
        (await this.store.exists(previewKey).catch(() => false));
      if (epoch !== this.epoch) return;
      if (!inMemory && !onDisk) {
        const job = this.job(sheet, PAGE_IMAGE_DIMENSION, true);
        await job.promise;
        await job.saved;
      }
      if (epoch === this.epoch) this.prepared.add(key);
    } catch {
      // One bad page must not stop preparing the rest of the document.
    } finally {
      this.backgroundRunning = false;
      this.schedule();
    }
  }
}
