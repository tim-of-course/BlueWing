import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import {
  expectNoDiagnostics,
  expectNoSilentHolds,
  expectRerunBudget,
} from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { compactWorkflow } from './compact';
import { startProject } from './takeoff';

test('compact groups show measured totals and visibility leaves estimating data intact', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startProject(page);
  const { artifact: visibilityArtifact } = await captureBrowserArtifact(
    page,
    () => compactWorkflow(page),
    { scenario: 'compact-visibility-and-totals' },
  );
  await writeFile(
    testInfo.outputPath('visibility-diagnostics.json'),
    JSON.stringify(visibilityArtifact, null, 2),
  );
  expectNoDiagnostics(visibilityArtifact);
  expectNoSilentHolds(visibilityArtifact);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Missing canvas');
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await page.mouse.move(bounds.x + 150, bounds.y + 200);
      await page.mouse.move(bounds.x + 175, bounds.y + 225);
      await expect(page.locator('.crosshair-horizontal')).toBeVisible();
    },
    { scenario: 'full-canvas-crosshair' },
  );
  await writeFile(
    testInfo.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  // Pointer movement updates only the crosshair overlay in selection mode.
  expectRerunBudget(artifact, 24);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('compact-workspace.png') });
});
