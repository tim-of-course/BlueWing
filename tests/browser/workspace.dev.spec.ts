import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  expectNoDiagnostics,
  expectNoSilentHolds,
  expectRerunBudget,
} from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';

test('sheet navigation responds without reactive diagnostics', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.goto('/');
  const sheets = page.locator(
    '.workspace-panel[data-side=left] > .workspace-panel-control',
  );
  const navigator = page.getByRole('complementary', { name: 'Sheets' });
  await expect(navigator).toBeVisible();

  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await sheets.click();
      await expect(sheets).toHaveAttribute('aria-expanded', 'false');
      await expect(navigator).toBeHidden();
      await sheets.press('Enter');
      await expect(sheets).toHaveAttribute('aria-expanded', 'true');
      await expect(navigator).toBeVisible();
    },
    { scenario: 'toggle-sheet-navigator' },
  );

  const artifactPath = testInfo.outputPath('solid-diagnostics.json');
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2));
  await testInfo.attach('solid-diagnostics', {
    path: artifactPath,
    contentType: 'application/json',
  });
  // Nonempty attribution proves the browser is recording the app's runtime.
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  // Two panel toggles update width, visibility, inert state, control labels and persisted preference.
  expectRerunBudget(artifact, 24);
  expect(errors).toEqual([]);
});
