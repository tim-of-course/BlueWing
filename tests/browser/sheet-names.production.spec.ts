import { expect, test } from '@playwright/test';
import { startProject } from './takeoff';
import { sheetNamesWorkflow } from './sheet-names';

test('built local sheet naming applies and persists chosen names', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startProject(page);
  await sheetNamesWorkflow(page);
  expect(errors).toEqual([]);
});
