/** Own a codec heap for one image, then release it instead of retaining gigabytes per PDF. */
export function encodeJpegXl(
  pixels: { data: Uint8ClampedArray; width: number; height: number },
  signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  const worker = new Worker(
    new URL('./jpeg-xl-encode-worker.ts', import.meta.url),
    { type: 'module' },
  );
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', cancel);
      worker.terminate();
    };
    const cancel = () => {
      finish();
      reject(new Error('JPEG XL encoding was cancelled'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    worker.onmessage = (
      event: MessageEvent<{ bytes: Uint8Array } | { error: string }>,
    ) => {
      finish();
      if ('error' in event.data) reject(new Error(event.data.error));
      else resolve(event.data.bytes);
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message));
    };
    worker.postMessage(
      { data: pixels.data, width: pixels.width, height: pixels.height },
      [pixels.data.buffer],
    );
  });
}
