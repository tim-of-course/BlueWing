import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  expectNoDiagnostics,
  expectNoSilentHolds,
  expectRerunBudget,
} from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { startProject } from './takeoff';
import { scaleWorkflow } from './scale';

test('printed scale comes first and two-point calibration remains available', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startProject(page);
  const { artifact } = await captureBrowserArtifact(
    page,
    () => scaleWorkflow(page),
    { scenario: 'sheet-scale-methods' },
  );
  await writeFile(
    testInfo.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  // Scale changes refresh selected measurements, the navigator and saved state.
  expectRerunBudget(artifact, 260);
  expect(errors).toEqual([]);
});
