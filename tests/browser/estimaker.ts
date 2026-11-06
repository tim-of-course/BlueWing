import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';
import { drawWall, startProject } from './takeoff';
import type { TakeoffEnvelope } from '../../src/core/quantity-presentation';

export async function readDownload(
  page: Page,
  action: () => Promise<unknown>,
): Promise<string> {
  const downloading = page.waitForEvent('download');
  await action();
  const download = await downloading;
  const path = await download.path();
  if (!path) throw new Error('Missing download');
  return readFile(path, 'utf8');
}

export async function productionQuantityWorkflow(page: Page) {
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
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  const totals = page.getByRole('table', { name: 'Material totals' });
  await expect(totals).toContainText('192 SF');
  const detail = page
    .locator('details.quantity-output')
    .filter({ has: page.locator('summary').filter({ hasText: 'Wall area' }) });
  await detail.locator('summary').click();
  await expect(detail).toContainText('Net / base');
  const text = await readDownload(page, () =>
    page
      .getByRole('button', { name: 'Export to EstiMaker', exact: true })
      .click(),
  );
  const takeoff = JSON.parse(text) as TakeoffEnvelope;
  expect(takeoff.kind).toBe('bluewing.takeoff');
  expect(takeoff.rows[0]?.quantity).toBeCloseTo(192);
  expect(takeoff.rows[0]?.unit).toBe('SF');
  expect(takeoff.coverage.complete).toBe(false);
  await detail
    .getByRole('table', { name: 'Drawing contributions' })
    .getByRole('button')
    .first()
    .click();
  await expect(
    page.getByLabel('Drawing canvas', { exact: true }),
  ).toBeVisible();
}
