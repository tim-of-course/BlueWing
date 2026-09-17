import { expect, test } from '@playwright/test';
import { navigatorWorkflow } from './navigation';
test('built navigator supports preview, resizing, groups and saved order', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await navigatorWorkflow(page);
  expect(errors).toEqual([]);
});
