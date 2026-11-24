import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

void test('web packaging validates before building and can retry after a failed copy', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'bluewing-web-release-'));
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
  });
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ scripts: { build: 'bun build-fixture.ts' } }),
  );
  writeFileSync(
    join(cwd, 'build-fixture.ts'),
    "await Bun.write('built', 'yes');",
  );
  const script = resolve('scripts/web-release.ts');
  const run = (version: string) =>
    spawnSync(process.execPath, [script, version], {
      cwd,
      encoding: 'utf8',
    });
  const output = join(cwd, 'output', 'web');
  const destination = join(output, 'v2');

  mkdirSync(join(output, 'existing'), { recursive: true });
  for (const version of [
    '0.1.0',
    '0.1.0.',
    'active',
    'AcTiVe',
    'active.',
    'existing',
  ]) {
    const result = run(version);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /reserved|already exists/);
    assert.equal(existsSync(join(cwd, 'built')), false);
  }

  const failed = run('v2');
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(existsSync(join(cwd, 'built')), true);
  assert.deepEqual(readdirSync(output), ['existing']);

  mkdirSync(join(cwd, 'dist'));
  const html = '<html>release</html>';
  writeFileSync(join(cwd, 'dist', 'index.html'), html);
  const retried = run('v2');
  assert.equal(retried.status, 0, retried.stderr);
  assert.deepEqual(readdirSync(output).sort(), ['existing', 'v2']);
  const manifest: unknown = JSON.parse(
    readFileSync(join(destination, 'manifest.json'), 'utf8'),
  );
  assert.deepEqual(manifest, {
    version: 'v2',
    bridgeVersion: 9,
    projectFormats: [10],
    files: [
      {
        path: 'index.html',
        sha256: createHash('sha256').update(html).digest('hex'),
        size: Buffer.byteLength(html),
      },
      {
        path: 'release.json',
        sha256: createHash('sha256')
          .update(readFileSync(join(destination, 'release.json')))
          .digest('hex'),
        size: readFileSync(join(destination, 'release.json')).length,
      },
    ],
  });
});
