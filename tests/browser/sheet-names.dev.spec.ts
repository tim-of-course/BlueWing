import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { startProject } from './takeoff';
import { sheetNamesWorkflow } from './sheet-names';

test('local sheet-name suggestions support review, edit, undo and reopening', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startProject(page);
  const { artifact } = await captureBrowserArtifact(
    page,
    () => sheetNamesWorkflow(page),
    { scenario: 'local-sheet-names' },
  );
  await writeFile(
    testInfo.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});
