import { expect, test } from '@playwright/test';
import { navigatorWorkflow } from './navigation';
test('built navigator supports preview, resizing, groups and saved order', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Editing Inspector fields must leave the Sheets tree and its splitter visible.
  await page.setViewportSize({ width: 1760, height: 720 });
  await navigatorWorkflow(page);
  expect(errors).toEqual([]);
});
