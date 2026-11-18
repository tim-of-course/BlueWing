import { expect, test } from '@playwright/test';
import {
  browserPromptWorkflow,
  keyboardWorkflow,
  captureErrors,
  captureWorkflow,
  startWingmanProject,
} from './wingman';
import { openPanel } from './panels';

test('built Wingman keyboard and desktop connection guidance', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await startWingmanProject(page);
  await openPanel(page, 'Wingman');
  await browserPromptWorkflow(page);
  await page
    .getByRole('button', { name: 'Copy AI prompt', exact: true })
    .click();
  await keyboardWorkflow(page);
  expect(errors).toEqual([]);
});

test('built Wingman sends a marked plan view and reopens it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await captureErrors(page);
  await startWingmanProject(page);
  await openPanel(page, 'Wingman');
  await page.getByRole('button', { name: 'Attach view', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Annotate view' });
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeEnabled();
  await dialog.getByLabel('View annotation tool').selectOption('text');
  await dialog
    .getByLabel('View annotation surface')
    .click({ position: { x: 100, y: 120 } });
  await dialog.getByLabel('Annotation text').fill('Verify dimension');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const card = page
    .getByRole('log')
    .getByRole('button', { name: /^Open view:/ });
  await expect(card.getByLabel('View annotations')).toBeVisible();
  await card.click();
  await page.getByRole('button', { name: 'Return to your view' }).click();
  expect(errors).toEqual([]);
});

test('built Wingman captures pixels and preserves messages across reopen', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  // The capture includes content from Sheets, the drawing and Wingman, followed by an Inspector edit.
  await page.setViewportSize({ width: 1760, height: 720 });
  await startWingmanProject(page);
  await captureWorkflow(page);
  expect(errors).toEqual([]);
});
