/* global fetch */
import { file, write } from 'bun';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { log } from 'node:console';

const version = '3.0.0';
const directory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  `../../tmp/pdf-renderer-sample-vendor/pdfium/${version}`,
);
await mkdir(directory, { recursive: true });
const assets = [];
for (const name of [
  'dist/index.esm.browser.js',
  'dist/pdfium.wasm',
  'LICENSE.md',
  'package.json',
]) {
  const url = `https://cdn.jsdelivr.net/npm/@hyzyla/pdfium@${version}/${name}`;
  const target = resolve(directory, name);
  await mkdir(dirname(target), { recursive: true });
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
  JSON.stringify({ package: '@hyzyla/pdfium', version, assets }, null, 2),
);
