import { test, expect } from '@playwright/test';
import {
  alignmentDesktopWorkflow,
  alignmentFixture,
  alignmentRenderWorkflow,
} from './page-alignment';
import { captureErrors } from './wingman';

test('production page-scoped construction exports isolate combined alignment', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await alignmentRenderWorkflow(page, await alignmentFixture(page));
  expect(errors).toEqual([]);
});

test('production page filtering and two-point alignment retain source geometry', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await alignmentDesktopWorkflow(page, await alignmentFixture(page));
  expect(errors).toEqual([]);
});
