import { encodeJpegXlPixels } from './jpeg-xl';

self.addEventListener(
  'message',
  (
    event: MessageEvent<{
      data: Uint8ClampedArray;
      width: number;
      height: number;
    }>,
  ) => {
    void encodeJpegXlPixels(event.data).then(
      (bytes) => {
        self.postMessage({ bytes }, { transfer: [bytes.buffer] });
      },
      (reason: unknown) => {
        self.postMessage({
          error: reason instanceof Error ? reason.message : String(reason),
        });
      },
    );
  },
);
