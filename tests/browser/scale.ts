import { expect, type Page } from '@playwright/test';
import { pagePoint } from './takeoff';

export async function scaleWorkflow(page: Page) {
  const open = async () =>
    page.getByRole('button', { name: 'Set scale (R)', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Set sheet scale' });
  const status = page.locator('footer');
  await open();
  await expect(
    dialog.getByRole('button', { name: 'Preset', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByLabel('Printed scale')).toHaveValue('1/4″ = 1′-0″');
  await dialog.press('Escape');
  await expect(status).toContainText('Sheet uncalibrated');
  await open();
  await dialog.getByRole('button', { name: 'Apply scale' }).click();
  await expect(dialog).toBeHidden();
  await expect(status).toContainText('Scale: 1/4″ = 1′-0″');
  await page.getByLabel('Drawing canvas', { exact: true }).press('Control+1');
  await page.getByRole('button', { name: 'Path (L)', exact: true }).click();
  await pagePoint(page, 72, 144);
  await pagePoint(page, 360, 144);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByRole('button', { name: 'Select (V)', exact: true }).click();
  await expect(page.getByText('16 ft', { exact: true })).toBeVisible();
  await open();
  await dialog.getByLabel('Printed scale').selectOption('1/8″ = 1′-0″');
  await dialog.getByRole('button', { name: 'Apply scale' }).click();
  await expect(page.getByText('32 ft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('16 ft', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await open();
  await expect(dialog.getByLabel('Printed scale')).toHaveValue('1/8″ = 1′-0″');
  await dialog
    .getByRole('button', { name: 'Custom ratio', exact: true })
    .click();
  await dialog.getByLabel('Paper distance', { exact: true }).fill('0');
  await expect(
    dialog.getByRole('button', { name: 'Apply scale' }),
  ).toBeDisabled();
  await dialog.getByRole('button', { name: 'Two points', exact: true }).click();
  await dialog
    .getByRole('button', { name: 'Measure on plan', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await pagePoint(page, 72, 144);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(status).toContainText('Scale: 1/8″ = 1′-0″');
  await pagePoint(page, 72, 144);
  await pagePoint(page, 360, 144);
  await page.getByLabel('Known length', { exact: true }).fill('24');
  await page.getByRole('button', { name: 'Set scale', exact: true }).click();
  await expect(page.getByLabel('Known length', { exact: true })).toBeHidden();
  await open();
  await expect(
    dialog.getByRole('button', { name: 'Custom ratio', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByLabel('Real distance', { exact: true })).toHaveValue(
    '6',
  );
  await dialog.press('Escape');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(status).toContainText('Scale: 1″ = 6′');
}
