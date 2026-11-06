import { test, expect } from '@playwright/test';
import { captureErrors, startWingmanProject } from './wingman';
import { notesWorkflow } from './notes';

test('built scratchpad save, find and cancel', async ({ page }) => {
  const errors = await captureErrors(page);
  await startWingmanProject(page);
  await notesWorkflow(page);
  expect(errors).toEqual([]);
});
