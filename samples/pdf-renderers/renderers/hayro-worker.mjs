/* global self, ImageData, createImageBitmap, performance */
import init, { PdfViewer } from '/vendor/hayro/hayro_demo_simd.js';

let viewer;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await init();
      self.postMessage({ ready: true });
    } else if (data.type === 'open') {
      viewer = new PdfViewer();
      viewer.load_pdf(data.bytes);
      self.postMessage({
        pageCount: viewer.get_total_pages(),
        dimensions: Array.from(viewer.get_page_dimensions()),
      });
    } else {
      const started = performance.now();
      const [width, height, pixels] = viewer.render_page(
        data.number,
        data.width,
        data.height,
        1,
        1,
        false,
      );
      const rendered = performance.now();
      const bitmap = await createImageBitmap(
        new ImageData(
          new Uint8ClampedArray(
            pixels.buffer,
            pixels.byteOffset,
            pixels.byteLength,
          ),
          width,
          height,
        ),
      );
      self.postMessage(
        {
          bitmap,
          timings: {
            'Worker compute': rendered - started,
            Bitmap: performance.now() - rendered,
          },
        },
        [bitmap],
      );
    }
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
