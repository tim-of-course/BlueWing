import {
  createPdfRuntime,
  NULL_PTR,
  type PdfRuntimeModule,
  type Ptr,
} from '@embedpdf/engine-runtime';
import wasmUrl from '@embedpdf/engine-runtime-wasm32/embedpdf.wasm?url';
import type { Sheet } from '../core/types';
import { PdfAvailabilityError, PdfiumSource } from './pdfium-source';
import type { PdfRenderBounds } from './worker-protocol';
import {
  pdfTitleBlockBounds,
  titleBlockRegion,
  TITLE_TEXT_LIMIT,
  type PageText,
} from './page-text';

export const PDFIUM_VERSION = 'embedpdf-3.0.0-next.15';
type Check = () => void;
type Wait = (pending: Promise<void>) => Promise<void>;
function add(pointer: Ptr, bytes: number): Ptr {
  return (pointer + BigInt(bytes)) as Ptr;
}

// A task yield allows worker control messages to run between PDFium chunks.
export function yieldPdf(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

export class PdfiumDocument {
  private source: PdfiumSource | undefined;
  private document = NULL_PTR;
  private constructor(readonly runtime: PdfRuntimeModule) {}

  static async open(
    input: { bytes: Uint8Array } | { length: number },
    request: (rangeId: number, begin: number, end: number) => void,
    attach: (source: PdfiumSource) => void,
    check: Check,
  ): Promise<PdfiumDocument> {
    const runtime = await createPdfRuntime({ prefer: 'wasm', wasmUrl });
    const module = runtime.fn;
    module.EPDF_InitThread();
    check();
    const result = new PdfiumDocument(runtime);
    if ('bytes' in input) {
      const pointer = result.allocate(input.bytes.length);
      runtime.mem.writeBytes(pointer, input.bytes);
      // LoadMemDocument retains this buffer until its owning worker is destroyed.
      result.document = module.FPDF_LoadMemDocument64(
        pointer,
        input.bytes.length,
        '',
      );
    } else {
      result.source = new PdfiumSource(runtime, input.length, request);
      attach(result.source);
      try {
        result.document = await result.source.document(check);
      } catch (error) {
        if (!(error instanceof PdfAvailabilityError)) throw error;
        await result.fallbackToMemory(check);
      }
    }
    check();
    if (!result.document) {
      const code = module.FPDF_GetLastError();
      throw new Error(
        code === 4
          ? 'Password-protected PDFs are not supported'
          : code === 3
            ? 'Invalid PDF file'
            : `Unable to open PDF (PDFium error ${String(code)})`,
      );
    }
    return result;
  }

  get numPages(): number {
    return this.runtime.fn.FPDF_GetPageCount(this.document);
  }

  private allocate(size: number): Ptr {
    const pointer = this.runtime.mem.alloc(size);
    if (!pointer) throw new Error('Not enough memory to render the PDF');
    return pointer;
  }

  private async fallbackToMemory(check: Check): Promise<void> {
    const source = this.source;
    if (!source) throw new Error('PDF data could not be read');
    const buffer = this.allocate(source.length);
    try {
      await source.copyAll(buffer, check);
      check();
      const document = this.runtime.fn.FPDF_LoadMemDocument64(
        buffer,
        source.length,
        '',
      );
      if (!document) throw new Error('Unable to open PDF');
      if (this.document) this.runtime.fn.FPDF_CloseDocument(this.document);
      this.runtime.fn.FPDFAvail_Destroy(source.handle);
      source.releaseChunks();
      this.document = document;
      this.source = undefined;
    } catch (error) {
      this.runtime.mem.free(buffer);
      throw error;
    }
  }

  private async read<T>(run: () => T, check: Check): Promise<T> {
    check();
    return this.source ? this.source.read(run, check) : run();
  }

  async import(assetId: string, name: string, check: Check): Promise<Sheet[]> {
    const sheets: Sheet[] = [];
    const memory = this.allocate(48);
    const module = this.runtime.fn;
    const mem = this.runtime.mem;
    const metadataNotReady = new Error('Unable to read PDF page dimensions');
    try {
      for (let index = 0; index < this.numPages; index++) {
        const readSheet = () => {
          const box = (
            type: number,
          ): [number, number, number, number] | undefined => {
            if (
              !module.EPDF_GetPageBoxByIndex(this.document, index, type, memory)
            )
              return;
            return [0, 4, 8, 12].map((offset) =>
              Number(mem.peek(memory, 'f32', offset)),
            ) as [number, number, number, number];
          };
          const media = box(0) ?? [0, 792, 612, 0];
          const crop = box(1) ?? media;
          let left = Math.max(media[0], crop[0]);
          let top = Math.min(media[1], crop[1]);
          let right = Math.min(media[2], crop[2]);
          let bottom = Math.max(media[3], crop[3]);
          if (right <= left || top <= bottom)
            [left, top, right, bottom] = media;
          if (
            !module.EPDF_GetPageRotateByIndex(this.document, index, memory) ||
            !module.EPDF_GetPageUserUnitByIndex(
              this.document,
              index,
              add(memory, 4),
            )
          )
            throw metadataNotReady;
          const rawRotation = Number(mem.peek(memory, 'i32'));
          const rotation =
            rawRotation % 90 === 0 ? ((rawRotation % 360) + 360) % 360 : 0;
          const unit = Number(mem.peek(memory, 'f32', 4));
          const swaps = rotation === 90 || rotation === 270;
          const width = (swaps ? top - bottom : right - left) * unit;
          const height = (swaps ? right - left : top - bottom) * unit;
          const transforms: Record<0 | 90 | 180 | 270, number[]> = {
            0: [1, 0, 0, -1, -left, top],
            90: [0, 1, 1, 0, -bottom, -left],
            180: [-1, 0, 0, 1, right, -bottom],
            270: [0, -1, -1, 0, top, right],
          };
          const pdfToPage = transforms[rotation as 0 | 90 | 180 | 270].map(
            (value) => value * unit,
          ) as NonNullable<Sheet['pdfToPage']>;
          const labelSize = module.FPDF_GetPageLabel(
            this.document,
            index,
            NULL_PTR,
            0,
          );
          let label: string | undefined;
          if (labelSize) {
            const labelPointer = this.allocate(labelSize);
            try {
              module.FPDF_GetPageLabel(
                this.document,
                index,
                labelPointer,
                labelSize,
              );
              label = mem.readU16String(labelPointer);
            } finally {
              mem.free(labelPointer);
            }
          }
          return {
            id: crypto.randomUUID(),
            assetId,
            name: `${label || `Sheet ${String(index + 1)}`} · ${name.replace(/\.pdf$/i, '')}`,
            pageIndex: index,
            width,
            height,
            rotation,
            pdfToPage,
          } satisfies Sheet;
        };
        let sheet: Sheet;
        try {
          sheet = await this.read(readSheet, check);
        } catch (error) {
          if (error !== metadataNotReady || !this.source) throw error;
          // Linearized PDFs can have a page tree that PDFium has not loaded,
          // even when a metadata lookup requested no additional bytes.
          try {
            await this.source.page(index, check, (pending) => pending);
          } catch (availabilityError) {
            if (!(availabilityError instanceof PdfAvailabilityError))
              throw availabilityError;
            await this.fallbackToMemory(check);
          }
          sheet = await this.read(readSheet, check);
        }
        sheets.push(sheet);
        await yieldPdf();
      }
      return sheets;
    } finally {
      mem.free(memory);
    }
  }

  private page(index: number, check: Check, wait: Wait): Promise<Ptr> {
    const run = () => this.pageOnce(index, check, wait);
    return this.source
      ? this.source.complete(
          run,
          (page) => {
            this.runtime.fn.FPDF_ClosePage(page);
          },
          check,
          wait,
        )
      : run();
  }

  private async pageOnce(
    index: number,
    check: Check,
    wait: Wait,
  ): Promise<Ptr> {
    if (index < 0 || index >= this.numPages)
      throw new Error('PDF page is out of range');
    if (this.source) {
      try {
        await this.source.page(index, check, wait);
      } catch (error) {
        if (!(error instanceof PdfAvailabilityError)) throw error;
        await this.fallbackToMemory(check);
      }
    }
    check();
    const module = this.runtime.fn;
    const object = module.EPDFDoc_GetPageObjectNumberByIndex(
      this.document,
      index,
    );
    const page = module.EPDFDoc_StartLoadPageByObjectNumber(
      this.document,
      object,
      true,
    );
    if (!page) throw new Error('Unable to load PDF page');
    try {
      let status: number;
      while ((status = module.EPDFPage_ContinueLoad(page, 12)) === 0) {
        await wait(yieldPdf());
        check();
      }
      if (status < 0) throw new Error('Unable to parse PDF page');
      if (
        module.FPDF_GetPageWidth(page) <= 0 ||
        module.FPDF_GetPageHeight(page) <= 0
      ) {
        const box = this.allocate(16);
        try {
          const values = await this.read(() => {
            return module.EPDF_GetPageBoxByIndex(this.document, index, 0, box)
              ? [0, 4, 8, 12].map((offset) =>
                  Number(this.runtime.mem.peek(box, 'f32', offset)),
                )
              : [0, 792, 612, 0];
          }, check);
          module.FPDFPage_SetCropBox(
            page,
            values[0] ?? 0,
            values[3] ?? 0,
            values[2] ?? 612,
            values[1] ?? 792,
          );
        } finally {
          this.runtime.mem.free(box);
        }
      }
      check();
      return page;
    } catch (error) {
      module.FPDF_ClosePage(page);
      throw error;
    }
  }

  text(sheet: Sheet, check: Check) {
    const run = () => this.titleBlockOnce(sheet, check);
    return this.source ? this.source.complete(run, () => {}, check) : run();
  }

  private async titleBlockOnce(sheet: Sheet, check: Check): Promise<PageText> {
    const bounds = pdfTitleBlockBounds(sheet);
    const page = await this.page(sheet.pageIndex, check, (pending) => pending);
    const module = this.runtime.fn,
      memoryAccess = this.runtime.mem;
    let text = NULL_PTR,
      memory = NULL_PTR;
    try {
      text = module.FPDFText_LoadPage(page);
      if (!text) throw new Error('Unable to read title-block text');
      check();
      // Native bounded extraction excludes drawing text BEFORE counting/capping.
      // Two calls replace thousands of JS/WASM per-character geometry calls.
      const count = module.FPDFText_GetBoundedText(
        text,
        bounds.left,
        bounds.top,
        bounds.right,
        bounds.bottom,
        NULL_PTR,
        0,
      );
      if (count < 0) throw new Error('Unable to read title-block text');
      const capacity = Math.min(count, TITLE_TEXT_LIMIT) + 1;
      memory = this.allocate(capacity * 2);
      const copied = module.FPDFText_GetBoundedText(
        text,
        bounds.left,
        bounds.top,
        bounds.right,
        bounds.bottom,
        memory,
        capacity,
      );
      if (copied < 0 || copied > capacity)
        throw new Error('Invalid title-block text response');
      let value = (
        new TextDecoder('utf-16le')
          .decode(memoryAccess.readBytes(memory, copied * 2))
          .split(String.fromCharCode(0), 1)[0] ?? ''
      ).slice(0, TITLE_TEXT_LIMIT);
      const last = value.charCodeAt(value.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) value = value.slice(0, -1);
      value = value.trim();
      check();
      return {
        status: value ? 'text' : 'no-title-block-text',
        text: value,
        region: titleBlockRegion(sheet),
        characterCount: count,
        truncated: count > TITLE_TEXT_LIMIT,
      };
    } finally {
      if (memory) memoryAccess.free(memory);
      if (text) module.FPDFText_ClosePage(text);
      module.FPDF_ClosePage(page);
    }
  }

  draw(
    sheet: Sheet,
    bounds: PdfRenderBounds,
    scale: number,
    check: Check,
    wait: Wait,
  ): Promise<OffscreenCanvas> {
    const run = () => this.drawOnce(sheet, bounds, scale, check, wait);
    return this.source
      ? this.source.complete(
          run,
          (canvas) => {
            canvas.width = canvas.height = 0;
          },
          check,
          wait,
        )
      : run();
  }

  private async drawOnce(
    sheet: Sheet,
    bounds: PdfRenderBounds,
    scale: number,
    check: Check,
    wait: Wait,
  ): Promise<OffscreenCanvas> {
    const page = await this.page(sheet.pageIndex, check, wait);
    const module = this.runtime.fn;
    const mem = this.runtime.mem;
    const width = Math.ceil(bounds.width * scale),
      height = Math.ceil(bounds.height * scale);
    let bitmap = NULL_PTR,
      pixels = NULL_PTR,
      matrix = NULL_PTR,
      clip = NULL_PTR;
    try {
      pixels = this.allocate(width * height * 4);
      bitmap = module.FPDFBitmap_CreateEx(width, height, 4, pixels, width * 4);
      if (!bitmap) throw new Error('Unable to allocate the PDF bitmap');
      module.FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
      matrix = this.allocate(24);
      clip = this.allocate(16);
      const rotation = sheet.rotation ?? 0;
      const rawWidth = module.FPDF_GetPageWidth(page),
        rawHeight = module.FPDF_GetPageHeight(page);
      const unit =
        sheet.width /
        (rotation === 90 || rotation === 270 ? rawHeight : rawWidth);
      const s = scale * unit,
        x = -bounds.x * scale,
        y = -bounds.y * scale;
      // PDFium supplies the normalized crop-origin/Y-flip transform. Add the
      // sheet's rotation, physical units, exact output scale and region offset.
      const transforms: Record<number, number[]> = {
        0: [s, 0, 0, s, x, y],
        90: [0, s, -s, 0, rawHeight * s + x, y],
        180: [-s, 0, 0, -s, rawWidth * s + x, rawHeight * s + y],
        270: [0, -s, s, 0, x, rawWidth * s + y],
      };
      const transform = transforms[rotation];
      if (!transform) throw new Error('Invalid PDF page rotation');
      transform.forEach((value, index) => {
        mem.poke(matrix, 'f32', value, index * 4);
      });
      [0, 0, width, height].forEach((value, index) => {
        mem.poke(clip, 'f32', value, index * 4);
      });
      // ANNOT + REVERSE_BYTE_ORDER + WIDGETS. Grayscale text antialiasing;
      // LCD_TEXT would bake colored fringes into the cached source image.
      let status = module.EPDF_RenderPageBitmapWithMatrix_Start(
        bitmap,
        page,
        matrix,
        clip,
        0x8011,
        12,
      );
      while (status === 1) {
        await wait(yieldPdf());
        check();
        status = module.EPDF_RenderPage_Continue(page, 12);
      }
      check();
      if (status !== 2)
        throw new Error('PDFium could not finish rendering this page');
      const canvas = new OffscreenCanvas(width, height);
      // PDFium already supplies CPU pixels. Keep cache encoding on CPU too:
      // GPU-backed worker canvases share WebView2 graphics resources with the
      // interactive viewer and can stall its frames during large PNG readback.
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('PDF render context unavailable');
      // readBytes owns a copy that survives freeing or growing the WASM heap.
      const rgba = new Uint8ClampedArray(
        mem.readBytes(pixels, width * height * 4).buffer as ArrayBuffer,
      );
      context.putImageData(new ImageData(rgba, width, height), 0, 0);
      return canvas;
    } finally {
      module.FPDF_RenderPage_Close(page);
      if (bitmap) module.FPDFBitmap_Destroy(bitmap);
      if (clip) mem.free(clip);
      if (matrix) mem.free(matrix);
      if (pixels) mem.free(pixels);
      module.FPDF_ClosePage(page);
    }
  }
}
