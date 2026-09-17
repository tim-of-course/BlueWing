import { expect, type Page } from '@playwright/test';
import { drawWall, pagePoint } from './takeoff';

export async function compactWorkflow(page: Page) {
  await drawWall(page);
  await page.getByLabel('New group name', { exact: true }).fill('Walls');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const group = page.getByRole('button', {
    name: 'Walls, 1 drawing objects',
    exact: true,
  });
  await expect(group).toContainText('24 ft');
  expect((await group.boundingBox())?.height).toBe(22);
  expect((await page.locator('.sheet-row').boundingBox())?.height).toBe(24);
  await page.getByLabel('Highlight color').fill('#f97316');
  await page.getByRole('button', { name: 'Save group', exact: true }).click();
  await expect(group.locator('.group-color')).toHaveCSS(
    'background-color',
    'rgb(249, 115, 22)',
  );
  await page.getByLabel('Recipe to assign').selectOption('wall-area');
  await page
    .getByRole('button', { name: 'Assign recipe', exact: true })
    .click();
  await page.getByRole('button', { name: 'Select (V)', exact: true }).click();
  await page.getByRole('button', { name: /^Hide Walls on/ }).click();
  await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
  await pagePoint(page, 216, 144);
  await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
  await expect(group).toContainText('24 ft');
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('192 ft2');
  await page.getByRole('button', { name: 'Path 1', exact: true }).click();
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Hide Walls on/ }).click();
  await page.getByRole('button', { name: 'Drawing', exact: true }).click();
  await page.getByLabel('Filter sheets and groups').fill('wall');
  await expect(group).toBeVisible();
  await page
    .getByRole('button', { name: 'Clear sheet and group filter' })
    .click();
  await expect(page.getByLabel('Filter sheets and groups')).toHaveValue('');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /^Show Walls on/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: /^Show Walls on/ }).click();
  await pagePoint(page, 216, 144);
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Hide drawing objects on/ }).click();
  await pagePoint(page, 216, 144);
  await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Show drawing objects on/ }).click();
  await page
    .getByRole('button', { name: 'Set scale (R)', exact: true })
    .click();
  await page.getByRole('button', { name: 'Preset', exact: true }).click();
  await page.getByLabel('Printed scale').selectOption('1/8″ = 1′-0″');
  await page.getByRole('button', { name: 'Apply scale', exact: true }).click();
  await expect(group).toContainText('32 ft');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(group).toContainText('24 ft');

  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Missing drawing canvas');
  await page.mouse.move(
    bounds.x + bounds.width * 0.6,
    bounds.y + bounds.height * 0.6,
  );
  const horizontal = page.locator('.crosshair-horizontal');
  const vertical = page.locator('.crosshair-vertical');
  await expect(horizontal).toBeVisible();
  await expect(vertical).toBeVisible();
  const horizontalBounds = await horizontal.boundingBox();
  const verticalBounds = await vertical.boundingBox();
  expect(horizontalBounds?.width).toBeCloseTo(bounds.width, 0);
  expect(verticalBounds?.height).toBeCloseTo(bounds.height, 0);
  expect(
    Math.abs((horizontalBounds?.y ?? 0) - (bounds.y + bounds.height * 0.6)),
  ).toBeLessThan(1);
  expect(
    Math.abs((verticalBounds?.x ?? 0) - (bounds.x + bounds.width * 0.6)),
  ).toBeLessThan(1);
  await canvas.focus();
  await page.keyboard.down('Space');
  await expect(horizontal).toBeHidden();
  await page.keyboard.up('Space');
  await expect(horizontal).toBeVisible();
  await page.mouse.move(100, 25);
  await expect(horizontal).toBeHidden();
}
