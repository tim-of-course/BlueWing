/* global URL, Response */
import { file, serve } from 'bun';
import { resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from 'node:console';
import process from 'node:process';

const sample = dirname(fileURLToPath(import.meta.url));
const project = resolve(sample, '../..');
const roots = [
  ['/vendor/pdfjs/', resolve(project, 'node_modules/pdfjs-dist')],
  ['/vendor/hayro/', resolve(project, 'tmp/pdf-renderer-sample-vendor/hayro')],
  [
    '/vendor/pdfium/',
    resolve(project, 'tmp/pdf-renderer-sample-vendor/pdfium/3.0.0'),
  ],
  ['/', sample],
];
const server = serve({
  hostname: '127.0.0.1',
  port: Number(process.env['PDF_SAMPLE_PORT'] || 4188),
  async fetch(request) {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    const [prefix, root] = roots.find(([prefix]) =>
      pathname.startsWith(prefix),
    );
    const path = resolve(root, pathname.slice(prefix.length) || 'index.html');
    if (!path.startsWith(root + sep))
      return new Response('Not found', { status: 404 });
    const asset = file(path);
    if (!(await asset.exists()))
      return new Response('Not found', { status: 404 });
    return new Response(asset, { headers: { 'Cache-Control': 'no-store' } });
  },
});
log(`PDF renderer sample: ${server.url}`);
