import solid from '@solidjs/vite-plugin';
import { defineConfig, minifySync } from 'vite';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// PDF fonts, CMaps, and codecs ship in each complete offline web release.
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  mkdirSync('public/pdfjs', { recursive: true });
  cpSync(`node_modules/pdfjs-dist/${directory}`, `public/pdfjs/${directory}`, {
    recursive: true,
  });
}

// The readable worker carries our range-cancellation patch (pdf.js#22051).
// Minify it with Vite's existing toolchain, retaining licenses and avoiding HMR.
const worker = minifySync(
  'pdf.worker.mjs',
  readFileSync('node_modules/pdfjs-dist/build/pdf.worker.mjs', 'utf8').replace(
    '@licstart',
    '@license @licstart',
  ),
  { module: true, codegen: { legalComments: 'inline' } },
);
if (worker.errors.length) {
  throw new Error(
    `PDF worker minification failed: ${JSON.stringify(worker.errors)}`,
  );
}
writeFileSync('public/pdfjs/pdf.worker.min.mjs', worker.code);

export default defineConfig({
  plugins: [solid({ diagnostics: true })],
  resolve: { dedupe: ['solid-js', '@solidjs/signals', '@solidjs/web'] },
});
