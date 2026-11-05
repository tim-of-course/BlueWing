import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Sheet } from '../../src/core/types';
import { PageImages, PAGE_PREVIEW_DIMENSION } from '../../src/pdf/page-images';

void test('a saved preview can load while a master decode is stalled', async () => {
  const original = globalThis.Worker;
  let masterStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    masterStarted = resolve;
  });
  class StalledWorker {
    onmessage?: (event: MessageEvent) => void;
    onerror?: (event: ErrorEvent) => void;
    private busy = false;
    postMessage(message: {
      type: string;
      id: number;
      width: number;
      height: number;
      bytes: Uint8Array;
    }) {
      if (message.type !== 'decode') return;
      if (this.busy) return;
      if (message.width > PAGE_PREVIEW_DIMENSION) {
        this.busy = true;
        masterStarted();
        return;
      }
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            id: message.id,
            bytes: message.bytes,
            bitmap: {
              width: message.width,
              height: message.height,
              close() {},
            },
          },
        } as MessageEvent),
      );
    }
    terminate() {}
  }
  globalThis.Worker = StalledWorker as unknown as typeof Worker;
  const sheet: Sheet = {
    id: 'sheet',
    name: 'sheet',
    assetId: 'plan',
    pageIndex: 0,
    width: 1188,
    height: 594,
  };
  const images = new PageImages(
    () => Promise.reject(new Error('Unexpected PDF render')),
    {
      read: () => Promise.resolve(new Uint8Array([1])),
      write: () => Promise.resolve(),
      exists: () => Promise.resolve(true),
    },
  );
  const master = images.acquire(sheet).catch(() => undefined);
  try {
    await started;
    const preview = await Promise.race([
      images.acquire(sheet, PAGE_PREVIEW_DIMENSION),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          reject(new Error('Preview was blocked'));
        }, 500),
      ),
    ]);
    assert.equal(preview.width, PAGE_PREVIEW_DIMENSION);
    preview.release();
  } finally {
    images.clear();
    await master;
    globalThis.Worker = original;
  }
});
