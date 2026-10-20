/* global self, ImageData, createImageBitmap, performance */
import { PDFiumModule } from '/vendor/pdfium/dist/index.esm.browser.js';

let module;
let document;
let page = 0;
let pageNumber;

function closePage() {
  if (page) module._FPDF_ClosePage(page);
  page = 0;
  pageNumber = undefined;
}
function loadPage(number) {
  if (pageNumber !== number) {
    closePage();
    page = module._FPDF_LoadPage(document, number - 1);
    if (!page) throw new Error(`PDFium could not load page ${number}.`);
    pageNumber = number;
  }
  return page;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      module = await PDFiumModule({
        locateFile: () => '/vendor/pdfium/dist/pdfium.wasm',
      });
      module._FPDF_InitLibraryWithConfig({
        version: 2,
        m_pIsolate: null,
        m_pUserFontPaths: null,
        m_v8EmbedderSlot: 0,
        m_pPlatform: null,
      });
      self.postMessage({ ready: true });
    } else if (data.type === 'open') {
      const source = module.wasmExports.malloc(data.bytes.byteLength);
      if (!source)
        throw new Error('PDFium could not allocate the source buffer.');
      module.HEAPU8.set(data.bytes, source);
      document = module._FPDF_LoadMemDocument(source, data.bytes.byteLength, 0);
      if (!document)
        throw new Error(
          `PDFium could not open this PDF (error ${module._FPDF_GetLastError()}).`,
        );
      self.postMessage({ pageCount: module._FPDF_GetPageCount(document) });
    } else if (data.type === 'size') {
      const handle = loadPage(data.number);
      self.postMessage({
        width: module._FPDF_GetPageWidth(handle),
        height: module._FPDF_GetPageHeight(handle),
      });
    } else if (data.type === 'render') {
      const handle = loadPage(data.number);
      const { width, height } = data;
      const started = performance.now();
      const pixels = module.wasmExports.malloc(width * height * 4);
      let bitmap = 0;
      try {
        if (!pixels)
          throw new Error('PDFium could not allocate the page bitmap.');
        // BGRA with reverse byte order gives RGBA pixels, including alpha.
        bitmap = module._FPDFBitmap_CreateEx(
          width,
          height,
          4,
          pixels,
          width * 4,
        );
        if (!bitmap)
          throw new Error('PDFium could not create the page bitmap.');
        module._FPDFBitmap_FillRect(bitmap, 0, 0, width, height, 0xffffffff);
        // ANNOT | REVERSE_BYTE_ORDER. Deliberately omit LCD_TEXT and PRINTING.
        module._FPDF_RenderPageBitmap(
          bitmap,
          handle,
          0,
          0,
          width,
          height,
          0,
          1 | 16,
        );
        const rendered = performance.now();
        // Keep the WASM allocation alive until the browser has copied the pixels.
        const image = await createImageBitmap(
          new ImageData(
            new Uint8ClampedArray(
              module.HEAPU8.buffer,
              pixels,
              width * height * 4,
            ),
            width,
            height,
          ),
        );
        self.postMessage(
          {
            bitmap: image,
            timings: {
              'Worker compute': rendered - started,
              Bitmap: performance.now() - rendered,
            },
          },
          [image],
        );
      } finally {
        if (bitmap) module._FPDFBitmap_Destroy(bitmap);
        if (pixels) module.wasmExports.free(pixels);
        closePage();
      }
    }
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
