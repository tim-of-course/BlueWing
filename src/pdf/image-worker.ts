interface DecodeRequest {
  type: 'decode';
  id: number;
  bytes: Uint8Array;
  width?: number;
  height?: number;
  dimension?: number;
}
const jobs = new Map<number, DecodeRequest>();
let running = false;
function priority(job: DecodeRequest) {
  return !job.dimension && Math.max(job.width ?? 0, job.height ?? 0) > 640
    ? 100
    : 40;
}

// Decode one image at a time. Rapid navigation drops queued work instead of
// accumulating concurrent full-page buffers. Native decode itself is not cancellable.
async function pump() {
  if (running) return;
  running = true;
  try {
    while (jobs.size) {
      const ordered = [...jobs.values()].sort(
        (a, b) => priority(b) - priority(a),
      );
      const job = ordered[0];
      if (!job) break;
      let bitmap: ImageBitmap | undefined;
      let canvas: OffscreenCanvas | undefined;
      try {
        bitmap = await createImageBitmap(
          new Blob([job.bytes.buffer as ArrayBuffer], { type: 'image/png' }),
        );
        if (!jobs.has(job.id)) continue;
        let bytes = job.bytes;
        if (job.dimension) {
          const scale = job.dimension / Math.max(bitmap.width, bitmap.height);
          canvas = new OffscreenCanvas(
            Math.ceil(bitmap.width * scale),
            Math.ceil(bitmap.height * scale),
          );
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Preview canvas is unavailable');
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          bitmap = await createImageBitmap(canvas);
          if (!jobs.has(job.id)) continue;
          bytes = new Uint8Array(
            await (
              await canvas.convertToBlob({ type: 'image/png' })
            ).arrayBuffer(),
          );
        } else if (bitmap.width !== job.width || bitmap.height !== job.height) {
          throw new Error('Cached page dimensions changed');
        }
        if (!jobs.has(job.id)) continue;
        self.postMessage(
          { id: job.id, bitmap, bytes },
          { transfer: [bitmap, bytes.buffer as ArrayBuffer] },
        );
        bitmap = undefined;
      } catch (error) {
        if (jobs.has(job.id))
          self.postMessage({
            id: job.id,
            error: error instanceof Error ? error.message : String(error),
          });
      } finally {
        bitmap?.close();
        if (canvas) canvas.width = canvas.height = 0;
        jobs.delete(job.id);
      }
    }
  } finally {
    running = false;
  }
}

self.addEventListener(
  'message',
  (event: MessageEvent<DecodeRequest | { type: 'cancel'; id: number }>) => {
    const message = event.data;
    if (message.type === 'cancel') {
      jobs.delete(message.id);
    } else {
      jobs.set(message.id, message);
      void pump();
    }
  },
);
export {};
