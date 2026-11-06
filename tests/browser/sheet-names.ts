import { expect, type Page } from '@playwright/test';

export async function sheetNamesWorkflow(page: Page) {
  const original = await page.locator('.sheet-row').allTextContents();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
  await (await choosing).setFiles('tests/fixtures/sheet-name-plan.pdf');
  await expect(page.locator('.sheet-row')).toHaveCount(3);
  await page
    .getByRole('button', { name: 'AI Page Naming', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'AI Page Naming',
    exact: true,
  });
  await expect(
    dialog.getByText('3 of 3 title blocks prepared.', { exact: true }),
  ).toBeVisible();
  const task = dialog.getByRole('textbox', { name: 'AI page naming task' });
  await expect(task).toHaveValue(/sheet.naming.start/);
  await expect(task).toHaveValue(/Name this project/);
  await expect(
    dialog.getByRole('textbox', { name: /Suggested name/ }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Copy AI naming task' }).click();
  await expect(dialog.getByRole('status').last()).toContainText(
    /Task copied|Select and copy/,
  );
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.sheet-row').first()).toHaveText(
    original[0] ?? '',
  );
  await page
    .getByRole('button', { name: 'AI Page Naming', exact: true })
    .click();
  await expect(
    dialog.getByText('3 of 3 title blocks prepared.', { exact: true }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}
