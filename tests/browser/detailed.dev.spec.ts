import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { detailedWorkflow, systemWorkflow } from './detailed';
test('positioned takeoff, linked 3D and highlighted review survive reopening', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('[STRICT_'))
      errors.push(message.text());
  });
  await detailedWorkflow(page);
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await page
        .getByLabel('Workspace view', { exact: true })
        .selectOption('3d');
      const viewer = page.getByRole('region', {
        name: '3D construction viewer',
      });
      await expect(viewer).toBeVisible();
      await viewer
        .getByRole('combobox', { name: 'Role', exact: true })
        .selectOption('stud');
      await expect(viewer).toContainText('19 objects shown');
    },
    { scenario: 'construction-view' },
  );
  await writeFile(
    info.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});

test('component system editing updates both materials without reactive warnings', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('[STRICT_'))
      errors.push(message.text());
  });
  await systemWorkflow(page);
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await page.getByLabel('height (ft)', { exact: true }).fill('11');
      await page
        .getByRole('button', { name: 'Save assignment', exact: true })
        .click();
      await expect(
        page.getByRole('table', { name: 'Material totals' }),
      ).toContainText('264 ft2');
      await expect(
        page.getByRole('table', { name: 'Piece schedule' }),
      ).toContainText('11′ 0″');
    },
    { scenario: 'shared-system-dimensions' },
  );
  await writeFile(
    info.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});
