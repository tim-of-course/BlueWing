import type { Sheet } from '../core/types';
import type { PdfRenderBounds } from './worker-protocol';
import { pageImageKey } from './page-images';

interface RegionImage {
  abort: AbortController;
  image: Promise<HTMLCanvasElement>;
  value?: HTMLCanvasElement;
}

/** Retains the two source backgrounds used by Wingman's swap views. */
export class RegionImages {
  private readonly images = new Map<string, RegionImage>();
  constructor(
    private readonly render: (
      sheet: Sheet,
      bounds: PdfRenderBounds,
      dimension: number,
      signal: AbortSignal,
    ) => Promise<HTMLCanvasElement>,
  ) {}

  get(sheet: Sheet, bounds: PdfRenderBounds, dimension: number): RegionImage {
    const key = JSON.stringify([
      pageImageKey(sheet, dimension),
      // Restoring a camera can change bounds by a few floating-point bits.
      ...[bounds.x, bounds.y, bounds.width, bounds.height].map((value) =>
        Number(value.toFixed(8)),
      ),
    ]);
    let entry = this.images.get(key);
    if (entry) this.images.delete(key);
    else {
      const abort = new AbortController();
      entry = {
        abort,
        image: this.render(sheet, bounds, dimension, abort.signal),
      };
      const current = entry;
      current.image = current.image.then((image) => {
        if (abort.signal.aborted) {
          image.width = image.height = 0;
          abort.signal.throwIfAborted();
        }
        current.value = image;
        return image;
      });
      void current.image.catch(() => {
        if (this.images.get(key) === current) this.images.delete(key);
      });
    }
    this.images.set(key, entry);
    while (this.images.size > 2) {
      const oldest = this.images.entries().next().value;
      if (!oldest) break;
      this.images.delete(oldest[0]);
      this.release(oldest[1]);
    }
    return entry;
  }

  clear() {
    for (const entry of this.images.values()) this.release(entry);
    this.images.clear();
  }

  private release(entry: RegionImage) {
    entry.abort.abort();
    if (entry.value) entry.value.width = entry.value.height = 0;
  }
}
