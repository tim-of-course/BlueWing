import { expect, type Page } from '@playwright/test';
import { drawWall, startProject } from './takeoff';
import { captureErrors, cli, startWingmanProject } from './wingman';
import type { Project } from '../../src/core/types';
import type { WorkspaceViewSnapshot } from '../../src/app/wingman-types';

export async function categoryVisibilityWorkflow(page: Page): Promise<void> {
  await startProject(page);
  await drawWall(page);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const filter = page.locator('details.category-filter').first();
  await filter.locator('summary').click();
  await filter.getByLabel('Uncategorized').check();
  await expect(filter.getByLabel('Uncategorized')).toBeChecked();
  const shown = await canvas.screenshot();
  await filter.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(filter.getByLabel('Uncategorized')).not.toBeChecked();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(shown))
    .toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(canvas).toHaveAttribute('aria-busy', 'false');
  await filter.locator('summary').click();
  await expect(filter.getByLabel('All', { exact: true })).not.toBeChecked();
  await filter.getByLabel('Uncategorized').check();
  await expect(filter.getByLabel('Uncategorized')).toBeChecked();
}

export async function categoryEditorWorkflow(page: Page): Promise<void> {
  const errors = await captureErrors(page);
  await startProject(page);
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click();
  const editor = page.getByRole('dialog', {
    name: 'Assembly editor',
    exact: true,
  });
  await editor
    .getByRole('button', { name: 'New assembly', exact: true })
    .click();
  await editor
    .getByLabel('Assembly name', { exact: true })
    .fill('Specialty assembly');
  await editor
    .getByText('Add or edit project category', { exact: true })
    .click();
  await editor
    .getByLabel('Project category name', { exact: true })
    .fill('Specialty scope');
  await editor
    .getByLabel('Project category color', { exact: true })
    .fill('#8236dc');
  await editor
    .getByRole('button', { name: 'Save category', exact: true })
    .click();
  await expect(editor.getByLabel('Category', { exact: true })).toHaveValue(
    'Specialty scope',
  );
  await editor
    .getByRole('button', { name: 'Save assembly', exact: true })
    .click();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  const filter = page.locator('details.category-filter').first();
  await filter.locator('summary').click();
  await filter.getByLabel('Specialty scope', { exact: true }).check();
  await expect(
    filter.getByLabel('Specialty scope', { exact: true }),
  ).toBeChecked();
  await page.reload();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(
    page.getByLabel('Drawing canvas', { exact: true }),
  ).toHaveAttribute('aria-busy', 'false');
  await filter.locator('summary').click();
  await expect(
    filter.getByLabel('Specialty scope', { exact: true }),
  ).toBeChecked();
  expect(errors).toEqual([]);
}

export async function categoryWingmanWorkflow(page: Page): Promise<void> {
  const errors = await captureErrors(page);
  await startWingmanProject(page, true);
  await drawWall(page);
  const initial = (await cli<Project>(page, 'project.inspect')).response;
  const sheet = Object.values(initial.data.sheets)[0];
  if (!sheet) throw new Error('Missing sheet');
  const rendered = await cli(page, 'sheet.render', {
    sheetId: sheet.id,
    path: 'scopes.png',
    mode: 'takeoff',
    categories: [],
  });
  expect(rendered.exitCode).toBe(0);
  await cli(page, 'wingman.flash');
  await page
    .getByRole('button', { name: 'Swap to agent view', exact: true })
    .click();
  const main = async () =>
    (await cli<{ main: WorkspaceViewSnapshot }>(page, 'wingman.inspect'))
      .response.data.main;
  expect((await main()).plan?.categories).toEqual([]);
  const filter = page.locator('details.category-filter').first();
  await filter.locator('summary').click();
  await filter.getByLabel('Uncategorized').check();
  await expect
    .poll(async () => (await main()).plan?.categories)
    .toEqual([null]);
  await expect
    .poll(async () => (await main()).plan?.visibleGeometryIds?.length)
    .toBe(1);
  await filter.locator('summary').click();
  await page
    .getByRole('button', { name: 'Return to your view', exact: true })
    .click();
  expect((await main()).plan?.categories).toBeUndefined();
  expect((await cli(page, 'project.inspect')).response.revision).toBe(
    initial.revision,
  );
  expect(errors).toEqual([]);
}
