import { test, expect } from '@playwright/test';
import { productionQuantityWorkflow } from './estimaker';
test('built Quantities expands ordering/sources, downloads EstiMaker quantities and navigates to drawing', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await productionQuantityWorkflow(page);
  expect(errors).toEqual([]);
});
