import { test } from '@playwright/test';
import {
  categoryVisibilityWorkflow,
  categoryEditorWorkflow,
  categoryWingmanWorkflow,
} from './categories';

test('category filtering hides and restores uncategorized drawing and survives reopening', async ({
  page,
}) => {
  await categoryVisibilityWorkflow(page);
});
test('project-only categories can be created and assigned in the assembly editor', async ({
  page,
}) => {
  await categoryEditorWorkflow(page);
});
test('CLI category views can be filtered and restore the original filter', async ({
  page,
}) => {
  await categoryWingmanWorkflow(page);
});
