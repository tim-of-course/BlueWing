/* global Worker, URL, performance */
export async function open(bytes) {
  const worker = new Worker(new URL('./hayro-worker.mjs', import.meta.url), {
    type: 'module',
  });
  // The sample serializes operations, so only one request can be pending.
  const request = (message, transfer = []) =>
    new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) =>
        data.error ? reject(new Error(data.error)) : resolve(data);
      worker.onerror = (event) =>
        reject(
          new Error(
            event.message ||
              'Hayro worker failed. Run the Hayro setup command in README.',
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
    async pageSize(number) {
      return {
        width: metadata.dimensions[(number - 1) * 2],
        height: metadata.dimensions[(number - 1) * 2 + 1],
      };
    },
    async render(number, scale, canvas) {
      const { width, height } = await this.pageSize(number);
      const { bitmap, timings } = await request({
        type: 'render',
        number,
        width: width * scale,
        height: height * scale,
      });
      try {
        if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
        if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
        canvas.getContext('2d', { alpha: true }).drawImage(bitmap, 0, 0);
      } finally {
        bitmap.close();
      }
      return timings;
    },
    destroy: () => worker.terminate(),
  };
}
