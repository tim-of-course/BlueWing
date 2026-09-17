import { expect, test } from '@playwright/test';
import { startProject } from './takeoff';
import { scaleWorkflow } from './scale';

test('built sheet scales support presets, measurement, undo and reopening', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startProject(page);
  await scaleWorkflow(page);
  await page
    .getByRole('button', { name: 'Set scale (R)', exact: true })
    .click();
  await page.screenshot({ path: testInfo.outputPath('custom-ratio.png') });
  await page.getByRole('button', { name: 'Preset', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('printed-scale.png') });
  expect(errors).toEqual([]);
});
