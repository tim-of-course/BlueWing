import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { startProject } from './takeoff';
import { selectionWorkflow } from './selection';

test('paint selection, subtraction, reticle and collapsed toolbar stay usable', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startProject(page);
  const { artifact } = await captureBrowserArtifact(
    page,
    () => selectionWorkflow(page),
    { scenario: 'paint-selection-and-toolbar' },
  );
  await writeFile(
    testInfo.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('canvas-reticle.png') });
});
