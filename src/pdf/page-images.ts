import type { Sheet } from '../core/types';
import type { RasterImage } from './worker-protocol';
import { RasterResource, type RasterLease } from './raster';
import { ImageDecoder } from './image-decoder';
import type { PerformanceRecorder } from '../performance/recorder';

export const PAGE_IMAGE_DIMENSION = 3300;
export const PAGE_PREVIEW_DIMENSION = 640;
export const PAGE_RENDERER_VERSION = 'pdfjs-6.4.299-display-worker-v2';
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
  priority: () => number,
) => Promise<RasterImage>;
interface ImageEntry {
  resource: RasterResource;
  preview: boolean;
  saved: Promise<boolean>;
}
interface ImageJob {
  abort: AbortController;
  users: number;
  background: boolean;
  done: boolean;
  promise: Promise<{ entry: ImageEntry; preview?: ImageEntry }>;
  saved: Promise<boolean>;
  resources: RasterResource[];
}
export interface PreparationStatus {
  total: number;
  completed: number;
  failed: number;
  running: boolean;
  paused: boolean;
}
export function pageImageKey(sheet: Sheet, dimension: number): string {
  return JSON.stringify([
    PAGE_RENDERER_VERSION,
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
function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cancel = () => {
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error('PDF rendering was cancelled'),
      );
    };
    signal.addEventListener('abort', cancel, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', cancel);
    });
  });
}

/** Shares immutable rasters, prioritizes visible work, and prepares disposable disk images. */
export class PageImages {
  private readonly images = new Map<string, ImageEntry>();
  private readonly jobs = new Map<string, ImageJob>();
  private readonly prepared = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly decoder = new ImageDecoder();
  private readonly listeners = new Set<() => void>();
  private queue: Sheet[] = [];
  private total = 0;
  private backgroundRunning = false;
  private foreground = 0;
  private suspended = false;
  private userPaused = false;
  private notBefore = 0;
  private epoch = 0;
  private cancelScheduled: (() => void) | undefined;
  constructor(
    private readonly renderPage: RenderPage,
    private readonly store?: PageImageStore,
    private readonly memoryBytes = 256 * 1024 * 1024,
    private readonly previewBytes = 32 * 1024 * 1024,
    private readonly recorder?: PerformanceRecorder,
  ) {}

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  status(): PreparationStatus {
    return {
      total: this.total,
      completed: this.prepared.size,
      failed: this.failed.size,
      running: this.backgroundRunning || this.queue.length > 0,
      paused: this.userPaused,
    };
  }
  setPreparationPaused(paused: boolean) {
    this.userPaused = paused;
    this.changed();
    this.schedule();
  }
  private changed() {
    this.recorder?.event('page.preparation', { ...this.status() });
    for (const listener of this.listeners) listener();
  }

  async acquire(
    sheet: Sheet,
    dimension = PAGE_IMAGE_DIMENSION,
    signal?: AbortSignal,
  ): Promise<RasterLease> {
    return this.request(sheet, dimension, signal, (entry) =>
      entry.resource.lease(),
    );
  }
  async preview(sheet: Sheet, signal?: AbortSignal): Promise<Uint8Array> {
    return this.request(
      sheet,
      PAGE_PREVIEW_DIMENSION,
      signal,
      (entry) => entry.resource.bytes,
    );
  }
  /** A loading placeholder never starts another PDF render. */
  peek(sheet: Sheet, dimension = PAGE_PREVIEW_DIMENSION): RasterLease | null {
    return (
      this.images.get(pageImageKey(sheet, dimension))?.resource.lease() ?? null
    );
  }
  /** Explicit callers needing editable pixels receive an owned canvas. Viewers use leases. */
  async render(
    sheet: Sheet,
    dimension = 2400,
    signal?: AbortSignal,
  ): Promise<HTMLCanvasElement> {
    const lease = await this.acquire(sheet, dimension, signal);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = lease.width;
      canvas.height = lease.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');
      context.drawImage(lease.source, 0, 0);
      return canvas;
    } finally {
      lease.release();
    }
  }
  private async request<T>(
    sheet: Sheet,
    dimension: number,
    signal: AbortSignal | undefined,
    use: (entry: ImageEntry) => T | Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted();
    dimension = Math.min(4096, Math.max(64, dimension));
    this.deferPreparation();
    const finish = this.recorder?.span('page.request', {
      pageId: sheet.id,
      dimension,
      purpose: dimension <= PAGE_PREVIEW_DIMENSION ? 'preview' : 'selected',
    });
    try {
      const key = pageImageKey(sheet, dimension),
        cached = this.images.get(key);
      if (cached) {
        this.images.delete(key);
        this.images.set(key, cached);
        this.recorder?.event('page.cache.hit', {
          pageId: sheet.id,
          cacheSource: 'memory',
          dimension,
        });
        const value = use(cached);
        return value instanceof Promise ? await waitFor(value, signal) : value;
      }
      this.foreground++;
      // A full render already produces its preview. Attach to that job instead
      // of running the same PDF operators again at thumbnail resolution.
      const full =
        dimension === PAGE_PREVIEW_DIMENSION
          ? this.jobs.get(pageImageKey(sheet, PAGE_IMAGE_DIMENSION))
          : undefined;
      let job =
        full && !full.abort.signal.aborted
          ? full
          : this.job(sheet, dimension, false);
      let jobKey =
        full === job ? pageImageKey(sheet, PAGE_IMAGE_DIMENSION) : key;
      try {
        job.users++;
        const result = await waitFor(job.promise, signal);
        signal?.throwIfAborted();
        job.abort.signal.throwIfAborted();
        let entry = full === job ? result.preview : result.entry;
        if (!entry && full === job) {
          // A full PNG disk hit need not load its thumbnail. Read or derive
          // that thumbnail separately when a visible row actually asks for it.
          job.users--;
          this.finish(jobKey, job);
          jobKey = key;
          job = this.job(sheet, dimension, false);
          job.users++;
          entry = (await waitFor(job.promise, signal)).entry;
          signal?.throwIfAborted();
          job.abort.signal.throwIfAborted();
        }
        if (!entry) throw new Error('Rendered preview is unavailable');
        const value = use(entry);
        // Leases are acquired and returned without an intervening abort race.
        return value instanceof Promise ? await waitFor(value, signal) : value;
      } finally {
        job.users--;
        this.foreground--;
        if (!job.users && !job.background && !job.done) job.abort.abort();
        this.finish(jobKey, job);
        this.schedule();
      }
    } finally {
      finish?.();
    }
  }

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
      .forEach(({ sheet }) =>
        unique.set(pageImageKey(sheet, PAGE_IMAGE_DIMENSION), sheet),
      );
    this.total = unique.size;
    for (const key of this.prepared)
      if (!unique.has(key)) this.prepared.delete(key);
    for (const key of this.failed)
      if (!unique.has(key)) this.failed.delete(key);
    this.queue = [...unique]
      .filter(([key]) => !this.prepared.has(key) && !this.failed.has(key))
      .map(([, sheet]) => sheet);
    this.changed();
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
    this.total = 0;
    this.prepared.clear();
    this.failed.clear();
    for (const job of this.jobs.values()) job.abort.abort();
    for (const [key, job] of this.jobs)
      if (job.done && !job.users) this.finish(key, job);
    for (const entry of this.images.values()) entry.resource.release();
    this.images.clear();
    this.decoder.clear();
    this.userPaused = false;
    this.changed();
  }

  private job(sheet: Sheet, dimension: number, background: boolean) {
    const key = pageImageKey(sheet, dimension),
      existing = this.jobs.get(key);
    if (existing && !existing.abort.signal.aborted) return existing;
    const job: ImageJob = {
      abort: new AbortController(),
      users: 0,
      background,
      done: false,
      promise: undefined as unknown as ImageJob['promise'],
      saved: Promise.resolve(true),
      resources: [],
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
  private async load(sheet: Sheet, dimension: number, job: ImageJob) {
    const key = pageImageKey(sheet, dimension),
      signal = job.abort.signal;
    signal.throwIfAborted();
    if (this.store) {
      const end = this.recorder?.span('page.cache.read', {
        pageId: sheet.id,
        dimension,
      });
      try {
        const bytes = await this.store.read(key);
        signal.throwIfAborted();
        if (bytes) {
          const decode = this.recorder?.span('page.cache.decode', {
            pageId: sheet.id,
            dimension,
          });
          const result = await this.decoder
            .decode(bytes, size(sheet, dimension), signal)
            .finally(() => decode?.());
          if (signal.aborted) {
            result.bitmap.close();
            signal.throwIfAborted();
          }
          const resource = new RasterResource(
            result.bitmap,
            Promise.resolve(result.bytes),
          );
          job.resources.push(resource);
          const entry = {
            resource,
            preview: dimension <= PAGE_PREVIEW_DIMENSION,
            saved: Promise.resolve(true),
          };
          this.put(key, entry, job.background && !job.users);
          this.recorder?.event('page.cache.hit', {
            pageId: sheet.id,
            cacheSource: 'disk',
            dimension,
          });
          return { entry };
        }
      } catch {
        signal.throwIfAborted();
      } finally {
        end?.();
      }
    }
    if (dimension === PAGE_PREVIEW_DIMENSION) {
      const fullKey = pageImageKey(sheet, PAGE_IMAGE_DIMENSION);
      const full = this.images.get(fullKey);
      const fullBytes = full ? full.resource.bytes : this.store?.read(fullKey);
      if (fullBytes) {
        try {
          const bytes = await waitFor(fullBytes, signal);
          if (!bytes) throw new Error('Full-page cache image is unavailable');
          const result = await this.decoder.thumbnail(
            bytes.slice(),
            dimension,
            signal,
          );
          if (signal.aborted) {
            result.bitmap.close();
            signal.throwIfAborted();
          }
          const resource = new RasterResource(
            result.bitmap,
            Promise.resolve(result.bytes),
          );
          job.resources.push(resource);
          const entry = {
            resource,
            preview: true,
            saved: this.save(key, resource),
          };
          this.put(key, entry, job.background && !job.users);
          job.saved = entry.saved;
          return { entry };
        } catch {
          signal.throwIfAborted();
        }
      }
    }
    const output = await this.renderPage(
      sheet,
      dimension,
      signal,
      // Typing and saves defer new preparation. They do not throw away work
      // already running off the UI thread. The worker's priority queue handles
      // foreground preemption; only the user's pause stops an active background job.
      () => job.background && !job.users && this.userPaused,
      () =>
        job.background && !job.users
          ? 10
          : dimension <= PAGE_PREVIEW_DIMENSION
            ? 40
            : 100,
    );
    if (signal.aborted) {
      output.bitmap.close();
      output.previewBitmap?.close();
      signal.throwIfAborted();
    }
    const resource = new RasterResource(
      output.bitmap,
      output.encoded.then((encoded) => encoded.bytes),
    );
    const entry = {
      resource,
      preview: dimension <= PAGE_PREVIEW_DIMENSION,
      saved: this.save(key, resource),
    };
    job.resources.push(resource);
    this.put(key, entry, job.background && !job.users);
    const saves = [entry.saved];
    let preview: ImageEntry | undefined;
    if (output.previewBitmap) {
      const previewResource = new RasterResource(
        output.previewBitmap,
        output.encoded.then((encoded) => {
          if (!encoded.previewBytes)
            throw new Error('Preview encoding is unavailable');
          return encoded.previewBytes;
        }),
      );
      const previewKey = pageImageKey(sheet, PAGE_PREVIEW_DIMENSION);
      preview = {
        resource: previewResource,
        preview: true,
        saved: this.save(previewKey, previewResource),
      };
      job.resources.push(previewResource);
      this.put(previewKey, preview, job.background && !job.users);
      saves.push(preview.saved);
    }
    job.saved = Promise.all(saves).then((results) => results.every(Boolean));
    return { entry, ...(preview ? { preview } : {}) };
  }
  private async save(key: string, resource: RasterResource) {
    let end: (() => void) | undefined;
    try {
      const bytes = await resource.bytes;
      if (!this.store) return true;
      end = this.recorder?.span('page.cache.write', {
        bytes: bytes.byteLength,
      });
      await this.store.write(key, bytes);
      return true;
    } catch {
      /* Disposable cache failure never breaks the plan. */
      return false;
    } finally {
      end?.();
    }
  }
  private put(key: string, entry: ImageEntry, background: boolean) {
    const old = this.images.get(key);
    if (old) {
      this.images.delete(key);
      old.resource.release();
    }
    entry.resource.retain();
    void entry.resource.bytes.catch(() => {
      // Keep existing viewer leases alive, but let future requests retry rather
      // than reusing a permanently rejected PNG promise.
      if (this.images.get(key) === entry) {
        this.images.delete(key);
        entry.resource.release();
      }
    });
    if (background) {
      const previous = [...this.images];
      this.images.clear();
      this.images.set(key, entry);
      for (const [id, image] of previous) this.images.set(id, image);
    } else this.images.set(key, entry);
  }
  private finish(key: string, job: ImageJob) {
    if (job.done && !job.users) {
      if (this.jobs.get(key) === job) this.jobs.delete(key);
      for (const resource of job.resources) resource.release();
      job.resources = [];
    }
    for (const preview of [false, true]) {
      let bytes = [...this.images.values()]
        .filter((entry) => entry.preview === preview)
        .reduce((sum, entry) => sum + entry.resource.pixelBytes, 0);
      const budget = preview ? this.previewBytes : this.memoryBytes;
      for (const [id, entry] of this.images) {
        if (bytes <= budget) break;
        if (entry.preview !== preview || this.jobs.has(id)) continue;
        bytes -= entry.resource.pixelBytes;
        this.images.delete(id);
        entry.resource.release();
      }
    }
  }
  private paused() {
    return (
      this.suspended ||
      this.userPaused ||
      this.foreground > 0 ||
      performance.now() < this.notBefore
    );
  }
  private schedule() {
    if (
      this.backgroundRunning ||
      this.foreground ||
      this.suspended ||
      this.userPaused ||
      this.cancelScheduled ||
      !this.queue.length
    )
      return;
    const timer = setTimeout(
      () => {
        this.cancelScheduled = undefined;
        void this.next();
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
    const epoch = this.epoch,
      key = pageImageKey(sheet, PAGE_IMAGE_DIMENSION),
      previewKey = pageImageKey(sheet, PAGE_PREVIEW_DIMENSION);
    this.backgroundRunning = true;
    this.changed();
    try {
      const inMemory = this.images.has(key) && this.images.has(previewKey);
      const onDisk =
        !inMemory &&
        this.store &&
        (await this.store.exists(key).catch(() => false)) &&
        (await this.store.exists(previewKey).catch(() => false));
      if (epoch !== this.epoch) return;
      if (inMemory) {
        const full = this.images.get(key),
          preview = this.images.get(previewKey);
        if (!full || !preview || !(await full.saved) || !(await preview.saved))
          throw new Error('Page image caching failed');
      } else if (!onDisk) {
        const job = this.job(sheet, PAGE_IMAGE_DIMENSION, true);
        const result = await job.promise;
        if (!(await job.saved)) throw new Error('Page image caching failed');
        if (!result.preview) {
          const preview = this.job(sheet, PAGE_PREVIEW_DIMENSION, true);
          await preview.promise;
          if (!(await preview.saved))
            throw new Error('Page preview caching failed');
        }
      }
      if (epoch === this.epoch) this.prepared.add(key);
    } catch {
      if (epoch === this.epoch) this.failed.add(key);
    } finally {
      this.backgroundRunning = false;
      this.changed();
      this.schedule();
    }
  }
}
