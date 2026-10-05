import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeFileSource, readNativeFile } from '../../src/app/files';
import type { NativeInvoke } from '../../src/platform/storage';

void test('native import opens a snapshot descriptor and reads PDF bytes only on request', async () => {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const call: NativeInvoke = <T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    calls.push({ command, ...(args ? { args } : {}) });
    const result: unknown =
      command === 'file_snapshot_open'
        ? { token: 'snapshot', name: 'large.pdf', length: 349354454 }
        : [3, 4, 5];
    return Promise.resolve(result as T);
  };
  const file = await readNativeFile('/plans/large.pdf', call);
  assert.equal(file.data.length, 0);
  assert.deepEqual(file.nativeSource, { token: 'snapshot', length: 349354454 });
  assert.deepEqual(calls, [
    { command: 'file_snapshot_open', args: { path: '/plans/large.pdf' } },
  ]);
  assert.ok(file.nativeSource);
  const range = nativeFileSource(file.nativeSource, call);
  assert.deepEqual(await range.read(123, 3), new Uint8Array([3, 4, 5]));
  assert.deepEqual(calls[1], {
    command: 'file_snapshot_read',
    args: { token: 'snapshot', offset: 123, length: 3 },
  });
});
