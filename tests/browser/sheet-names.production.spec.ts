import { expect, test } from '@playwright/test';
import { startProject } from './takeoff';
import { sheetNamesWorkflow } from './sheet-names';

test('built AI Page Naming prepares title blocks and gives an agent task', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startProject(page);
  await sheetNamesWorkflow(page);
  expect(errors).toEqual([]);
});
