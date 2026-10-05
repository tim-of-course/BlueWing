import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NATIVE_CHUNK_BYTES,
  nativeRange,
  readNativeChunks,
} from '../../src/platform/native-bytes';

void test('native bytes preserve chunk boundaries with raw and WebView fallback responses', async () => {
  const source = new Uint8Array(NATIVE_CHUNK_BYTES + 7);
  for (let i = 0; i < source.length; i++) source[i] = i % 251;
  const requests: number[][] = [];
  let active = false;
  const result = await readNativeChunks(
    source.length,
    async (offset, length) => {
      assert.equal(active, false, 'only one IPC chunk may be live at a time');
      active = true;
      requests.push([offset, length]);
      await Promise.resolve();
      active = false;
      return offset === 0
        ? source.buffer.slice(offset, offset + length)
        : Array.from(source.subarray(offset, offset + length));
    },
  );
  assert.deepEqual(result, source);
  assert.deepEqual(requests, [
    [0, NATIVE_CHUNK_BYTES],
    [NATIVE_CHUNK_BYTES, 7],
  ]);
  assert.equal(
    (
      await readNativeChunks(0, () => {
        throw new Error('no read for empty bytes');
      })
    ).length,
    0,
  );
  await assert.rejects(
    readNativeChunks(4, () => Promise.resolve(new ArrayBuffer(3))),
    /Incomplete/,
  );
  await assert.rejects(
    readNativeChunks(-1, () => Promise.resolve([])),
    /Invalid/,
  );
});

void test('native ranges read only requested bytes and split large ranges at the IPC limit', async () => {
  const length = 349354454;
  const reads: number[][] = [];
  const range = nativeRange(length, (offset, size) => {
    reads.push([offset, size]);
    const chunk = new Uint8Array(size);
    for (let index = 0; index < size; index++)
      chunk[index] = (offset + index) % 251;
    return Promise.resolve(chunk.buffer);
  });
  assert.equal(range.length, length);
  assert.deepEqual(reads, [], 'opening a range source does not read the file');
  const tail = await range.read(length - 5, 5);
  assert.deepEqual(
    Array.from(tail),
    Array.from({ length: 5 }, (_, index) => (length - 5 + index) % 251),
  );
  const middle = await range.read(73, NATIVE_CHUNK_BYTES + 7);
  assert.equal(middle.length, NATIVE_CHUNK_BYTES + 7);
  assert.equal(middle[0], 73);
  assert.equal(middle.at(-1), (73 + NATIVE_CHUNK_BYTES + 6) % 251);
  assert.deepEqual(await range.read(length - 5, 5), tail);
  assert.deepEqual(reads, [
    [length - 5, 5],
    [73, NATIVE_CHUNK_BYTES],
    [73 + NATIVE_CHUNK_BYTES, 7],
    [length - 5, 5],
  ]);
  assert.equal((await range.read(length, 0)).length, 0);
  for (const [offset, size] of [
    [-1, 1],
    [0, -1],
    [length, 1],
    [length + 1, 0],
    [0.5, 1],
    [0, Infinity],
  ])
    await assert.rejects(range.read(offset ?? 0, size ?? 0), /outside/);
  assert.equal(reads.length, 4, 'invalid or empty ranges issue no IPC');
  await assert.rejects(
    nativeRange(20, () => Promise.resolve([1])).read(5, 2),
    /Incomplete/,
  );
  await assert.rejects(
    nativeRange(20, () => Promise.reject(new Error('read failed'))).read(5, 2),
    /read failed/,
  );
});
