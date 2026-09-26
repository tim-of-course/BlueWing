import { expect, type Page } from '@playwright/test';
import { startProject, drawWall } from './takeoff';

export async function systemWorkflow(page: Page): Promise<void> {
  await startProject(page);
  await drawWall(page);
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Assembly editor' });
  await editor.getByRole('button', { name: 'New system', exact: true }).click();
  await editor
    .getByLabel('Assembly name', { exact: true })
    .fill('Steel and board system');
  for (const id of ['drywall-face', 'steel-straight-run']) {
    await editor
      .getByRole('combobox', { name: 'Assembly to add', exact: true })
      .selectOption(id);
    await editor
      .getByRole('button', { name: 'Add component', exact: true })
      .click();
  }
  await editor
    .getByRole('button', { name: 'Save assembly', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Close', exact: true }),
  ).toBeEnabled();
  const systemId = await editor
    .getByLabel('Choose assembly', { exact: true })
    .inputValue();
  await editor
    .getByRole('button', { name: 'Save a copy to global library', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Global library', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await editor
    .getByLabel('Assembly name', { exact: true })
    .fill('Company steel and board');
  await editor
    .getByRole('button', { name: 'Save assembly', exact: true })
    .click();
  await editor
    .getByRole('button', { name: 'Project assemblies', exact: true })
    .click();
  await editor
    .getByLabel('Choose assembly', { exact: true })
    .selectOption(systemId);
  await expect(editor.getByLabel('Assembly name', { exact: true })).toHaveValue(
    'Steel and board system',
  );
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('New group name', { exact: true }).fill('System walls');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Assembly to assign', exact: true })
    .selectOption(systemId);
  await page
    .getByRole('button', { name: 'Assign assembly', exact: true })
    .click();
  await page.getByLabel('height (ft)', { exact: true }).fill('10');
  await page.getByLabel('stockLength (ft)', { exact: true }).fill('12');
  await page
    .getByRole('button', { name: 'Save assignment', exact: true })
    .click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  const totals = page.getByRole('table', { name: 'Material totals' });
  await expect(totals).toContainText('240 ft2');
  await expect(totals).toContainText('19 ea');
  await page.getByLabel('height (ft)', { exact: true }).fill('12');
  await page
    .getByRole('button', { name: 'Save assignment', exact: true })
    .click();
  await expect(totals).toContainText('288 ft2');
  await expect(
    page.getByRole('table', { name: 'Piece schedule' }),
  ).toContainText('12′ 0″');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  await expect(totals).toContainText('288 ft2');
  await expect(totals).toContainText('19 ea');
  await page
    .getByRole('button', {
      name: 'System walls, 1 drawing objects',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
}

export async function detailedWorkflow(page: Page): Promise<void> {
  await startProject(page);
  await drawWall(page);
  await page.getByRole('button', { name: 'Construction', exact: true }).click();
  const editor = page.getByRole('dialog', {
    name: 'Construction editor',
    exact: true,
  });
  await editor.getByRole('button', { name: 'New wall', exact: true }).click();
  await editor
    .getByLabel('Wall height (ft) (optional)', { exact: true })
    .fill('10');
  await editor
    .getByRole('group', { name: 'Stud', exact: true })
    .getByLabel('Material Id', { exact: true })
    .fill('362S162-33');
  await editor
    .getByRole('group', { name: 'Track', exact: true })
    .getByLabel('Material Id', { exact: true })
    .fill('362T125-33');
  const finishes = editor.getByRole('group', { name: 'Finishes', exact: true });
  await finishes
    .getByRole('button', { name: 'Add finishes item', exact: true })
    .click();
  await finishes.getByLabel('Material Id', { exact: true }).fill('5/8 Type X');
  await editor
    .getByRole('button', { name: 'Save construction', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Close', exact: true }),
  ).toBeEnabled();
  await editor
    .getByLabel('Template name', { exact: true })
    .fill('W1 steel and board');
  await editor
    .getByRole('button', { name: 'Save as project template', exact: true })
    .click();
  await editor
    .getByRole('combobox', { name: 'Use template', exact: true })
    .selectOption({ label: 'W1 steel and board' });
  await editor
    .getByLabel('Wall height (ft) (optional)', { exact: true })
    .fill('12');
  await editor
    .getByRole('button', { name: 'Preview quantities', exact: true })
    .click();
  await expect(
    editor.getByRole('table', { name: 'Material changes' }),
  ).toContainText('+48 ft2');
  await editor
    .getByRole('button', { name: 'Cancel edits', exact: true })
    .click();
  await editor
    .getByRole('navigation', { name: 'Construction records' })
    .getByRole('button', { name: /Path/ })
    .first()
    .click();
  await expect(
    editor.getByLabel('Wall height (ft) (optional)', { exact: true }),
  ).toHaveValue('10');
  await editor
    .getByRole('combobox', { name: 'Use template', exact: true })
    .selectOption({ label: 'W1 steel and board' });
  await editor
    .getByRole('button', { name: 'Apply template and save wall', exact: true })
    .click();
  await expect(
    editor.getByRole('button', { name: 'Close', exact: true }),
  ).toBeEnabled();
  await editor
    .getByRole('button', { name: 'Piece schedule', exact: true })
    .click();
  await expect(editor).toContainText('positioned pieces');
  await expect(editor.getByRole('table')).toContainText('362S162-33');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('240 ft2');
  await expect(
    page
      .getByRole('table', { name: 'Material totals' })
      .getByRole('row')
      .filter({ hasText: '362S162-33' }),
  ).toContainText('19 ea');
  await page
    .getByLabel('Workspace view', { exact: true })
    .selectOption('split');
  const viewer = page.getByRole('region', { name: '3D construction viewer' });
  await expect(viewer).toBeVisible();
  await viewer
    .getByRole('combobox', { name: 'Role', exact: true })
    .selectOption('stud');
  await expect(viewer).toContainText('19 objects shown');
  await viewer.getByRole('img').press('ArrowRight');
  await viewer.getByRole('img').press('+');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Takeoff review' });
  await review
    .getByRole('button', { name: /^wall ·/ })
    .first()
    .click();
  await review
    .getByLabel('Review note', { exact: true })
    .fill('Checked wall height and product');
  await review
    .getByRole('button', { name: 'Mark reviewed', exact: true })
    .click();
  await expect(review.locator('.review-row').first()).toContainText('reviewed');
  await review
    .getByRole('button', { name: 'Attach plan snippet', exact: true })
    .click();
  await review.getByLabel('Snippet name', { exact: true }).fill('Wall W1 plan');
  await review
    .getByRole('button', { name: 'Preview snippet', exact: true })
    .click();
  await expect(
    review.getByRole('img', { name: 'Highlighted plan snippet preview' }),
  ).toBeVisible();
  await review
    .getByRole('button', { name: 'Save snippet', exact: true })
    .click();
  const downloaded = page.waitForEvent('download');
  await review.getByRole('button', { name: 'Export PNG', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('Wall W1 plan.png');
  await review.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('240 ft2');
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(review.locator('.review-row').first()).toContainText('changed');
  await review
    .getByRole('button', { name: 'Plan snippets', exact: true })
    .click();
  await expect(
    review.getByRole('button', { name: 'Wall W1 plan', exact: true }),
  ).toBeVisible();
  await review.getByRole('button', { name: 'Close', exact: true }).click();
}
