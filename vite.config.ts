import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'vite';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

// Runtime and PDFium notices travel with complete offline web releases.
mkdirSync('public/pdfium-notices', { recursive: true });
cpSync(
  'node_modules/@embedpdf/engine-runtime/LICENSE',
  'public/pdfium-notices/LICENSE.embedpdf',
);
cpSync('assets/pdfium', 'public/pdfium-notices', { recursive: true });

export default defineConfig(({ command }) => {
  // PDF.js remains an independent development reference and sample renderer.
  // Its fonts/codecs/parser are excluded from the deployable application.
  if (command === 'serve') {
    mkdirSync('public/pdfjs', { recursive: true });
    for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
      cpSync(
        `node_modules/pdfjs-dist/${directory}`,
        `public/pdfjs/${directory}`,
        { recursive: true },
      );
    }
    cpSync(
      'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
      'public/pdfjs/pdf.worker.min.mjs',
    );
  } else {
    rmSync('public/pdfjs', { recursive: true, force: true });
  }
  return {
    plugins: [solid({ diagnostics: true })],
    // Keep generated codec SDKs and native build files out of development scanning.
    optimizeDeps: { entries: ['index.html', 'tests/browser/*.html'] },
    server: { watch: { ignored: ['**/tmp/**', '**/src-tauri/target/**'] } },
    worker: { format: 'es' },
    resolve: { dedupe: ['solid-js', '@solidjs/signals', '@solidjs/web'] },
  };
});
