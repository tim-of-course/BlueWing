import { test, expect } from '@playwright/test';
import { detailedWorkflow } from './detailed';
import { captureErrors } from './wingman';

test('built page filtering and numeric alignment persist without a CLI test bridge', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await detailedWorkflow(page);
  await page.getByRole('button', { name: 'Drawing', exact: true }).click();
  const first = page.locator('.sheet-branch').first();
  const firstId = await first.getAttribute('data-sheet-id');
  if (!firstId) throw new Error('Missing original sheet');
  await first.locator('.sheet-row').click({ button: 'right' });
  await page
    .getByRole('menuitem', { name: 'Duplicate source sheet', exact: true })
    .click();
  await expect(page.locator('.sheet-branch')).toHaveCount(2);
  await page
    .locator(`.sheet-branch[data-sheet-id="${firstId}"] .sheet-row`)
    .click();
  await page.getByLabel('Workspace view', { exact: true }).selectOption('3d');
  const viewer = page.getByRole('region', { name: '3D construction viewer' });
  const scope = viewer.getByRole('combobox', {
    name: '3D page scope',
    exact: true,
  });
  await expect(scope).toHaveValue('current');
  await viewer
    .getByRole('combobox', { name: 'Role', exact: true })
    .selectOption('stud');
  await expect(viewer).toContainText('19 objects shown');
  await scope.selectOption('combined');
  await viewer
    .getByRole('button', { name: 'Align pages', exact: true })
    .click();
  const editor = page.getByRole('dialog', {
    name: 'Align pages in combined 3D',
    exact: true,
  });
  await editor
    .getByRole('combobox', { name: 'Moving page', exact: true })
    .selectOption(firstId);
  await editor.getByLabel('X offset (m)', { exact: true }).fill('4');
  await editor.getByLabel('Rotation (degrees)', { exact: true }).fill('90');
  await editor
    .getByRole('button', { name: 'Apply alignment', exact: true })
    .click();
  await expect(editor).toBeHidden();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page.getByLabel('Workspace view', { exact: true }).selectOption('3d');
  await expect(scope).toHaveValue('current');
  await scope.selectOption('combined');
  await viewer
    .getByRole('button', { name: 'Align pages', exact: true })
    .click();
  await editor
    .getByRole('combobox', { name: 'Moving page', exact: true })
    .selectOption(firstId);
  await expect(editor.getByLabel('X offset (m)', { exact: true })).toHaveValue(
    '4',
  );
  await expect(
    editor.getByLabel('Rotation (degrees)', { exact: true }),
  ).toHaveValue('90');
  await editor
    .getByRole('button', { name: 'Reset alignment', exact: true })
    .click();
  await editor
    .getByRole('button', { name: 'Apply alignment', exact: true })
    .click();
  await expect(editor).toBeHidden();
  await viewer
    .getByRole('button', { name: 'Align pages', exact: true })
    .click();
  await editor
    .getByRole('combobox', { name: 'Moving page', exact: true })
    .selectOption(firstId);
  await expect(editor.getByLabel('X offset (m)', { exact: true })).toHaveValue(
    '0',
  );
  await expect(
    editor.getByLabel('Rotation (degrees)', { exact: true }),
  ).toHaveValue('0');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(errors).toEqual([]);
});
