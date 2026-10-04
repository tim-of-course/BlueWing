import { test } from '@playwright/test';
import {
  assemblyWorkflow,
  ceilingWorkflow,
  ceilingLayoutWorkflow,
} from './assemblies';
import { materialLayoutWorkflow } from './material-layouts';

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

test('built ceiling layouts share measured quantities and 3D members', async ({
  page,
}) => {
  await ceilingLayoutWorkflow(page);
});

test('built material starters preserve modeled surfaces and reusable header details', async ({
  page,
}) => {
  await materialLayoutWorkflow(page);
});
