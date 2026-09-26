import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { Sheet } from '../core/types';
import { suggestSheetName, type SheetNameSuggestion } from './sheet-names';

GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

/** Imported coordinates are the rotated, top-left PDF viewport at scale 1. */
export class PdfDocuments {
  private readonly documents = new Map<string, Promise<PDFDocumentProxy>>();
  private readonly loadingTasks = new Map<string, PDFDocumentLoadingTask>();

  constructor(
    private readonly readAsset: (id: string) => Promise<Uint8Array>,
  ) {}

  private document(id: string, bytes?: Uint8Array): Promise<PDFDocumentProxy> {
    const existing = this.documents.get(id);
    if (existing) return existing;
    const result = Promise.resolve().then(async () => {
      const data = bytes ?? (await this.readAsset(id));
      if (this.documents.get(id) !== result)
        throw new Error('PDF loading was cancelled');
      const task = getDocument({
        // Imports retain their caller's buffer; loaded assets are fresh owned bytes.
        // PDF.js transfers the buffer to its worker.
        data: bytes ? data.slice() : data,
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/',
      });
      this.loadingTasks.set(id, task);
      try {
        return await task.promise;
      } catch (error) {
        if (this.loadingTasks.get(id) === task) this.loadingTasks.delete(id);
        await task.destroy().catch(() => undefined);
        throw error;
      }
    });
    this.documents.set(id, result);
    void result.catch(() => {
      if (this.documents.get(id) === result) this.documents.delete(id);
    });
    return result;
  }

  async import(id: string, name: string, bytes: Uint8Array): Promise<Sheet[]> {
    const document = await this.document(id, bytes);
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
  }

  async render(sheet: Sheet, maxDimension = 2400): Promise<HTMLCanvasElement> {
    return this.renderRegion(
      sheet,
      { x: 0, y: 0, width: sheet.width, height: sheet.height },
      maxDimension,
    );
  }

  async suggestName(sheet: Sheet): Promise<SheetNameSuggestion> {
    const pdf = await this.document(sheet.assetId);
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
  }

  async renderRegion(
    sheet: Sheet,
    bounds: { x: number; y: number; width: number; height: number },
    maxDimension: number,
  ): Promise<HTMLCanvasElement> {
    const pdf = await this.document(sheet.assetId);
    const page = await pdf.getPage(sheet.pageIndex + 1);
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
    await page.render({ canvas, viewport, intent: 'print' }).promise;
    return canvas;
  }

  async clear(): Promise<void> {
    const tasks = [...this.loadingTasks.values()];
    this.documents.clear();
    this.loadingTasks.clear();
    await Promise.allSettled(tasks.map((task) => task.destroy()));
  }
  async release(id: string): Promise<void> {
    const task = this.loadingTasks.get(id);
    this.documents.delete(id);
    this.loadingTasks.delete(id);
    if (task) await task.destroy();
  }
}
