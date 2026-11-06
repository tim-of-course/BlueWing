import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { handoffWorkflow, openHandoff, storedProject } from './handoff';
import { startProject, drawWall } from './takeoff';

test('standalone handoff viewer works without a project and isolates its content', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const { artifact } = await captureBrowserArtifact(
    page,
    () => handoffWorkflow(page),
    { scenario: 'handoff-viewer' },
  );
  await writeFile(
    testInfo.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  await expect(
    page.getByRole('heading', { name: 'No project open' }),
  ).toBeVisible();
});

test('viewing a handoff leaves accepted project data unchanged', async ({
  page,
}) => {
  await startProject(page);
  await drawWall(page);
  const before = await storedProject(page);
  await openHandoff(page, '<h1>Read only handoff</h1>');
  await page.getByRole('button', { name: 'Close handoff document' }).click();
  expect(await storedProject(page)).toEqual(before);
  await expect(
    page.getByLabel('Drawing canvas', { exact: true }),
  ).toBeVisible();
});
