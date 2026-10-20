/* global fetch */
import { file, write } from 'bun';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { log } from 'node:console';

const directory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../tmp/pdf-renderer-sample-vendor/hayro',
);
await mkdir(directory, { recursive: true });
const urls = [
  ['hayro_demo_simd.js', 'https://laurenzv.github.io/hayro/hayro_demo_simd.js'],
  [
    'hayro_demo_simd_bg.wasm',
    'https://laurenzv.github.io/hayro/hayro_demo_simd_bg.wasm',
  ],
  [
    'LICENSE-MIT',
    'https://raw.githubusercontent.com/LaurenzV/hayro/main/LICENSE-MIT',
  ],
  [
    'LICENSE-APACHE',
    'https://raw.githubusercontent.com/LaurenzV/hayro/main/LICENSE-APACHE',
  ],
  [
    'NOTICE.md',
    'https://raw.githubusercontent.com/LaurenzV/hayro/main/NOTICE.md',
  ],
];
const assets = [];
for (const [name, url] of urls) {
  const target = resolve(directory, name);
  if (!(await file(target).exists())) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    await write(target, response);
  }
  const bytes = await file(target).arrayBuffer();
  assets.push({
    name,
    url,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(new Uint8Array(bytes)).digest('hex'),
  });
  log(`${name}: ${bytes.byteLength} bytes`);
}
await write(
  resolve(directory, 'source.json'),
  JSON.stringify({ downloaded: new Date().toISOString(), assets }, null, 2),
);
