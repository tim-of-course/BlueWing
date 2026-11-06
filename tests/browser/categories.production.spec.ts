import { test } from '@playwright/test';
import {
  categoryVisibilityWorkflow,
  categoryEditorWorkflow,
} from './categories';

test('category filters survive reopening in production', async ({ page }) => {
  await categoryVisibilityWorkflow(page);
});
test('project category editing works in production', async ({ page }) => {
  await categoryEditorWorkflow(page);
});
