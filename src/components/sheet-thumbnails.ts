import type { Sheet } from '../core/types';

export const thumbnailKey = (sheet: Sheet) =>
  JSON.stringify([sheet.assetId, sheet.pageIndex, sheet.rotation ?? 0]);

interface Thumbnail {
  sheet: Sheet;
  source: string;
  error: string;
  image?: HTMLImageElement | undefined;
}

/** One project owns the URLs; duplicate sheets share the same rendered page. */
export class SheetThumbnails {
  private projectId: string | undefined;
  private entries = new Map<string, Thumbnail>();
  private queue: Thumbnail[] = [];
  private running = false;
  private cancelScheduled: (() => void) | undefined;

  constructor(
    private render: (sheet: Sheet) => Promise<HTMLCanvasElement>,
    private changed: () => void,
  ) {}

  get(sheet: Sheet) {
    return this.entries.get(thumbnailKey(sheet));
  }

  sync(projectId: string | undefined, sheets: Sheet[]) {
    if (projectId !== this.projectId) {
      this.clear();
      this.projectId = projectId;
    }
    const keys = new Set(sheets.map(thumbnailKey));
    for (const [key, entry] of this.entries) {
      if (!keys.has(key)) {
        this.release(entry);
        this.entries.delete(key);
      }
    }
    this.queue = this.queue.filter((entry) => this.current(entry));
    for (const sheet of sheets) {
      if (this.get(sheet)) continue;
      const entry = { sheet, source: '', error: '' };
      this.entries.set(thumbnailKey(sheet), entry);
      this.queue.push(entry);
    }
    this.schedule();
  }

  prioritize(sheet: Sheet) {
    const entry = this.get(sheet);
    const index = entry ? this.queue.indexOf(entry) : -1;
    if (index > 0) this.queue.unshift(...this.queue.splice(index, 1));
  }

  clear() {
    this.cancelScheduled?.();
    this.cancelScheduled = undefined;
    this.queue = [];
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
  }

  private current(entry: Thumbnail) {
    return this.get(entry.sheet) === entry;
  }

  private release(entry: Thumbnail) {
    if (entry.source) URL.revokeObjectURL(entry.source);
    entry.image?.removeAttribute('src');
    entry.image = undefined;
  }

  private schedule() {
    if (this.running || this.cancelScheduled || !this.queue.length) return;
    const start = () => {
      this.cancelScheduled = undefined;
      void this.next();
    };
    // Yield between pages so prewarming doesn't monopolize drawing input.
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(start, { timeout: 1000 });
      this.cancelScheduled = () => {
        cancelIdleCallback(id);
      };
    } else {
      const id = setTimeout(start, 32);
      this.cancelScheduled = () => {
        clearTimeout(id);
      };
    }
  }

  private async next() {
    const entry = this.queue.shift();
    if (!entry) return;
    this.running = true;
    let canvas: HTMLCanvasElement | undefined;
    let source = '';
    try {
      const rendered = await this.render(entry.sheet);
      canvas = rendered;
      if (!this.current(entry)) return;
      const blob = await new Promise<Blob | null>((resolve) => {
        rendered.toBlob(resolve);
      });
      if (!blob) throw new Error('Thumbnail encoding failed');
      if (!this.current(entry)) return;
      source = URL.createObjectURL(blob);
      const image = new Image();
      image.src = source;
      await image.decode();
      if (!this.current(entry)) return;
      entry.image = image;
      entry.source = source;
      source = '';
    } catch {
      if (this.current(entry)) entry.error = 'Preview unavailable';
    } finally {
      if (canvas) canvas.width = canvas.height = 0;
      if (source) URL.revokeObjectURL(source);
      this.running = false;
      if (this.current(entry)) this.changed();
      this.schedule();
    }
  }
}
