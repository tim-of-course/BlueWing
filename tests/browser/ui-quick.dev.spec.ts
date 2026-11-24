import { expect, test } from '@playwright/test';
import { drawWall, pagePoint, startProject } from './takeoff';

test('canvas Enter finishes a path unless a focused control handles it', async ({
  page,
}) => {
  await startProject(page);
  await drawWall(page);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  const finish = page.getByRole('button', { name: 'Finish', exact: true });
  for (const key of ['Enter', 'Space']) {
    await pagePoint(page, 100, 200);
    await pagePoint(page, 200, 200);
    await expect(finish).toBeEnabled();
    await cancel.press(key);
    await expect(finish).toBeHidden();
  }
  await pagePoint(page, 100, 200);
  await pagePoint(page, 200, 200);
  await canvas.evaluate((element) => {
    element.addEventListener(
      'keydown',
      (event) => {
        event.preventDefault();
      },
      { once: true },
    );
  });
  await canvas.press('Enter');
  await expect(finish).toBeVisible();
  await canvas.press('Enter');
  await expect(finish).toBeHidden();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  await expect(
    page.getByText('2 drawn items are not in any quantity', { exact: true }),
  ).toBeVisible();
});

test('3D keyboard navigation preserves sheet history and plan-only tools reveal the plan', async ({
  page,
}) => {
  await startProject(page);
  const view = page.getByLabel('Workspace view', { exact: true });
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const firstId = (await canvas.getAttribute('data-sheet-id')) ?? '';
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
  await (await choosing).setFiles('tests/fixtures/assessment-plan.pdf');
  await expect(canvas).not.toHaveAttribute('data-sheet-id', firstId);
  const secondId = (await canvas.getAttribute('data-sheet-id')) ?? '';
  await view.selectOption('3d');
  const model = page.getByRole('img', { name: /^Construction model\./ });
  await model.press('Alt+ArrowLeft');
  await expect(canvas).toHaveAttribute('data-sheet-id', firstId);
  await model.press('Alt+ArrowRight');
  await expect(canvas).toHaveAttribute('data-sheet-id', secondId);

  const choose = (name: string) =>
    page.getByRole('button', { name, exact: true }).click();
  await choose('Select (V)');
  await expect(view).toHaveValue('3d');
  for (const tool of ['Path (L)', 'Area (F)', 'Count (C)', 'Annotations (A)']) {
    await view.selectOption('3d');
    await choose(tool);
    await expect(view).toHaveValue('plan');
    await expect(canvas).toBeVisible();
    await view.selectOption('split');
    await choose(tool);
    await expect(view).toHaveValue('split');
  }
  for (const initial of ['split', '3d']) {
    await view.selectOption(initial);
    await choose('Set scale (R)');
    await choose('Two points');
    await choose('Measure on plan');
    await expect(view).toHaveValue(initial === '3d' ? 'plan' : 'split');
    await expect(canvas).toBeVisible();
  }
});
