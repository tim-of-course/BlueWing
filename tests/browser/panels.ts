import { expect, type Page } from '@playwright/test';

/** Open the actual panel control when responsive fitting has folded it to a strip. */
export async function openPanel(
  page: Page,
  name: 'Sheets' | 'Inspector' | 'Wingman',
  mode: 'pin' | 'peek' = 'pin',
): Promise<void> {
  await expect(
    page.getByLabel('Active takeoff', { exact: true }),
  ).toBeVisible();
  const pin = page.getByRole('button', { name: new RegExp(`^Pin ${name}\\b`) });
  if (await pin.isVisible()) {
    if (mode === 'peek') await pin.hover();
    else await pin.click();
  }
}
