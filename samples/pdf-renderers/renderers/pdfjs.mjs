import {
  getDocument,
  GlobalWorkerOptions,
} from '/vendor/pdfjs/build/pdf.min.mjs';

GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.min.mjs';

/** open(bytes) owns the input buffer and returns the renderer contract. */
export async function open(bytes) {
  const task = getDocument({
    data: bytes,
    cMapUrl: '/vendor/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
    wasmUrl: '/vendor/pdfjs/wasm/',
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (error) {
    await task.destroy();
    throw error;
  }
  return {
    pageCount: pdf.numPages,
    async pageSize(number) {
      const page = await pdf.getPage(number);
      const { width, height } = page.getViewport({ scale: 1 });
      return { width, height };
    },
    async render(number, scale, canvas) {
      const page = await pdf.getPage(number);
      try {
        await page.render({
          canvas,
          canvasContext: canvas.getContext('2d', { alpha: true }),
          viewport: page.getViewport({ scale }),
          intent: 'display',
        }).promise;
      } finally {
        page.cleanup();
      }
    },
    destroy: () => task.destroy(),
  };
}
