import type { Sheet } from '../core/types';

export const thumbnailKey = (sheet: Sheet) =>
  JSON.stringify([sheet.assetId, sheet.pageIndex, sheet.rotation ?? 0]);

interface Thumbnail {
  sheet: Sheet;
  source: string;
  error: string;
  image?: HTMLImageElement | undefined;
}

/** Visible rows own the URLs; duplicate sheets share the same rendered page. */
export class SheetThumbnails {
  private projectId: string | undefined;
  private entries = new Map<string, Thumbnail>();
  private queue: Thumbnail[] = [];
  private running: { entry: Thumbnail; abort: AbortController } | undefined;
  private cancelScheduled: (() => void) | undefined;

  constructor(
    private render: (sheet: Sheet, signal: AbortSignal) => Promise<Uint8Array>,
    private changed: () => void,
  ) {}

  get(sheet: Sheet) {
    return this.entries.get(thumbnailKey(sheet));
  }

  sync(projectId: string | undefined, visibleSheets: Sheet[], preview?: Sheet) {
    if (projectId !== this.projectId) {
      this.clear();
      this.projectId = projectId;
    }
    const sheets = new Map(
      (preview ? [preview, ...visibleSheets] : visibleSheets).map((sheet) => [
        thumbnailKey(sheet),
        sheet,
      ]),
    );
    for (const [key, entry] of this.entries) {
      if (!sheets.has(key)) {
        this.release(entry);
        this.entries.delete(key);
      }
    }
    for (const sheet of sheets.values()) {
      if (this.get(sheet)) continue;
      const entry = { sheet, source: '', error: '' };
      this.entries.set(thumbnailKey(sheet), entry);
    }
    this.queue = [...sheets.keys()]
      .map((key) => this.entries.get(key))
      .filter(
        (entry): entry is Thumbnail =>
          !!entry &&
          !entry.source &&
          !entry.error &&
          entry !== this.running?.entry,
      );
    if (!this.queue.length) {
      this.cancelScheduled?.();
      this.cancelScheduled = undefined;
    }
    this.schedule();
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
    if (this.running?.entry === entry) this.running.abort.abort();
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
    // Let the preview appear before rendering its requested page.
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
    const abort = new AbortController();
    this.running = { entry, abort };
    let image: HTMLImageElement | undefined;
    let source = '';
    try {
      const bytes = await this.render(entry.sheet, abort.signal);
      if (!this.current(entry) || abort.signal.aborted) return;
      const blob = new Blob([bytes.slice().buffer], { type: 'image/png' });
      source = URL.createObjectURL(blob);
      image = new Image();
      entry.image = image;
      image.src = source;
      await image.decode();
      abort.signal.throwIfAborted();
      if (!this.current(entry)) return;
      entry.source = source;
      source = '';
    } catch {
      if (this.current(entry) && !abort.signal.aborted)
        entry.error = 'Preview unavailable';
    } finally {
      if (source) {
        URL.revokeObjectURL(source);
        image?.removeAttribute('src');
        entry.image = undefined;
      }
      this.running = undefined;
      if (this.current(entry)) this.changed();
      this.schedule();
    }
  }
}
