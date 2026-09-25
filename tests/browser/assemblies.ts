import { expect, type Page } from '@playwright/test';
import { drawWall, startProject } from './takeoff';

export async function assemblyWorkflow(page: Page): Promise<void> {
  await startProject(page);
  await drawWall(page);
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click();
  const editor = page.getByRole('dialog', {
    name: 'Assembly editor',
    exact: true,
  });
  await editor
    .getByRole('button', { name: 'Global library', exact: true })
    .click();
  await editor
    .getByLabel('Choose assembly', { exact: true })
    .selectOption('drywall-face');
  await editor
    .getByRole('button', { name: 'Import into project', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Project assemblies', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const projectId = await editor
    .getByLabel('Choose assembly', { exact: true })
    .inputValue();
  await editor
    .getByLabel('Assembly name', { exact: true })
    .fill('Type X drywall');
  await editor
    .getByLabel('Material / product', { exact: true })
    .fill('5/8 Type X board');
  await editor
    .getByLabel('Detail / specification reference', { exact: true })
    .fill('Wall type W1 / A6.1');
  await editor
    .getByRole('button', { name: 'Save assembly', exact: true })
    .click();
  await editor
    .getByRole('button', { name: 'Save a copy to global library', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Global library', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const libraryId = await editor
    .getByLabel('Choose assembly', { exact: true })
    .inputValue();
  await editor
    .getByLabel('Assembly name', { exact: true })
    .fill('Company drywall');
  await editor
    .getByRole('group', { name: 'Input 2', exact: true })
    .getByLabel('Default', { exact: true })
    .fill('3');
  await editor
    .getByRole('button', { name: 'Save assembly', exact: true })
    .click();
  await editor
    .getByRole('button', { name: 'Project assemblies', exact: true })
    .click();
  await editor
    .getByLabel('Choose assembly', { exact: true })
    .selectOption(projectId);
  await expect(editor.getByLabel('Assembly name', { exact: true })).toHaveValue(
    'Type X drywall',
  );
  await expect(
    editor
      .getByRole('group', { name: 'Input 2', exact: true })
      .getByLabel('Default', { exact: true }),
  ).toHaveValue('1');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByLabel('New group name', { exact: true })
    .fill('Detailed walls');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Assembly to assign', exact: true })
    .selectOption(projectId);
  await page
    .getByRole('button', { name: 'Assign assembly', exact: true })
    .click();
  await expect(page.getByLabel('height (ft)', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('Incomplete');
  await page.getByLabel('height (ft)', { exact: true }).fill('10');
  await page.getByLabel('deduction (ft2)', { exact: true }).fill('21');
  await page
    .getByRole('button', { name: 'Save assignment', exact: true })
    .click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('219 ft2');
  const scope = page.getByRole('combobox', {
    name: 'Input scope',
    exact: true,
  });
  const objectId = await scope.locator('option').nth(1).getAttribute('value');
  expect(objectId).toBeTruthy();
  await scope.selectOption(objectId ?? '');
  await page.getByLabel('layers (scalar)', { exact: true }).fill('2');
  await page
    .getByRole('button', { name: 'Save assignment', exact: true })
    .click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('438 ft2');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('219 ft2');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('438 ft2');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('438 ft2');
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click();
  await editor
    .getByRole('button', { name: 'Global library', exact: true })
    .click();
  await editor
    .getByLabel('Choose assembly', { exact: true })
    .selectOption(libraryId);
  await expect(editor.getByLabel('Assembly name', { exact: true })).toHaveValue(
    'Company drywall',
  );
  await expect(
    editor
      .getByRole('group', { name: 'Input 2', exact: true })
      .getByLabel('Default', { exact: true }),
  ).toHaveValue('3');
  await editor
    .getByLabel('Choose assembly', { exact: true })
    .selectOption('steel-straight-run');
  await editor
    .getByRole('button', { name: 'Import into project', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Project assemblies', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const steelId = await editor
    .getByLabel('Choose assembly', { exact: true })
    .inputValue();
  await expect(
    editor.getByLabel('Cut length formula', { exact: true }),
  ).toHaveValue('height - endAllowance');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Detailed walls, 1 drawing objects',
      exact: true,
    })
    .click();
  await page
    .getByRole('combobox', { name: 'Assembly to assign', exact: true })
    .selectOption(steelId);
  await page
    .getByRole('button', { name: 'Assign assembly', exact: true })
    .click();
  const steel = page.locator('section.panel-section').filter({
    has: page.getByRole('heading', {
      name: 'Steel studs — straight run',
      exact: true,
    }),
  });
  await steel.getByLabel('height (ft)', { exact: true }).fill('10');
  await steel.getByLabel('endAllowance (in)', { exact: true }).fill('0.5');
  await steel.getByLabel('stockLength (ft)', { exact: true }).fill('12');
  await steel
    .getByRole('button', { name: 'Save assignment', exact: true })
    .click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  const pieces = page.getByRole('table', {
    name: 'Piece schedule',
    exact: true,
  });
  await expect(pieces).toContainText('19');
  await expect(pieces).toContainText('9′ 11.5″');
  await expect(pieces).toContainText('12′ 0″');
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export piece CSV', exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe(
    'Workflow fixture-pieces.csv',
  );
}
