import { expect, type Page } from '@playwright/test';
import { drawWall, startProject } from './takeoff';

export async function materialLayoutWorkflow(page: Page): Promise<void> {
  await startProject(page);
  await drawWall(page);
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Assembly editor' });
  await editor
    .getByRole('button', { name: 'Global library', exact: true })
    .click();
  await editor
    .getByRole('combobox', { name: 'Choose assembly', exact: true })
    .selectOption('frp-wall');
  await editor
    .getByRole('button', { name: 'Import into project', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Project assemblies', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const frpId = await editor
    .getByRole('combobox', { name: 'Choose assembly', exact: true })
    .inputValue();
  const surface = editor.getByRole('group', {
    name: 'Surface assembly',
    exact: true,
  });
  await expect(
    surface.getByLabel('Surface height (ft) (optional)', { exact: true }),
  ).toHaveValue('');
  await surface
    .getByLabel('Surface height (ft) (optional)', { exact: true })
    .fill('8');
  await surface
    .getByLabel('Thickness (ft) (optional)', { exact: true })
    .fill('0.01');
  await surface
    .getByLabel('Package Size (ft²) (optional)', { exact: true })
    .fill('32');
  await editor
    .getByRole('button', { name: 'Save assembly', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Close', exact: true }),
  ).toBeEnabled();

  await editor
    .getByRole('button', { name: 'Global library', exact: true })
    .click();
  await editor
    .getByRole('combobox', { name: 'Choose assembly', exact: true })
    .selectOption('steel-box-header');
  await editor
    .getByRole('button', { name: 'Import into project', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Project assemblies', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  const headerId = await editor
    .getByRole('combobox', { name: 'Choose assembly', exact: true })
    .inputValue();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByLabel('New group name', { exact: true }).fill('FRP walls');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Assembly to assign', exact: true })
    .selectOption(frpId);
  await page
    .getByRole('button', { name: 'Assign assembly', exact: true })
    .click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  const totals = page.getByRole('table', { name: 'Material totals' });
  const frpTotal = totals
    .getByRole('row')
    .filter({ hasText: 'frp-unspecified' });
  await expect(frpTotal).toContainText('192 ft2');

  const scope = page.getByRole('combobox', {
    name: 'Input scope',
    exact: true,
  });
  const traceId = await scope.locator('option').nth(1).getAttribute('value');
  expect(traceId).toBeTruthy();
  await scope.selectOption(traceId ?? '');
  await page
    .getByLabel('Surface height (ft) (optional)', { exact: true })
    .fill('12');
  await page
    .getByRole('button', { name: 'Save assignment', exact: true })
    .click();
  await expect(frpTotal).toContainText('288 ft2');
  await page
    .getByRole('combobox', { name: 'Workspace view', exact: true })
    .selectOption('split');
  const viewer = page.getByRole('region', { name: '3D construction viewer' });
  await viewer
    .getByRole('combobox', { name: 'View', exact: true })
    .selectOption('front');
  await expect(viewer).toContainText('1 objects shown');
  await expect(viewer.getByRole('status')).toBeHidden();
  await viewer.getByRole('img').click();
  const selected = viewer.getByRole('complementary', {
    name: 'Selected construction item',
  });
  await expect(selected).toContainText('frp-unspecified');
  await expect(selected).toContainText('Installed finish area: 26.756 m²');
  await expect(selected).toContainText('Total thickness 3.0 mm');

  await page.getByRole('button', { name: 'Construction', exact: true }).click();
  const construction = page.getByRole('dialog', {
    name: 'Construction editor',
  });
  await construction
    .getByRole('combobox', { name: 'Construction type', exact: true })
    .selectOption('headers');
  await construction
    .getByRole('button', { name: 'New header', exact: true })
    .click();
  await construction
    .getByRole('combobox', { name: 'Header assembly', exact: true })
    .selectOption(headerId);
  await construction
    .getByRole('button', { name: 'Use header assembly', exact: true })
    .click();
  const components = construction.getByRole('group', {
    name: 'Components',
    exact: true,
  });
  await expect(components.getByLabel('Role', { exact: true })).toHaveCount(4);
  await expect(
    components.getByLabel('Material Id', { exact: true }).first(),
  ).toHaveValue('steel-stud-6in-unspecified');
  await construction.getByLabel('Name', { exact: true }).fill('Door header H1');
  await construction
    .getByRole('button', { name: 'Save construction', exact: true })
    .click();
  await construction
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  // A reusable opening detail contributes no extra material until an opening uses it.
  await expect(totals).not.toContainText('steel-stud-6in-unspecified');
  await expect(frpTotal).toContainText('288 ft2');

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  await expect(frpTotal).toContainText('288 ft2');
  await page.getByRole('button', { name: 'Construction', exact: true }).click();
  await construction
    .getByRole('combobox', { name: 'Construction type', exact: true })
    .selectOption('headers');
  await construction
    .getByRole('navigation', { name: 'Construction records' })
    .getByRole('button', { name: 'Door header H1', exact: true })
    .click();
  await expect(components.getByLabel('Role', { exact: true })).toHaveCount(4);
  await construction
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'FRP walls, 1 drawing objects', exact: true })
    .click();
  await scope.selectOption(traceId ?? '');
  await expect(
    page.getByLabel('Surface height (ft) (optional)', { exact: true }),
  ).toHaveValue('12');
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
}
