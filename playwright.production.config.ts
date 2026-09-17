import { defineConfig } from '@playwright/test';
import development from './playwright.config';

export default defineConfig({
  ...development,
  testMatch: '**/*.production.spec.ts',
  outputDir: 'test-results/production',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/production', open: 'never' }],
  ],
  use: { ...development.use, baseURL: 'http://127.0.0.1:4174' },
  webServer: {
    command: 'bun run preview --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
