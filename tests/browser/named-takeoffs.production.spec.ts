import { expect, test } from '@playwright/test';
import { startProject, drawWall } from './takeoff';
import { readDownload } from './estimaker';
import type { TakeoffEnvelope } from '../../src/core/quantity-presentation';

test('built named takeoffs isolate quantities, signed export and reopening', async ({
  page,
}) => {
  await startProject(page);
  await drawWall(page);
  await page.getByLabel('New group name', { exact: true }).fill('Walls');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Assembly to assign', exact: true })
    .selectOption('wall-area');
  await page
    .getByRole('button', { name: 'Assign assembly', exact: true })
    .click();
  await page.getByRole('button', { name: 'Takeoffs', exact: true }).click();
  await page.getByLabel('Takeoff name', { exact: true }).fill('CO 1');
  await page.getByLabel('New takeoff kind').selectOption('change-order');
  await page
    .getByRole('button', { name: 'Create takeoff', exact: true })
    .click();
  await expect(page.getByLabel('Active takeoff')).not.toHaveValue('main');
  const id = await page.getByLabel('Active takeoff').inputValue();
  await page.getByLabel('Copy direction').selectOption('deduct');
  await page
    .getByRole('region', { name: 'Manage takeoffs' })
    .getByRole('checkbox')
    .first()
    .check();
  await page
    .getByRole('button', { name: 'Copy selected items', exact: true })
    .click();
  await page.getByRole('button', { name: 'Takeoffs', exact: true }).click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals', exact: true }),
  ).toContainText('-192 SF');
  const exported = JSON.parse(
    await readDownload(page, () =>
      page
        .getByRole('button', { name: 'Export to EstiMaker', exact: true })
        .click(),
    ),
  ) as TakeoffEnvelope;
  expect(exported.takeoff).toEqual({ id, name: 'CO 1', kind: 'change-order' });
  expect(exported.rows[0]).toMatchObject({
    quantity: -192,
    grossQuantity: 192,
    direction: 'deduct',
    unit: 'SF',
  });
  await page.getByLabel('Active takeoff').selectOption('main');
  await expect(
    page.getByRole('table', { name: 'Material totals', exact: true }),
  ).toContainText('192 SF');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByLabel('Active takeoff').selectOption(id);
  await expect(
    page.getByRole('table', { name: 'Material totals', exact: true }),
  ).toContainText('-192 SF');
});
