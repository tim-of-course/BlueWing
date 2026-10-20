import {
  createPdfRuntime,
  NULL_PTR,
  type PdfRuntimeModule,
  type Ptr,
} from '@embedpdf/engine-runtime';
import wasmUrl from '@embedpdf/engine-runtime-wasm32/embedpdf.wasm?url';
import type { Sheet } from '../core/types';
import { PdfiumSource } from './pdfium-source';
import { suggestSheetName, type SheetTextItem } from './sheet-names';
import type { PdfRenderBounds } from './worker-protocol';

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
      result.document = await result.source.document(check);
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

  private async read<T>(run: () => T, check: Check): Promise<T> {
    check();
    return this.source ? this.source.read(run, check) : run();
  }

  async import(assetId: string, name: string, check: Check): Promise<Sheet[]> {
    const sheets: Sheet[] = [];
    const memory = this.allocate(48);
    const module = this.runtime.fn;
    const mem = this.runtime.mem;
    try {
      for (let index = 0; index < this.numPages; index++) {
        const sheet = await this.read(() => {
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
            throw new Error('Unable to read PDF page dimensions');
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
        }, check);
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
    await this.source?.page(index, check, wait);
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

  name(sheet: Sheet, check: Check) {
    const run = () => this.nameOnce(sheet, check);
    return this.source ? this.source.complete(run, () => {}, check) : run();
  }

  private async nameOnce(sheet: Sheet, check: Check) {
    if ((sheet.rotation ?? 0) % 90 !== 0)
      throw new Error('Invalid PDF page rotation');
    const page = await this.page(sheet.pageIndex, check, (pending) => pending);
    const module = this.runtime.fn;
    const memoryAccess = this.runtime.mem;
    const text = module.FPDFText_LoadPage(page);
    const memory = this.allocate(48);
    try {
      const items: SheetTextItem[] = [];
      let run: SheetTextItem | undefined;
      const count = module.FPDFText_CountChars(text);
      for (let index = 0; index < count; index++) {
        if (index % 1024 === 0) {
          await yieldPdf();
          check();
        }
        const unicode = module.FPDFText_GetUnicode(text, index);
        if (!unicode || unicode < 32) {
          run = undefined;
          continue;
        }
        const str = String.fromCodePoint(unicode);
        if (!module.FPDFText_GetCharOrigin(text, index, memory, add(memory, 8)))
          continue;
        const x = Number(memoryAccess.peek(memory, 'f64'));
        const y = Number(memoryAccess.peek(memory, 'f64', 8));
        const angle = module.FPDFText_GetCharAngle(text, index);
        const height = module.FPDFText_GetFontSize(text, index);
        const cosine = Math.cos(angle),
          sine = Math.sin(angle);
        module.FPDFText_GetCharBox(
          text,
          index,
          add(memory, 16),
          add(memory, 24),
          add(memory, 32),
          add(memory, 40),
        );
        const width =
          Math.abs(cosine) *
            (Number(memoryAccess.peek(memory, 'f64', 24)) -
              Number(memoryAccess.peek(memory, 'f64', 16))) +
          Math.abs(sine) *
            (Number(memoryAccess.peek(memory, 'f64', 40)) -
              Number(memoryAccess.peek(memory, 'f64', 32)));
        const dx = x - (run?.transform[4] ?? x),
          dy = y - (run?.transform[5] ?? y);
        const advance = dx * cosine + dy * sine;
        if (
          run &&
          Math.abs(dx * sine - dy * cosine) < height * 0.2 &&
          Math.abs((run.transform[0] ?? 0) - cosine * height) < 0.1 &&
          advance >= 0 &&
          advance - run.width < height * 2
        ) {
          run.str += str;
          run.width = advance + width;
        } else {
          run = {
            str,
            transform: [
              cosine * height,
              sine * height,
              -sine * height,
              cosine * height,
              x,
              y,
            ],
            width,
            height,
          };
          items.push(run);
        }
      }
      return suggestSheetName(items, {
        width: sheet.width,
        height: sheet.height,
        transform: sheet.pdfToPage ?? [1, 0, 0, -1, 0, sheet.height],
      });
    } finally {
      memoryAccess.free(memory);
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
      const context = canvas.getContext('2d');
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
