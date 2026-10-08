import { defineConfig, devices } from '@playwright/test';

const port = process.env['BLUEWING_TEST_DEV_PORT'] ?? '4173';
const url = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.dev.spec.ts',
  outputDir: 'test-results/dev',
  fullyParallel: false,
  workers: 1,
  globalSetup: './tests/browser/global-setup.ts',
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/dev', open: 'never' }],
  ],
  use: { baseURL: url, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    // Windows WebKit lacks the worker OffscreenCanvas required for PDF drawing.
    ...(process.platform === 'win32'
      ? []
      : [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }]),
  ],
  webServer: {
    command: `bun run dev --port ${port} --strictPort`,
    url,
    reuseExistingServer: false,
  },
});
