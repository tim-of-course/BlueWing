import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NATIVE_CHUNK_BYTES,
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
