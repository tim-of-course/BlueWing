import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';

// PDF fonts, CMaps, and codecs ship in each complete offline web release.
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
  mkdirSync('public/pdfjs', { recursive: true });
  cpSync(`node_modules/pdfjs-dist/${directory}`, `public/pdfjs/${directory}`, {
    recursive: true,
  });
}

export default defineConfig({
  plugins: [solid({ diagnostics: true })],
  resolve: { dedupe: ['solid-js', '@solidjs/signals', '@solidjs/web'] },
});
