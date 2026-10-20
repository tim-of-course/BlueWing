/* global Worker, URL, performance */
export async function open(bytes) {
  const worker = new Worker(new URL('./pdfium-worker.mjs', import.meta.url), {
    type: 'module',
  });
  // The viewer serializes operations; each worker owns one document and WASM heap.
  const request = (message, transfer = []) =>
    new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) =>
        data.error ? reject(new Error(data.error)) : resolve(data);
      worker.onerror = (event) =>
        reject(
          new Error(
            `${event.message || 'PDFium worker failed'}. Run bun samples/pdf-renderers/setup-pdfium.mjs if its assets are missing.`,
          ),
        );
      worker.postMessage(message, transfer);
    });
  let metadata;
  const started = performance.now();
  let initialized;
  try {
    await request({ type: 'init' });
    initialized = performance.now();
    metadata = await request({ type: 'open', bytes }, [bytes.buffer]);
  } catch (error) {
    worker.terminate();
    throw error;
  }
  return {
    openTimings: {
      'Worker init': initialized - started,
      'PDF open': performance.now() - initialized,
    },
    pageCount: metadata.pageCount,
    pageSize: (number) => request({ type: 'size', number }),
    async render(number, _scale, canvas) {
      const { bitmap, timings } = await request({
        type: 'render',
        number,
        width: canvas.width,
        height: canvas.height,
      });
      try {
        canvas.getContext('2d', { alpha: true }).drawImage(bitmap, 0, 0);
      } finally {
        bitmap.close();
      }
      return timings;
    },
    // Termination also releases the document, source bytes and entire WASM heap.
    destroy: () => worker.terminate(),
  };
}
