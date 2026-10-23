import type { RasterStage } from './raster';

interface DecodedImage {
  bitmap: ImageBitmap;
  bytes: Uint8Array;
}
interface Pending {
  resolve(result: DecodedImage): void;
  reject(error: Error): void;
  cleanup(): void;
  progress?: (bitmap: ImageBitmap, stage: RasterStage) => void;
}

/** A lazy worker decodes cached images and releases its codec heap when idle. */
export class ImageDecoder {
  private worker: Worker | undefined;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  decode(
    bytes: Uint8Array,
    dimensions: { width: number; height: number },
    signal: AbortSignal,
    progress?: (bitmap: ImageBitmap, stage: RasterStage) => void,
    screenDimension?: number,
  ): Promise<DecodedImage> {
    return this.request(bytes, dimensions, signal, progress, screenDimension);
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
    progress?: (bitmap: ImageBitmap, stage: RasterStage) => void,
    screenDimension?: number,
  ): Promise<DecodedImage> {
    signal.throwIfAborted();
    const id = ++this.sequence;
    if (!this.worker) {
      this.worker = new Worker(new URL('./image-worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (
        event: MessageEvent<
          (
            | { error: string }
            | DecodedImage
            | { bitmap: ImageBitmap; stage: RasterStage }
          ) & { id: number; retire?: boolean }
        >,
      ) => {
        const result = event.data,
          pending = this.pending.get(result.id);
        if (!pending) {
          if ('bitmap' in result) result.bitmap.close();
          if (!this.pending.size && result.retire) {
            this.worker?.terminate();
            this.worker = undefined;
          }
          return;
        }
        if ('stage' in result) {
          if (pending.progress) pending.progress(result.bitmap, result.stage);
          else result.bitmap.close();
          return;
        }
        this.pending.delete(result.id);
        pending.cleanup();
        if ('error' in result) pending.reject(new Error(result.error));
        else pending.resolve(result);
        if (!this.pending.size && result.retire) {
          // Free a large WASM high-water heap after its queue drains.
          this.worker?.terminate();
          this.worker = undefined;
        }
      };
      this.worker.onerror = (event) => {
        this.clear(new Error(event.message));
      };
    }
    return new Promise((resolve, reject) => {
      const cancel = () => {
        this.pending.delete(id);
        if (this.pending.size) this.worker?.postMessage({ type: 'cancel', id });
        else {
          this.worker?.terminate();
          this.worker = undefined;
        }
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
        ...(progress ? { progress } : {}),
        cleanup: () => {
          signal.removeEventListener('abort', cancel);
        },
      });
      signal.addEventListener('abort', cancel, { once: true });
      this.worker?.postMessage(
        { type: 'decode', id, bytes, ...dimensions, screenDimension },
        [bytes.buffer as ArrayBuffer],
      );
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
  }
}
