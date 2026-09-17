import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Sheet } from '../core/types';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Imported coordinates are the rotated, top-left PDF viewport at scale 1. */
export class PdfDocuments {
  private readonly documents = new Map<string, Promise<PDFDocumentProxy>>();

  constructor(
    private readonly readAsset: (id: string) => Promise<Uint8Array>,
  ) {}

  private document(id: string, bytes?: Uint8Array): Promise<PDFDocumentProxy> {
    const existing = this.documents.get(id);
    if (existing) return existing;
    const result = (async () => {
      const data = bytes ?? (await this.readAsset(id));
      return getDocument({
        // PDF.js transfers this buffer to its worker. Never detach stored bytes.
        data: data.slice(),
        cMapUrl: '/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/',
      }).promise;
    })();
    this.documents.set(id, result);
    void result.catch(() => this.documents.delete(id));
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
    const documents = [...this.documents.values()];
    this.documents.clear();
    await Promise.allSettled(
      documents.map(async (pending) => (await pending).loadingTask.destroy()),
    );
  }
}
