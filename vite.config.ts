import solid from '@solidjs/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [solid({ diagnostics: true })],
  resolve: { dedupe: ['solid-js', '@solidjs/signals', '@solidjs/web'] },
});
