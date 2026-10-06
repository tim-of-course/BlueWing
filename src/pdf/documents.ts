import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { Sheet } from '../core/types';
import type { AssetRange } from '../platform/storage-model';
import { AssetRangeTransport } from './range-transport';
import { suggestSheetName, type SheetNameSuggestion } from './sheet-names';

GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

interface LoadedDocument {
  promise: Promise<PDFDocumentProxy>;
  task?: PDFDocumentLoadingTask;
  users: number;
  names: Map<string, Promise<SheetNameSuggestion>>;
}

/** Imported coordinates are the rotated, top-left PDF viewport at scale 1. */
export class PdfDocuments {
  private readonly documents = new Map<string, LoadedDocument>();

  constructor(
    private readonly readAsset: (
      id: string,
    ) => Promise<Uint8Array | AssetRange>,
  ) {}

  private document(
    id: string,
    source?: Uint8Array | AssetRange,
  ): LoadedDocument {
    const existing = this.documents.get(id);
    if (existing) {
      this.documents.delete(id);
      this.documents.set(id, existing);
      return existing;
    }
    const result = Promise.resolve().then(async () => {
      const data = source ?? (await this.readAsset(id));
      if (this.documents.get(id) !== entry)
        throw new Error('PDF loading was cancelled');
      const range =
        data instanceof Uint8Array
          ? undefined
          : new AssetRangeTransport(data, () => {
              // A failed disk/IPC read must end pending page operations, not leave a
              // PDF.js range reader waiting forever. A later request can reopen it.
              if (this.documents.get(id) === entry) this.documents.delete(id);
              void task.destroy().catch(() => undefined);
            });
      const task = getDocument({
        // Imports retain their caller's buffer; loaded assets are fresh owned bytes.
        // PDF.js transfers the buffer to its worker.
        ...(data instanceof Uint8Array
          ? { data: source ? data.slice() : data }
          : {
              range,
              rangeChunkSize: 256 * 1024,
              disableAutoFetch: true,
              disableStream: true,
            }),
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/',
      });
      entry.task = task;
      try {
        return await (range
          ? Promise.race([task.promise, range.failed])
          : task.promise);
      } catch (error) {
        await task.destroy().catch(() => undefined);
        throw error;
      }
    });
    const entry: LoadedDocument = {
      promise: result,
      users: 0,
      names: new Map(),
    };
    this.documents.set(id, entry);
    void result.catch(() => {
      if (this.documents.get(id) === entry) this.documents.delete(id);
    });
    return entry;
  }

  private async useDocument<T>(
    id: string,
    use: (pdf: PDFDocumentProxy, entry: LoadedDocument) => Promise<T>,
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
      const operation = entry.promise.then((pdf) => {
        signal?.throwIfAborted();
        return use(pdf, entry);
      });
      return await (cancelled
        ? Promise.race([operation, cancelled])
        : operation);
    } finally {
      if (cancel) signal?.removeEventListener('abort', cancel);
      entry.users--;
      if (signal?.aborted && !entry.users && this.documents.get(id) === entry)
        await this.release(id);
      // Keep recent workers for the main plan and Wingman. Other idle PDFs
      // release their raw bytes and shared font/image caches. Active operations
      // are pinned until their own completion, including concurrent previews.
      const idle = [...this.documents].filter(([, value]) => !value.users);
      await Promise.allSettled(
        idle
          .slice(0, Math.max(0, idle.length - 2))
          .map(([key]) => this.release(key)),
      );
    }
  }

  async import(
    id: string,
    name: string,
    source: Uint8Array | AssetRange,
  ): Promise<Sheet[]> {
    return this.useDocument(
      id,
      async (document) => {
        const labels = await document.getPageLabels();
        const sheets: Sheet[] = [];
        for (let index = 0; index < document.numPages; index += 1) {
          const page = await document.getPage(index + 1);
          const viewport = page.getViewport({ scale: 1 });
          const transform = viewport.transform;
          sheets.push({
            id: crypto.randomUUID(),
            assetId: id,
            name: `${labels?.[index] ?? `Sheet ${String(index + 1)}`} · ${name.replace(/\.pdf$/i, '')}`,
            pageIndex: index,
            width: viewport.width,
            height: viewport.height,
            rotation: viewport.rotation,
            pdfToPage: [
              transform[0] ?? 1,
              transform[1] ?? 0,
              transform[2] ?? 0,
              transform[3] ?? 1,
              transform[4] ?? 0,
              transform[5] ?? 0,
            ],
          });
        }
        return sheets;
      },
      source,
    );
  }

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

  async suggestName(sheet: Sheet): Promise<SheetNameSuggestion> {
    return this.useDocument(sheet.assetId, async (pdf, entry) => {
      const key = `${String(sheet.pageIndex)}:${String(sheet.rotation ?? 0)}`;
      let pending = entry.names.get(key);
      if (!pending) {
        pending = (async () => {
          const page = await pdf.getPage(sheet.pageIndex + 1);
          const viewport = page.getViewport({
            scale: 1,
            rotation: sheet.rotation ?? 0,
          });
          const text = await page.getTextContent();
          return suggestSheetName(
            text.items.filter((item) => 'str' in item),
            viewport,
          );
        })();
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

  async renderRegion(
    sheet: Sheet,
    bounds: { x: number; y: number; width: number; height: number },
    maxDimension: number,
    signal?: AbortSignal,
    paused?: () => boolean,
  ): Promise<HTMLCanvasElement> {
    signal?.throwIfAborted();
    return this.useDocument(
      sheet.assetId,
      async (pdf) => {
        signal?.throwIfAborted();
        const page = await pdf.getPage(sheet.pageIndex + 1);
        signal?.throwIfAborted();
        const scale =
          Math.min(4096, Math.max(64, maxDimension)) /
          Math.max(bounds.width, bounds.height);
        const viewport = page.getViewport({
          scale,
          rotation: sheet.rotation ?? 0,
          offsetX: -bounds.x * scale,
          offsetY: -bounds.y * scale,
        });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(bounds.width * scale);
        canvas.height = Math.ceil(bounds.height * scale);
        // Static plan images must render even while the desktop is in the background.
        // PDF.js display intent waits on animation frames, which WebKit can suspend.
        const task = page.render({ canvas, viewport, intent: 'print' });
        const cancel = () => {
          task.cancel();
        };
        signal?.addEventListener('abort', cancel, { once: true });
        // Print intent chains chunks as microtasks, which can starve input and paint
        // on complex plans. Yield between chunks without depending on foreground
        // animation frames or background-throttled timers.
        const continuation = new MessageChannel();
        let resume: (() => void) | undefined;
        let retry: ReturnType<typeof setTimeout> | undefined;
        continuation.port1.onmessage = () => {
          if (paused?.()) {
            retry = setTimeout(() => {
              continuation.port2.postMessage(null);
            }, 50);
            return;
          }
          const next = resume;
          resume = undefined;
          next?.();
        };
        task.onContinue = (next: () => void) => {
          resume = next;
          continuation.port2.postMessage(null);
        };
        try {
          await task.promise;
        } catch (error) {
          canvas.width = canvas.height = 0;
          throw error;
        } finally {
          signal?.removeEventListener('abort', cancel);
          clearTimeout(retry);
          resume = undefined;
          continuation.port1.close();
          continuation.port2.close();
        }
        return canvas;
      },
      undefined,
      signal,
    );
  }

  async clear(): Promise<void> {
    const entries = [...this.documents.values()];
    this.documents.clear();
    await Promise.allSettled(
      entries.flatMap((entry) => (entry.task ? [entry.task.destroy()] : [])),
    );
  }
  async release(id: string): Promise<void> {
    const entry = this.documents.get(id);
    this.documents.delete(id);
    if (entry?.task) await entry.task.destroy();
  }
}
