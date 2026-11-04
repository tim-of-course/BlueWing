interface DecodedImage {
  bitmap: ImageBitmap;
  bytes: Uint8Array;
}
interface Pending {
  resolve(result: DecodedImage): void;
  reject(error: Error): void;
  cleanup(): void;
}
type DecodeReply =
  | ({ id: number } & ({ error: string } | DecodedImage))
  | { id: number; settled: true };

/** A lazy, reusable worker decodes disposable PNGs without a second display canvas. */
export class ImageDecoder {
  private worker: Worker | undefined;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  // Native image decode may continue after its caller cancels.
  private readonly active = new Set<number>();
  constructor(private readonly onIdle?: () => void) {}
  get busy() {
    return this.active.size > 0;
  }
  decode(
    bytes: Uint8Array,
    dimensions: { width: number; height: number },
    signal: AbortSignal,
  ): Promise<DecodedImage> {
    return this.request(bytes, dimensions, signal);
  }
  thumbnail(
    bytes: Uint8Array,
    dimension: number,
    signal: AbortSignal,
  ): Promise<DecodedImage> {
    return this.request(bytes, { dimension }, signal);
  }
  private request(
    bytes: Uint8Array,
    dimensions: { width: number; height: number } | { dimension: number },
    signal: AbortSignal,
  ): Promise<DecodedImage> {
    signal.throwIfAborted();
    const id = ++this.sequence;
    if (!this.worker) {
      this.worker = new Worker(new URL('./image-worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (event: MessageEvent<DecodeReply>) => {
        const result = event.data;
        if ('settled' in result) {
          if (this.active.delete(result.id) && !this.busy) this.onIdle?.();
          return;
        }
        const pending = this.pending.get(result.id);
        if (!pending) {
          if ('bitmap' in result) result.bitmap.close();
          return;
        }
        this.pending.delete(result.id);
        pending.cleanup();
        if ('error' in result) pending.reject(new Error(result.error));
        else pending.resolve(result);
      };
      this.worker.onerror = (event) => {
        this.clear(new Error(event.message));
      };
    }
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.pending.delete(id);
        this.worker?.postMessage({ type: 'cancel', id });
        signal.removeEventListener('abort', cancel);
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new Error('Cache decoding was cancelled'),
        );
      };
      this.pending.set(id, {
        resolve,
        reject,
        cleanup: () => {
          signal.removeEventListener('abort', cancel);
        },
      });
      signal.addEventListener('abort', cancel, { once: true });
      this.active.add(id);
      try {
        this.worker?.postMessage({ type: 'decode', id, bytes, ...dimensions }, [
          bytes.buffer as ArrayBuffer,
        ]);
      } catch (error) {
        this.pending.delete(id);
        this.active.delete(id);
        signal.removeEventListener('abort', cancel);
        if (!this.busy) this.onIdle?.();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  clear(reason = new Error('Cache decoding was cancelled')) {
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(reason);
    }
    this.pending.clear();
    this.worker?.terminate();
    this.worker = undefined;
    const hadActive = this.busy;
    this.active.clear();
    if (hadActive) this.onIdle?.();
  }
}
