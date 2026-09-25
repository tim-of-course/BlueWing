import { test } from '@playwright/test';
import { assemblyWorkflow } from './assemblies';

test('built assemblies persist copies and overrides and export piece schedules', async ({
  page,
}, info) => {
  await assemblyWorkflow(page);
  await page.screenshot({
    path: info.outputPath('assembly-quantities.png'),
    fullPage: true,
  });
});
