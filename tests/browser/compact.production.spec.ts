import { expect, test } from '@playwright/test';
import { compactWorkflow } from './compact';
import { startProject } from './takeoff';

test('built workspace has compact quantities, visibility and full crosshairs', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startProject(page);
  await compactWorkflow(page);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('compact-workspace.png') });
});
