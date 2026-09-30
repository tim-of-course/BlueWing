import { expect, test } from '@playwright/test';
import { captureErrors, captureWorkflow, startWingmanProject } from './wingman';

test('built Wingman captures pixels and preserves messages across reopen', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await startWingmanProject(page);
  await captureWorkflow(page);
  expect(errors).toEqual([]);
});
