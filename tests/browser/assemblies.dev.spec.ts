import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import {
  assemblyWorkflow,
  ceilingWorkflow,
  ceilingLayoutWorkflow,
} from './assemblies';

test('assemblies support project copies, object overrides and piece schedules', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('[STRICT_'))
      errors.push(message.text());
  });
  await assemblyWorkflow(page);
  // Capture a live assignment edit after the reopen portion of the workflow.
  const steel = page.locator('section.panel-section').filter({
    has: page.getByRole('heading', {
      name: 'Steel studs — straight run',
      exact: true,
    }),
  });
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await steel.getByLabel('height (ft)', { exact: true }).fill('11');
      await steel
        .getByRole('button', { name: 'Save assignment', exact: true })
        .click();
      await expect(
        page.getByRole('table', { name: 'Piece schedule', exact: true }),
      ).toContainText('10′ 11.5″');
    },
    { scenario: 'assembly-object-and-piece-update' },
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

test('ceiling estimates restore missing starters and calculate separate grid materials', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('[STRICT_'))
      errors.push(message.text());
  });
  await ceilingWorkflow(page);
  await page
    .getByRole('button', { name: 'Ceilings, 1 drawing objects', exact: true })
    .click();
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await page.getByLabel('gridDeduction (ft2)', { exact: true }).fill('40');
      await page
        .getByRole('button', { name: 'Save assignment', exact: true })
        .click();
      await expect(
        page
          .getByRole('table', { name: 'Material totals' })
          .getByRole('row')
          .filter({ hasText: 'ceiling-tee-4ft-unspecified' }),
      ).toContainText('40 ea');
    },
    { scenario: 'ceiling-grid-estimate' },
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

test('modeled ceiling quantities match the positioned grid and survive reopening', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ceilingLayoutWorkflow(page);
  expect(errors).toEqual([]);
});
