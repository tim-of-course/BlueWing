import { defineConfig } from '@playwright/test';
import development from './playwright.config';

const port = process.env['BLUEWING_TEST_PRODUCTION_PORT'] ?? '4174';
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...development,
  testMatch: '**/*.production.spec.ts',
  outputDir: 'test-results/production',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/production', open: 'never' }],
  ],
  use: { ...development.use, baseURL: url },
  webServer: {
    command: `bun run preview --port ${port} --strictPort`,
    url,
    reuseExistingServer: false,
  },
});
