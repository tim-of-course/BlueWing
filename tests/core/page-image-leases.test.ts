import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Sheet } from '../../src/core/types';
import {
  PageImages,
  PAGE_IMAGE_DIMENSION,
  PAGE_PREVIEW_DIMENSION,
} from '../../src/pdf/page-images';
import type { EncodedRaster, RasterImage } from '../../src/pdf/worker-protocol';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function bitmap(dimension: number) {
  let closes = 0;
  const source = {
    width: dimension,
    height: dimension / 2,
    close: () => {
      closes++;
    },
  };
  return { source: source as unknown as ImageBitmap, closes: () => closes };
}
function sheet(id: string): Sheet {
  return {
    id,
    name: id,
    assetId: 'plan',
    pageIndex: Number(id),
    width: 100,
    height: 50,
  };
}

void test('display leases survive eviction and cache clear, with one final pixel release', async () => {
  const sources: ReturnType<typeof bitmap>[] = [];
  const images = new PageImages(
    (_sheet, dimension) => {
      const source = bitmap(dimension);
      sources.push(source);
      return Promise.resolve({
        bitmap: source.source,
        encoded: Promise.resolve({ bytes: new Uint8Array([1]) }),
      });
    },
    undefined,
    1,
  );
  const first = await images.acquire(sheet('0'), 64);
  const second = await images.acquire(sheet('1'), 64);
  assert.ok(sources[0]);
  assert.equal(sources[0].closes(), 0);
  images.clear();
  assert.equal(sources[0].closes(), 0);
  assert.equal(sources[1]?.closes(), 0);
  first.release();
  first.release();
  second.release();
  assert.deepEqual(
    sources.map((source) => source.closes()),
    [1, 1],
  );
});

void test('full pixels display before encoding and a concurrent preview shares the full render', async () => {
  const encoding = deferred<EncodedRaster>();
  const drawing = deferred<RasterImage>();
  const calls: number[] = [];
  const full = bitmap(PAGE_IMAGE_DIMENSION),
    preview = bitmap(PAGE_PREVIEW_DIMENSION);
  const images = new PageImages((_sheet, dimension) => {
    calls.push(dimension);
    return drawing.promise;
  });
  const display = images.acquire(sheet('0'));
  const thumbnail = images.preview(sheet('0'));
  drawing.resolve({
    bitmap: full.source,
    previewBitmap: preview.source,
    encoded: encoding.promise,
  });
  const lease = await display;
  assert.equal(lease.source, full.source);
  assert.deepEqual(calls, [PAGE_IMAGE_DIMENSION]);
  encoding.resolve({
    bytes: new Uint8Array([1]),
    previewBytes: new Uint8Array([2]),
  });
  assert.deepEqual(await thumbnail, new Uint8Array([2]));
  lease.release();
  images.clear();
  assert.equal(full.closes(), 1);
  assert.equal(preview.closes(), 1);
});

void test('one cancelled viewer leaves a shared render running for the remaining viewer', async () => {
  const drawing = deferred<RasterImage>();
  const began = deferred<AbortSignal>();
  const source = bitmap(64);
  const images = new PageImages((_sheet, _dimension, signal) => {
    began.resolve(signal);
    return drawing.promise;
  });
  const abort = new AbortController();
  const cancelled = images.acquire(sheet('0'), 64, abort.signal);
  const retained = images.acquire(sheet('0'), 64);
  const workerSignal = await began.promise;
  abort.abort(new Error('Viewer left'));
  await assert.rejects(cancelled, /Viewer left/);
  assert.equal(workerSignal.aborted, false);
  drawing.resolve({
    bitmap: source.source,
    encoded: Promise.resolve({ bytes: new Uint8Array([1]) }),
  });
  const lease = await retained;
  lease.release();
  images.clear();
  assert.equal(source.closes(), 1);
});

void test('clearing a pending render discards and releases its late pixels', async () => {
  const drawing = deferred<RasterImage>(),
    began = deferred<undefined>();
  const source = bitmap(64);
  const images = new PageImages(() => {
    began.resolve(undefined);
    return drawing.promise;
  });
  const pending = images.acquire(sheet('0'), 64);
  const failure = assert.rejects(pending);
  await began.promise;
  images.clear();
  drawing.resolve({
    bitmap: source.source,
    encoded: Promise.resolve({ bytes: new Uint8Array([1]) }),
  });
  await failure;
  assert.equal(source.closes(), 1);
});

void test('failed PNG encoding preserves displayed pixels and lets a thumbnail retry', async () => {
  const encoding = deferred<EncodedRaster>();
  const full = bitmap(PAGE_IMAGE_DIMENSION),
    preview = bitmap(PAGE_PREVIEW_DIMENSION);
  const calls: number[] = [];
  const images = new PageImages((_sheet, dimension) => {
    calls.push(dimension);
    return Promise.resolve(
      calls.length === 1
        ? {
            bitmap: full.source,
            previewBitmap: preview.source,
            encoded: encoding.promise,
          }
        : {
            bitmap: bitmap(dimension).source,
            encoded: Promise.resolve({ bytes: new Uint8Array([3]) }),
          },
    );
  });
  const display = await images.acquire(sheet('0'));
  const thumbnail = images.preview(sheet('0'));
  encoding.reject(new Error('PNG encoding failed'));
  await assert.rejects(thumbnail, /PNG encoding failed/);
  assert.equal(full.closes(), 0);
  assert.deepEqual(await images.preview(sheet('0')), new Uint8Array([3]));
  assert.deepEqual(calls, [PAGE_IMAGE_DIMENSION, PAGE_PREVIEW_DIMENSION]);
  images.clear();
  display.release();
  assert.equal(full.closes(), 1);
});
