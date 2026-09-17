import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  expectNoDiagnostics,
  expectNoSilentHolds,
  expectRerunBudget,
} from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { calculateAndReopen, drawWall, startProject } from './takeoff';

test('calibrated drawing stays responsive and saves traceable quantities', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('[STRICT_'))
      errors.push(message.text());
  });
  await startProject(page);
  const { artifact } = await captureBrowserArtifact(
    page,
    () => drawWall(page),
    { scenario: 'calibrate-and-draw-wall' },
  );
  const path = testInfo.outputPath('solid-diagnostics.json');
  await writeFile(path, JSON.stringify(artifact, null, 2));
  await testInfo.attach('solid-diagnostics', {
    path,
    contentType: 'application/json',
  });
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  // Two gestures update the canvas, draft controls, inspector, and saved state.
  expectRerunBudget(artifact, 260);
  await calculateAndReopen(page);
  expect(errors).toEqual([]);
});
