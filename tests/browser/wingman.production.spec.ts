import { expect, test } from '@playwright/test';
import {
  browserPromptWorkflow,
  keyboardWorkflow,
  captureErrors,
  captureWorkflow,
  startWingmanProject,
} from './wingman';

test('built Wingman keyboard and desktop connection guidance', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startWingmanProject(page);
  await browserPromptWorkflow(page);
  await page
    .getByRole('button', { name: 'Copy AI prompt', exact: true })
    .click();
  await keyboardWorkflow(page);
  expect(errors).toEqual([]);
});

test('built Wingman captures pixels and preserves messages across reopen', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startWingmanProject(page);
  await captureWorkflow(page);
  expect(errors).toEqual([]);
});
