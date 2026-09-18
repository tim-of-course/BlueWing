import { expect, type Page } from '@playwright/test';

export async function sheetNamesWorkflow(page: Page) {
  const original = await page.locator('.sheet-row').allTextContents();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
  await (await choosing).setFiles('tests/fixtures/sheet-name-plan.pdf');
  await expect(page.locator('.sheet-row')).toHaveCount(3);
  await page
    .getByRole('button', { name: 'Auto-name sheets', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Auto-name sheets',
    exact: true,
  });
  await expect(
    dialog.getByText('No embedded text. Name unchanged.', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText('No sheet code found. Name unchanged.', { exact: true }),
  ).toBeVisible();
  const proposal = dialog.getByRole('textbox', { name: /Suggested name for/ });
  await expect(proposal).toHaveCount(1);
  await expect(proposal).toHaveValue('A 2.0 · NEW WORK FLOOR PLAN');
  await expect(page.locator('.sheet-row').first()).toHaveText(
    original[0] ?? '',
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.locator('.sheet-row').filter({ hasText: 'NEW WORK' }),
  ).toHaveCount(0);

  await page
    .getByRole('button', { name: 'Auto-name sheets', exact: true })
    .click();
  await expect(proposal).toHaveValue('A 2.0 · NEW WORK FLOOR PLAN');
  await proposal.fill('A 2.0 · New work floor plan');
  await dialog
    .getByRole('button', { name: 'Apply 1 names', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page
      .locator('.sheet-row')
      .filter({ hasText: 'A 2.0 · New work floor plan' }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.locator('.sheet-row').filter({ hasText: 'New work floor plan' }),
  ).toHaveCount(0);
  await expect(page.locator('.sheet-row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(
    page
      .locator('.sheet-row')
      .filter({ hasText: 'A 2.0 · New work floor plan' }),
  ).toHaveCount(1);
}
