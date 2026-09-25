import { test } from '@playwright/test';
import { assemblyWorkflow, ceilingWorkflow } from './assemblies';

test('built assemblies persist copies and overrides and export piece schedules', async ({
  page,
}, info) => {
  await assemblyWorkflow(page);
  await page.screenshot({
    path: info.outputPath('assembly-quantities.png'),
    fullPage: true,
  });
});

test('built ceiling assemblies export distinct grid materials and reopen', async ({
  page,
}, info) => {
  await ceilingWorkflow(page);
  await page.screenshot({
    path: info.outputPath('ceiling-quantities.png'),
    fullPage: true,
  });
});
