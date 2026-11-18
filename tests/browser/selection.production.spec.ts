import { expect, test } from '@playwright/test';
import { startProject } from './takeoff';
import { selectionWorkflow } from './selection';

test('built paint selection and compact toolbar work', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Exercise the Sheets and Inspector controls together with the default pinned chat.
  await page.setViewportSize({ width: 1760, height: 720 });
  await startProject(page);
  await selectionWorkflow(page);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('canvas-reticle.png') });
});
