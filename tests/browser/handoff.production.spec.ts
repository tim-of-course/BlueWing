import { expect, test } from '@playwright/test';
import { handoffWorkflow } from './handoff';

test('built app views standalone handoff HTML offline with isolated scripts', async ({
  page,
}) => {
  await page.goto('/');
  await page.context().setOffline(true);
  await handoffWorkflow(page);
  await expect(
    page.getByRole('heading', { name: 'No project open' }),
  ).toBeVisible();
});
