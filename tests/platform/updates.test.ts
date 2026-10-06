import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { stageWebUpdate } from '../../src/platform/updates';
import type { NativeInvoke } from '../../src/platform/storage';

void test('update verifies every file before staging and never activates', async () => {
  const calls: string[] = [];
  const urls: string[] = [];
  let corrupt = true;
  const call: NativeInvoke = <T>(command: string): Promise<T> => {
    calls.push(command);
    return Promise.resolve({ bridgeVersion: 1, cachedVersions: [] } as T);
  };
  const hash = createHash('sha256').update('content').digest('hex');
  const fetchFile: typeof fetch = (input) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    urls.push(url);
    return Promise.resolve(
      url.endsWith('manifest.json')
        ? Response.json({
            version: 'v2',
            bridgeVersion: 1,
            files: [
              { path: 'index.html', sha256: hash },
              { path: 'app.js', url: 'assets/code.js', sha256: hash },
            ],
          })
        : new Response(url.endsWith('code.js') && corrupt ? 'bad' : 'content'),
    );
  };
  await assert.rejects(
    stageWebUpdate(
      'https://example.test/releases/manifest.json',
      call,
      fetchFile,
    ),
    /SHA-256/,
  );
  assert.deepEqual(calls, ['cache_info']);
  corrupt = false;
  assert.equal(
    await stageWebUpdate(
      'https://example.test/releases/manifest.json',
      call,
      fetchFile,
    ),
    'v2',
  );
  assert.deepEqual(calls, ['cache_info', 'cache_info', 'cache_stage']);
  assert.ok(urls.includes('https://example.test/releases/assets/code.js'));
});

void test('bridge mismatch rejects before downloading bundle files', async () => {
  const call: NativeInvoke = <T>(): Promise<T> =>
    Promise.resolve({ bridgeVersion: 1, cachedVersions: [] } as T);
  let downloads = 0;
  const fetchFile: typeof fetch = () => {
    downloads++;
    return Promise.resolve(
      Response.json({
        version: 'v2',
        bridgeVersion: 2,
        files: [{ path: 'index.html', sha256: '0'.repeat(64) }],
      }),
    );
  };
  await assert.rejects(
    stageWebUpdate('https://example.test/manifest.json', call, fetchFile),
    /bridge/,
  );
  assert.equal(downloads, 1);
});

void test('installed version rejects after the manifest without fetching assets', async () => {
  const calls: string[] = [];
  const urls: string[] = [];
  const call: NativeInvoke = <T>(command: string): Promise<T> => {
    calls.push(command);
    return Promise.resolve({ bridgeVersion: 6, cachedVersions: ['v2'] } as T);
  };
  const fetchFile: typeof fetch = (input) => {
    urls.push(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    return Promise.resolve(
      Response.json({
        version: 'v2',
        bridgeVersion: 6,
        files: [{ path: 'index.html', sha256: '0'.repeat(64) }],
      }),
    );
  };
  await assert.rejects(
    stageWebUpdate('https://example.test/manifest.json', call, fetchFile),
    /Web version already exists; use a new version/,
  );
  assert.deepEqual(calls, ['cache_info']);
  assert.deepEqual(urls, ['https://example.test/manifest.json']);
});
