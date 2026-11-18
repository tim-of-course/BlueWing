import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import {
  assemblyWorkflow,
  ceilingWorkflow,
  ceilingLayoutWorkflow,
} from './assemblies';
import { startProject } from './takeoff';
import { materialLayoutWorkflow } from './material-layouts';

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
      name: 'Steel studs straight run estimate',
      exact: true,
    }),
  });
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await steel.getByLabel('height', { exact: true }).fill('11');
      await steel
        .getByRole('button', { name: 'Save assignment', exact: true })
        .click();
      await expect(
        page.getByRole('table', { name: 'Piece schedule', exact: true }),
      ).toContainText('10\' 11 1/2"');
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
      await page.getByLabel('gridDeduction (ft²)', { exact: true }).fill('40');
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

test('modeled material starters edit surfaces and copy opening header details', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('[STRICT_'))
      errors.push(message.text());
  });
  await materialLayoutWorkflow(page);
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await page
        .getByLabel('Surface height (optional)', { exact: true })
        .fill('10');
      await page
        .getByRole('button', { name: 'Save assignment', exact: true })
        .click();
      await expect(
        page
          .getByRole('table', { name: 'Material totals' })
          .getByRole('row')
          .filter({ hasText: 'frp-unspecified' }),
      ).toContainText('256 ft²');
    },
    { scenario: 'modeled-material-local-height' },
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

test('company sizes copy into new jobs and project purchasing settings persist independently', async ({
  page,
}) => {
  await startProject(page);
  const openEditor = page.getByRole('button', {
    name: 'Assemblies',
    exact: true,
  });
  const editor = page.getByRole('dialog', {
    name: 'Assembly editor',
    exact: true,
  });
  const sizes = editor.getByRole('button', {
    name: 'Standard sizes',
    exact: true,
  });
  const company = page.getByRole('dialog', {
    name: 'Company standard sizes',
    exact: true,
  });
  const job = page.getByRole('dialog', {
    name: 'Project standard sizes',
    exact: true,
  });
  const minimum = 'Special-order stud minimum';
  await openEditor.click();
  await editor
    .getByRole('button', { name: 'Global library', exact: true })
    .click();
  await sizes.click();
  await expect(company.getByLabel(minimum)).toHaveValue('100');
  await company.getByLabel(minimum).fill('135');
  await company.getByRole('button', { name: 'Save sizes' }).click();
  await expect(company).toBeHidden();
  await editor
    .getByRole('button', { name: 'Project assemblies', exact: true })
    .click();
  await sizes.click();
  await expect(job.getByLabel(minimum)).toHaveValue('100');
  await job.getByLabel(minimum).fill('88');
  await job.getByRole('button', { name: 'Save sizes' }).click();
  await expect(job).toBeHidden();
  const special = editor.getByLabel('Allow special-order studs for this job');
  await expect(special).toBeChecked();
  await special.click();
  await expect(special).not.toBeChecked();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await openEditor.click();
  await expect(special).not.toBeChecked();
  await sizes.click();
  await expect(job.getByLabel(minimum)).toHaveValue('88');
  await job.getByRole('button', { name: 'Cancel' }).click();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page.getByLabel('Project name', { exact: true }).fill('Next job');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await openEditor.click();
  await expect(special).toBeChecked();
  await sizes.click();
  await expect(job.getByLabel(minimum)).toHaveValue('135');
});
