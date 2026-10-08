import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'vite';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';

// PDF fonts, CMaps, and codecs ship in each complete offline web release.
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  mkdirSync('public/pdfjs', { recursive: true });
  cpSync(`node_modules/pdfjs-dist/${directory}`, `public/pdfjs/${directory}`, {
    recursive: true,
  });
}

cpSync(
  'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  'public/pdfjs/pdf.worker.min.mjs',
);
// The parser and renderer communicate directly, without forwarding operator
// lists or font/image data through the UI thread. Both workers are host-owned.
writeFileSync(
  'public/pdfjs/parser-bridge.mjs',
  `
import { WorkerMessageHandler } from './pdf.worker.min.mjs';
self.addEventListener('message', ({data}) => {
  if (data.type !== 'connect') return;
  data.port.start();
  WorkerMessageHandler.initializeFromPort(data.port);
  self.postMessage({type:'connected'});
});
`,
);

export default defineConfig({
  plugins: [solid({ diagnostics: true })],
  worker: { format: 'es' },
  resolve: { dedupe: ['solid-js', '@solidjs/signals', '@solidjs/web'] },
});
