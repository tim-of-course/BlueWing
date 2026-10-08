import type { AssetRange } from '../platform/storage-model';
import type { Sheet } from '../core/types';
import type { SheetNameSuggestion } from './sheet-names';
import type { PerformanceRecorder } from '../performance/recorder';
import type {
  EncodedRaster,
  PdfWorkerRequest,
  PdfWorkerResponse,
  RasterImage,
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

/** Owns both threads. Parser/font/operator traffic never traverses the UI. */
export class PdfWorkerClient {
  private readonly renderer = new Worker(
    new URL('./render-worker.ts', import.meta.url),
    { type: 'module' },
  );
  private readonly parser = new Worker('/pdfjs/parser-bridge.mjs', {
    type: 'module',
  });
  private readonly pending = new Map<number, Pending>();
  private sequence = 0;
  private closed = false;
  private source: AssetRange | undefined;
  private rejectConnection: ((reason: Error) => void) | undefined;

  constructor(
    private readonly recorder?: PerformanceRecorder,
    private readonly onIdle?: () => void,
  ) {
    this.renderer.onmessage = (event: MessageEvent<PdfWorkerResponse>) => {
      void this.receive(event.data);
    };
    this.renderer.onerror = this.parser.onerror = (event) => {
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
    const channel = new MessageChannel();
    await new Promise<void>((resolve, reject) => {
      this.rejectConnection = reject;
      this.parser.onmessage = (event: MessageEvent<{ type?: string }>) => {
        // PDF.js also posts its own startup message on the parent channel.
        // Wait for the bridge to confirm the renderer's direct port is attached.
        if (event.data.type !== 'connected') return;
        this.rejectConnection = undefined;
        resolve();
      };
      this.parser.postMessage({ type: 'connect', port: channel.port1 }, [
        channel.port1,
      ]);
    });
    if (!(source instanceof Uint8Array)) this.source = source;
    const bytes = source instanceof Uint8Array ? source : undefined;
    const end = this.recorder?.span('pdf.worker.open');
    try {
      return await this.request<{ numPages: number }>(
        {
          type: 'open',
          parserPort: channel.port2,
          source: bytes ? { bytes } : { length: source.length },
          assetBaseUrl: new URL('/pdfjs/', location.href).href,
        },
        undefined,
        undefined,
        [channel.port2, ...(bytes ? [bytes.buffer as ArrayBuffer] : [])],
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
  ) {
    return this.request<RasterImage>(
      {
        type: 'render',
        sheet,
        bounds,
        dimension,
        paused: paused?.() ?? false,
        priority: typeof priority === 'function' ? priority() : priority,
      },
      signal,
      paused,
      [],
      typeof priority === 'function' ? priority : undefined,
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
      if (body.type === 'render') {
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
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.cleanup();
    pending.reject(reason);
    pending.rejectEncoding?.(reason);
    if (!this.busy) this.onIdle?.();
  }

  private async receive(data: PdfWorkerResponse) {
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
        if (!pending.encoded) {
          data.bitmap.close();
          data.previewBitmap?.close();
          this.fail(data.id, new Error('Unexpected PDF raster response'));
          break;
        }
        this.recorder?.event('pdf.worker.raster', {
          ...data.timings,
          purpose: 'worker',
        });
        pending.resolve({
          bitmap: data.bitmap,
          ...(data.previewBitmap ? { previewBitmap: data.previewBitmap } : {}),
          encoded: pending.encoded,
        } satisfies RasterImage);
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
    this.rejectConnection?.(reason);
    for (const id of this.pending.keys()) this.fail(id, reason);
    this.renderer.terminate();
    this.parser.terminate();
    this.source = undefined;
  }
}
