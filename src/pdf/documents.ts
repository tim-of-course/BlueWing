import type { Sheet } from '../core/types';
import type { AssetRange } from '../platform/storage-model';
import type { SheetNameSuggestion } from './sheet-names';
import type { PerformanceRecorder } from '../performance/recorder';
import type { RasterImage } from './worker-protocol';
import { PdfWorkerClient } from './worker-client';

interface LoadedDocument {
  promise: Promise<PdfWorkerClient>;
  worker: PdfWorkerClient | undefined;
  users: number;
  names: Map<string, Promise<SheetNameSuggestion>>;
}

/** PDF work is isolated from the UI; imported coordinates remain top-left viewports. */
export class PdfDocuments {
  private readonly documents = new Map<string, LoadedDocument>();
  constructor(
    private readonly readAsset: (
      id: string,
    ) => Promise<Uint8Array | AssetRange>,
    private readonly recorder?: PerformanceRecorder,
  ) {}

  private document(id: string, source?: Uint8Array | AssetRange) {
    const existing = this.documents.get(id);
    if (existing && !existing.worker?.disposed) {
      this.documents.delete(id);
      this.documents.set(id, existing);
      return existing;
    }
    const entry: LoadedDocument = {
      promise: undefined as unknown as Promise<PdfWorkerClient>,
      worker: undefined,
      users: 0,
      names: new Map(),
    };
    this.documents.set(id, entry);
    entry.promise = Promise.resolve().then(async () => {
      const data = source ?? (await this.readAsset(id));
      if (this.documents.get(id) !== entry)
        throw new Error('PDF loading was cancelled');
      const worker = new PdfWorkerClient(this.recorder, () => {
        this.trim();
      });
      entry.worker = worker;
      try {
        await worker.open(
          data instanceof Uint8Array && source ? data.slice() : data,
        );
        return worker;
      } catch (error) {
        worker.destroy();
        throw error;
      }
    });
    void entry.promise.catch(() => {
      if (this.documents.get(id) === entry) this.documents.delete(id);
    });
    return entry;
  }

  private async useDocument<T>(
    id: string,
    use: (worker: PdfWorkerClient, entry: LoadedDocument) => Promise<T>,
    source?: Uint8Array | AssetRange,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const entry = this.document(id, source);
    entry.users++;
    let cancel: (() => void) | undefined;
    const cancelled = signal
      ? new Promise<never>((_, reject) => {
          cancel = () => {
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new Error('PDF rendering was cancelled'),
            );
          };
          signal.addEventListener('abort', cancel, { once: true });
        })
      : undefined;
    try {
      const operation = entry.promise.then((worker) => {
        signal?.throwIfAborted();
        return use(worker, entry);
      });
      return await (cancelled
        ? Promise.race([operation, cancelled])
        : operation);
    } finally {
      if (cancel) signal?.removeEventListener('abort', cancel);
      entry.users--;
      if (signal?.aborted && !entry.users && this.documents.get(id) === entry)
        await this.release(id);
      this.trim();
    }
  }

  private trim() {
    const idle = [...this.documents].filter(
      ([, value]) => !value.users && !value.worker?.busy,
    );
    for (const [key] of idle.slice(0, Math.max(0, idle.length - 2)))
      void this.release(key);
  }

  import(
    id: string,
    name: string,
    source: Uint8Array | AssetRange,
  ): Promise<Sheet[]> {
    return this.useDocument(id, (worker) => worker.import(id, name), source);
  }

  async suggestName(sheet: Sheet): Promise<SheetNameSuggestion> {
    return this.useDocument(sheet.assetId, async (worker, entry) => {
      const key = `${String(sheet.pageIndex)}:${String(sheet.rotation ?? 0)}`;
      let pending = entry.names.get(key);
      if (!pending) {
        pending = worker.suggestName(sheet);
        entry.names.set(key, pending);
      }
      try {
        return { ...(await pending) };
      } catch (error) {
        entry.names.delete(key);
        throw error;
      }
    });
  }

  raster(
    sheet: Sheet,
    dimension: number,
    signal?: AbortSignal,
    paused?: () => boolean,
    priority: number | (() => number) = 100,
  ): Promise<RasterImage> {
    return this.rasterRegion(
      sheet,
      { x: 0, y: 0, width: sheet.width, height: sheet.height },
      dimension,
      signal,
      paused,
      priority,
    );
  }

  rasterRegion(
    sheet: Sheet,
    bounds: { x: number; y: number; width: number; height: number },
    dimension: number,
    signal?: AbortSignal,
    paused?: () => boolean,
    priority: number | (() => number) = 100,
  ): Promise<RasterImage> {
    const finish = this.recorder?.span('pdf.raster.request', {
      pageId: sheet.id,
      dimension,
      priority: typeof priority === 'function' ? priority() : priority,
    });
    return this.useDocument(
      sheet.assetId,
      (worker) =>
        worker.render(sheet, bounds, dimension, signal, paused, priority),
      undefined,
      signal,
    ).finally(() => finish?.());
  }

  /** An owned editable canvas is used only for explicit snapshots/exports. */
  async render(
    sheet: Sheet,
    maxDimension = 2400,
    signal?: AbortSignal,
    paused?: () => boolean,
  ): Promise<HTMLCanvasElement> {
    return this.renderRegion(
      sheet,
      { x: 0, y: 0, width: sheet.width, height: sheet.height },
      maxDimension,
      signal,
      paused,
    );
  }

  async renderRegion(
    sheet: Sheet,
    bounds: { x: number; y: number; width: number; height: number },
    maxDimension: number,
    signal?: AbortSignal,
    paused?: () => boolean,
  ): Promise<HTMLCanvasElement> {
    const result = await this.rasterRegion(
      sheet,
      bounds,
      maxDimension,
      signal,
      paused,
    );
    try {
      signal?.throwIfAborted();
      const canvas = document.createElement('canvas');
      canvas.width = result.bitmap.width;
      canvas.height = result.bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');
      context.drawImage(result.bitmap, 0, 0);
      return canvas;
    } finally {
      result.bitmap.close();
      result.previewBitmap?.close();
    }
  }

  release(id: string): Promise<void> {
    const entry = this.documents.get(id);
    if (entry) {
      this.documents.delete(id);
      entry.worker?.destroy();
      entry.names.clear();
    }
    return Promise.resolve();
  }
  clear(): Promise<void> {
    for (const id of this.documents.keys()) void this.release(id);
    return Promise.resolve();
  }
}
