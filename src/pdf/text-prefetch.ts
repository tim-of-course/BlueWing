import type { Sheet } from '../core/types';
import type { PageText } from './page-text';

type Entry = {
  sheet: Sheet;
  state: 'queued' | 'reading' | 'ready' | 'error';
  value?: PageText;
  error?: string;
  bytes: number;
};
function key(sheet: Sheet) {
  return JSON.stringify([
    sheet.id,
    sheet.assetId,
    sheet.pageIndex,
    sheet.width,
    sheet.height,
    sheet.rotation,
    sheet.pdfToPage,
  ]);
}

/** Explicit bulk prefetch; only one extraction runs at a time, independently of CLI requests. */
export class TextPrefetch {
  private readonly entries = new Map<string, Entry>();
  private active: AbortController | undefined;
  private generation = 0;
  private running = false;
  private bytes = 0;
  constructor(
    private readonly read: (
      sheet: Sheet,
      signal: AbortSignal,
    ) => Promise<PageText>,
    readonly maxBytes = 16 * 1024 * 1024,
  ) {}

  prefetch(sheets: readonly Sheet[]) {
    for (const sheet of sheets) {
      const id = key(sheet),
        existing = this.entries.get(id);
      if (existing && existing.state !== 'error') continue;
      this.entries.set(id, {
        sheet: structuredClone(sheet),
        state: 'queued',
        bytes: 0,
      });
    }
    void this.pump();
    return this.status(sheets);
  }
  status(sheets: readonly Sheet[]) {
    const counts = {
      total: sheets.length,
      queued: 0,
      reading: 0,
      ready: 0,
      error: 0,
      notCached: 0,
    };
    for (const sheet of sheets) {
      const entry = this.entries.get(key(sheet));
      if (entry) counts[entry.state]++;
      else counts.notCached++;
    }
    return { ...counts, cacheBytes: this.bytes, maxCacheBytes: this.maxBytes };
  }
  get(sheet: Sheet) {
    const id = key(sheet),
      entry = this.entries.get(id);
    if (entry?.state === 'ready') {
      this.entries.delete(id);
      this.entries.set(id, entry);
    }
    return {
      sheetId: sheet.id,
      name: sheet.name,
      assetId: sheet.assetId,
      pageNumber: sheet.pageIndex + 1,
      width: sheet.width,
      height: sheet.height,
      ...(entry?.value
        ? structuredClone(entry.value)
        : { status: entry?.state ?? 'not-cached' }),
      ...(entry?.error ? { error: entry.error } : {}),
    };
  }
  cancel() {
    this.generation++;
    this.active?.abort();
    this.active = undefined;
    for (const [id, entry] of this.entries) {
      if (entry.state === 'queued' || entry.state === 'reading')
        this.entries.delete(id);
    }
  }
  clear() {
    this.cancel();
    this.entries.clear();
    this.bytes = 0;
  }
  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const pending = [...this.entries].find(
          ([, entry]) => entry.state === 'queued',
        );
        if (!pending) break;
        const [id, entry] = pending,
          generation = this.generation;
        const controller = new AbortController();
        this.active = controller;
        entry.state = 'reading';
        try {
          const value = await this.read(entry.sheet, controller.signal);
          if (generation !== this.generation || controller.signal.aborted)
            continue;
          const bytes = JSON.stringify(value).length * 2 + 256;
          if (bytes > this.maxBytes)
            throw new Error('Page text exceeds cache allowance');
          while (this.bytes + bytes > this.maxBytes) {
            const oldest = [...this.entries].find(
              ([, candidate]) => candidate.state === 'ready',
            );
            if (!oldest) break;
            this.bytes -= oldest[1].bytes;
            this.entries.delete(oldest[0]);
          }
          entry.value = value;
          entry.bytes = bytes;
          this.bytes += bytes;
          entry.state = 'ready';
        } catch (error) {
          if (generation !== this.generation || controller.signal.aborted)
            continue;
          entry.state = 'error';
          entry.error = error instanceof Error ? error.message : String(error);
        } finally {
          if (this.active === controller) this.active = undefined;
        }
        // Allow foreground work and progress reads between pages.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (this.entries.get(id) !== entry) continue;
      }
    } finally {
      this.running = false;
    }
  }
}
