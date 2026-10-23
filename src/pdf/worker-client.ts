import type { AssetRange } from '../platform/storage-model';
import type { Sheet } from '../core/types';
import type { SheetNameSuggestion } from './sheet-names';
import type { PerformanceRecorder } from '../performance/recorder';
import { encodeJpegXl } from './jpeg-xl-encode';
import type {
  EncodedRaster,
  PdfWorkerRequest,
  PdfWorkerResponse,
  RasterImage,
  RasterPixels,
} from './worker-protocol';

type Operation = Extract<
  PdfWorkerRequest,
  { type: 'open' | 'import' | 'name' | 'render' }
>;
type Body<T = Operation> = T extends { id: number } ? Omit<T, 'id'> : never;
interface Pending {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  encode?(value: EncodedRaster): void;
  rejectEncoding?(reason: Error): void;
  encoded?: Promise<EncodedRaster>;
  cleanup(): void;
}

/** Owns one PDFium worker; PDF parsing and drawing never run on the UI. */
export class PdfWorkerClient {
  private readonly renderer = new Worker(
    new URL('./render-worker.ts', import.meta.url),
    { type: 'module' },
  );
  private readonly pending = new Map<number, Pending>();
  private readonly encoders = new Map<number, AbortController>();
  private sequence = 0;
  private closed = false;
  private source: AssetRange | undefined;

  constructor(
    private readonly recorder?: PerformanceRecorder,
    private readonly onIdle?: () => void,
  ) {
    this.renderer.onmessage = (event: MessageEvent<PdfWorkerResponse>) => {
      void this.receive(event.data);
    };
    this.renderer.onerror = (event) => {
      this.destroy(new Error(event.message));
    };
  }

  get busy() {
    return this.pending.size > 0;
  }
  get disposed() {
    return this.closed;
  }

  async open(source: Uint8Array | AssetRange) {
    if (!(source instanceof Uint8Array)) this.source = source;
    const bytes = source instanceof Uint8Array ? source : undefined;
    const end = this.recorder?.span('pdf.worker.open');
    try {
      return await this.request<{ numPages: number }>(
        {
          type: 'open',
          source: bytes ? { bytes } : { length: source.length },
        },
        undefined,
        undefined,
        bytes ? [bytes.buffer as ArrayBuffer] : [],
      );
    } finally {
      end?.();
    }
  }

  import(assetId: string, name: string) {
    return this.request<Sheet[]>({ type: 'import', assetId, name });
  }
  suggestName(sheet: Sheet) {
    return this.request<SheetNameSuggestion>({ type: 'name', sheet });
  }
  render(
    sheet: Sheet,
    bounds: { x: number; y: number; width: number; height: number },
    dimension: number,
    signal?: AbortSignal,
    paused?: () => boolean,
    priority: number | (() => number) = 100,
    jpegXl = false,
  ) {
    return this.request<RasterImage>(
      {
        type: 'render',
        sheet,
        bounds,
        dimension,
        encode: true,
        jpegXl,
        paused: paused?.() ?? false,
        priority: typeof priority === 'function' ? priority() : priority,
      },
      signal,
      paused,
      [],
      typeof priority === 'function' ? priority : undefined,
    );
  }

  renderPixels(
    sheet: Sheet,
    bounds: { x: number; y: number; width: number; height: number },
    dimension: number,
    signal?: AbortSignal,
    paused?: () => boolean,
  ) {
    return this.request<RasterPixels>(
      {
        type: 'render',
        sheet,
        bounds,
        dimension,
        encode: false,
        paused: paused?.() ?? false,
        priority: 100,
      },
      signal,
      paused,
    );
  }

  private request<T>(
    body: Body,
    signal?: AbortSignal,
    paused?: () => boolean,
    transfers: Transferable[] = [],
    priority?: () => number,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (this.closed) return Promise.reject(new Error('PDF worker was closed'));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setInterval> | undefined;
      const cancel = () => {
        const reason =
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException('PDF rendering was cancelled', 'AbortError');
        this.fail(id, reason);
        if (!this.closed)
          this.renderer.postMessage({
            type: 'cancel',
            id,
          } satisfies PdfWorkerRequest);
      };
      const pending: Pending = {
        resolve: (value) => {
          resolve(value as T);
        },
        reject,
        cleanup: () => {
          if (timer) clearInterval(timer);
          signal?.removeEventListener('abort', cancel);
        },
      };
      if (body.type === 'render' && body.encode) {
        pending.encoded = new Promise((encode, fail) => {
          pending.encode = encode;
          pending.rejectEncoding = fail;
        });
        void pending.encoded.catch(() => undefined);
      }
      this.pending.set(id, pending);
      signal?.addEventListener('abort', cancel, { once: true });
      if (paused || priority) {
        let last = paused?.() ?? false;
        let lastPriority = priority?.();
        timer = setInterval(() => {
          const next = paused?.() ?? false;
          if (next !== last && !this.closed) {
            last = next;
            this.renderer.postMessage({
              type: 'pause',
              id,
              paused: next,
            } satisfies PdfWorkerRequest);
          }
          const nextPriority = priority?.();
          if (
            nextPriority !== lastPriority &&
            nextPriority !== undefined &&
            !this.closed
          ) {
            lastPriority = nextPriority;
            this.renderer.postMessage({
              type: 'priority',
              id,
              priority: nextPriority,
            } satisfies PdfWorkerRequest);
          }
        }, 50);
      }
      this.renderer.postMessage(
        { ...body, id } satisfies PdfWorkerRequest,
        transfers,
      );
    });
  }

  private fail(id: number, reason: Error) {
    this.encoders.get(id)?.abort();
    this.encoders.delete(id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.cleanup();
    pending.reject(reason);
    pending.rejectEncoding?.(reason);
    if (!this.busy) this.onIdle?.();
  }

  private async receive(data: PdfWorkerResponse) {
    if (data.type === 'encode') {
      if (!this.pending.has(data.id) || this.closed) return;
      const abort = new AbortController();
      this.encoders.set(data.id, abort);
      try {
        const bytes = await encodeJpegXl(data, abort.signal);
        if (this.pending.has(data.id))
          this.renderer.postMessage(
            {
              type: 'encode-result',
              id: data.id,
              bytes,
            } satisfies PdfWorkerRequest,
            [bytes.buffer],
          );
      } catch (reason) {
        if (this.pending.has(data.id))
          this.renderer.postMessage({
            type: 'encode-result',
            id: data.id,
            error: reason instanceof Error ? reason.message : String(reason),
          } satisfies PdfWorkerRequest);
      } finally {
        this.encoders.delete(data.id);
      }
      return;
    }
    if (data.type === 'range') {
      const end = this.recorder?.span('pdf.range.read', {
        offset: data.begin,
        bytes: data.end - data.begin,
      });
      try {
        if (!this.source) throw new Error('PDF source is unavailable');
        const bytes = await this.source.read(data.begin, data.end - data.begin);
        if (bytes.length !== data.end - data.begin)
          throw new Error('Incomplete PDF range read');
        if (!this.closed) {
          const owned = bytes.slice();
          this.renderer.postMessage(
            {
              type: 'range-result',
              rangeId: data.rangeId,
              bytes: owned,
            } satisfies PdfWorkerRequest,
            [owned.buffer],
          );
        }
      } catch (error) {
        if (!this.closed)
          this.renderer.postMessage({
            type: 'range-result',
            rangeId: data.rangeId,
            error: error instanceof Error ? error.message : String(error),
          } satisfies PdfWorkerRequest);
      } finally {
        end?.();
      }
      return;
    }
    if (data.type === 'fatal') {
      this.destroy(
        Object.assign(new Error(data.error.message), { name: data.error.name }),
      );
      return;
    }
    const pending = this.pending.get(data.id);
    if (!pending) {
      if (data.type === 'raster') {
        data.bitmap.close();
        data.previewBitmap?.close();
      }
      return;
    }
    switch (data.type) {
      case 'raster':
        this.recorder?.event('pdf.worker.raster', {
          ...data.timings,
          purpose: 'worker',
        });
        pending.resolve({
          bitmap: data.bitmap,
          ...(data.previewBitmap ? { previewBitmap: data.previewBitmap } : {}),
          ...(pending.encoded ? { encoded: pending.encoded } : {}),
        } satisfies RasterPixels | RasterImage);
        if (!pending.encoded) {
          this.pending.delete(data.id);
          pending.cleanup();
          if (!this.busy) this.onIdle?.();
        }
        break;
      case 'encoded':
        this.recorder?.event('pdf.worker.encoded', {
          ...data.timings,
          purpose: 'worker',
        });
        pending.encode?.({
          bytes: data.bytes,
          ...(data.previewBytes ? { previewBytes: data.previewBytes } : {}),
        });
        this.pending.delete(data.id);
        pending.cleanup();
        if (!this.busy) this.onIdle?.();
        break;
      case 'error':
        this.fail(
          data.id,
          Object.assign(new Error(data.error.message), {
            name: data.error.name,
          }),
        );
        break;
      case 'ready':
      case 'result':
        this.pending.delete(data.id);
        pending.cleanup();
        pending.resolve(data.value);
        if (!this.busy) this.onIdle?.();
        break;
    }
  }

  destroy(reason = new Error('PDF loading was cancelled')) {
    if (this.closed) return;
    this.closed = true;
    for (const id of this.pending.keys()) this.fail(id, reason);
    this.renderer.terminate();
    void this.source?.close?.().catch(() => undefined);
    this.source = undefined;
  }
}
