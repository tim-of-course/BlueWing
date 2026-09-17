import { expect, test } from '@playwright/test';
import { navigatorWorkflow } from './navigation';
test('sheet navigation preserves previews, groups, layout and saved order', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error')
      errors.push(message.text());
  });
  await navigatorWorkflow(page);
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page
    .getByRole('button', { name: 'Walls, 1 drawing objects', exact: true })
    .click();
  await page.locator('.sheet-row').last().hover();
  await expect(
    page.getByRole('tooltip', { name: 'Sheet preview' }).getByRole('img'),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('navigator.png') });
});
