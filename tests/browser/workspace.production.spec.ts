import { expect, test } from '@playwright/test';

test('built workspace responds and omits the diagnostics bridge', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'No project open' }),
  ).toBeVisible();
  const sheets = page.getByRole('button', { name: 'Sheets', exact: true });
  await sheets.click();
  await expect(
    page.getByRole('complementary', { name: 'Sheets' }),
  ).toBeHidden();
  await sheets.press('Enter');
  await expect(
    page.getByRole('complementary', { name: 'Sheets' }),
  ).toBeVisible();
  expect(await page.evaluate(() => '__SOLID_DIAGNOSTICS__' in globalThis)).toBe(
    false,
  );
  expect(errors).toEqual([]);
});
