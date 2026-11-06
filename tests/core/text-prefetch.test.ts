import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TextPrefetch } from '../../src/pdf/text-prefetch';
import {
  pdfTitleBlockBounds,
  titleBlockRegion,
  type PageText,
} from '../../src/pdf/page-text';
import type { Sheet } from '../../src/core/types';

const sheet: Sheet = {
  id: 'one',
  name: 'Page 1',
  assetId: 'pdf',
  pageIndex: 0,
  width: 1000,
  height: 800,
};
const value: PageText = {
  status: 'text',
  text: 'A101 FLOOR PLAN',
  region: { x: 500, y: 400, width: 500, height: 400 },
  characterCount: 15,
  truncated: false,
};
async function until(done: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (done()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail('prefetch did not settle');
}
void test('prefetch deduplicates queued work and reuses text across sheet renames', async () => {
  let reads = 0;
  const cache = new TextPrefetch(() => {
    reads++;
    return Promise.resolve(structuredClone(value));
  });
  cache.prefetch([sheet, { ...sheet, id: 'two', pageIndex: 1 }]);
  cache.prefetch([sheet]);
  await until(() => cache.status([sheet]).ready === 1);
  cache.prefetch([{ ...sheet, name: 'New name' }]);
  await until(
    () =>
      cache.status([sheet, { ...sheet, id: 'two', pageIndex: 1 }]).ready === 2,
  );
  assert.equal(reads, 2);
  const first = cache.get({ ...sheet, name: 'New name' });
  assert.equal(first.name, 'New name');
  if ('text' in first) first.text = 'changed response';
  const repeated = cache.get(sheet);
  assert.equal('text' in repeated ? repeated.text : undefined, value.text);
});
void test('clear cancels active extraction and late results cannot enter a new project cache', async () => {
  let finish: (value: PageText) => void = () => {};
  let signal: AbortSignal | undefined;
  const cache = new TextPrefetch((_, current) => {
    signal = current;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  cache.prefetch([sheet]);
  cache.clear();
  assert.equal(signal?.aborted, true);
  finish(value);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(cache.get(sheet).status, 'not-cached');
  assert.equal(cache.status([sheet]).cacheBytes, 0);
});
void test('errors remain explicit and can be retried, and rotation changes invalidate text', async () => {
  let fail = true;
  const cache = new TextPrefetch(() => {
    if (fail) return Promise.reject(new Error('read failed'));
    return Promise.resolve(value);
  });
  cache.prefetch([sheet]);
  await until(() => cache.get(sheet).status === 'error');
  assert.equal(cache.get(sheet).error, 'read failed');
  assert.deepEqual(cache.get(sheet).region, titleBlockRegion(sheet));
  fail = false;
  cache.prefetch([sheet]);
  await until(() => cache.get(sheet).status === 'text');
  assert.equal(cache.get({ ...sheet, rotation: 90 }).status, 'not-cached');
  cache.cancel();
  assert.equal(cache.get(sheet).status, 'text');
});
void test('a new prefetch queued before cancelled native work settles still runs', async () => {
  let finish: (value: PageText) => void = () => {};
  let reads = 0;
  const cache = new TextPrefetch(() => {
    reads++;
    return reads === 1
      ? new Promise<PageText>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(value);
  });
  cache.prefetch([sheet]);
  cache.clear();
  const next = { ...sheet, id: 'new-project-sheet' };
  cache.prefetch([next]);
  finish(value);
  await until(() => cache.status([next]).ready === 1);
  assert.equal(cache.get(sheet).status, 'not-cached');
  assert.equal(reads, 2);
});
void test('prefetch uses a bounded LRU and reports evicted pages as not cached', async () => {
  const bytes = JSON.stringify(value).length * 2 + 256;
  const cache = new TextPrefetch(() => Promise.resolve(value), bytes);
  const two = { ...sheet, id: 'two', pageIndex: 1 };
  cache.prefetch([sheet, two]);
  await until(() => cache.status([two]).ready === 1);
  assert.equal(cache.get(sheet).status, 'not-cached');
  assert.equal(cache.status([sheet, two]).cacheBytes, bytes);
  cache.clear();
  assert.equal(cache.status([sheet]).cacheBytes, 0);
});
void test('title-block bounds follow the displayed bottom-right quarter including rotation and crop', () => {
  assert.deepEqual(titleBlockRegion(sheet), {
    x: 500,
    y: 400,
    width: 500,
    height: 400,
  });
  assert.deepEqual(pdfTitleBlockBounds(sheet), {
    left: 500,
    right: 1000,
    bottom: -0,
    top: 400,
  });
  assert.deepEqual(
    pdfTitleBlockBounds({ ...sheet, pdfToPage: [0, 1, 1, 0, -20, -30] }),
    { left: 430, right: 830, bottom: 520, top: 1020 },
  );
  assert.throws(
    () => pdfTitleBlockBounds({ ...sheet, pdfToPage: [0, 0, 0, 0, 0, 0] }),
    /Invalid PDF page transform/,
  );
});
