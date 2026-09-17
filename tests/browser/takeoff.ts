import { expect, type Page } from '@playwright/test';

export async function pagePoint(
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const position = await canvas.evaluate(
    (element, point) => {
      const box = element.getBoundingClientRect();
      return {
        x:
          box.x +
          Number(element.getAttribute('data-camera-x')) +
          point.x * Number(element.getAttribute('data-camera-zoom')),
        y:
          box.y +
          Number(element.getAttribute('data-camera-y')) +
          point.y * Number(element.getAttribute('data-camera-zoom')),
      };
    },
    { x, y },
  );
  await page.mouse.click(position.x, position.y);
}

export async function startProject(page: Page): Promise<void> {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Workflow fixture');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
  await (await choosing).setFiles('tests/fixtures/assessment-plan.pdf');
  await expect(
    page.getByLabel('Drawing canvas', { exact: true }),
  ).toHaveAttribute('data-sheet-id', /.+/);
  await expect(page.getByText('Rendering PDF…', { exact: true })).toBeHidden();
}

export async function drawWall(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'Set scale (R)', exact: true })
    .click();
  await page.getByRole('button', { name: 'Custom ratio', exact: true }).click();
  await page.getByLabel('Real distance', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Apply scale', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Set sheet scale' }),
  ).toBeHidden();
  // Use one CSS pixel per page unit so WebKit's pointer rounding cannot
  // alter the independent printed-scale fixture measurements.
  await page.getByLabel('Drawing canvas', { exact: true }).press('Control+1');
  await page.getByRole('button', { name: 'Path (L)', exact: true }).click();
  await pagePoint(page, 72, 144);
  await pagePoint(page, 360, 144);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Finish', exact: true }),
  ).toBeHidden();
}

export async function calculateAndReopen(page: Page): Promise<void> {
  await page.getByLabel('New group name', { exact: true }).fill('Walls');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Recipe to assign', exact: true })
    .selectOption('wall-area');
  await page
    .getByRole('button', { name: 'Assign recipe', exact: true })
    .click();
  await page.getByLabel('layers (scalar)', { exact: true }).fill('2');
  await page.getByLabel('layers (scalar)', { exact: true }).press('Tab');
  await page
    .getByRole('button', { name: 'Save assignment', exact: true })
    .click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('384 ft2');
  await page.getByLabel('Waste %', { exact: true }).fill('10');
  await page.getByLabel('Waste %', { exact: true }).press('Tab');
  await page
    .getByLabel('Quantity per package (optional)', { exact: true })
    .fill('32');
  await page
    .getByLabel('Quantity per package (optional)', { exact: true })
    .press('Tab');
  await page
    .getByRole('button', { name: 'Save assignment', exact: true })
    .click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('448 ft2');
  await expect(page.getByText('14', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('384 ft2');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('448 ft2');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('Workflow fixture.csv');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No project open', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('448 ft2');
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeDisabled();

  await page.getByRole('button', { name: 'Drawing', exact: true }).click();
  await page.getByRole('button', { name: 'Area (F)', exact: true }).click();
  for (const [x, y] of [
    [72, 144],
    [360, 144],
    [360, 324],
    [72, 324],
  ] as const)
    await pagePoint(page, x, y);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByLabel('New group name', { exact: true }).fill('Floor');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Recipe to assign', exact: true })
    .selectOption('floor-area');
  await page
    .getByRole('button', { name: 'Assign recipe', exact: true })
    .click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  const floorQuantity = page
    .getByRole('table', { name: 'Material totals' })
    .getByRole('row')
    .filter({ hasText: 'floor-finish' })
    .getByRole('cell')
    .nth(1);
  await expect(floorQuantity).toContainText('ft2');
  // WebKit rounds mouse locations to CSS pixels at fit zoom. Exact page-coordinate
  // arithmetic is checked by the core and native CLI fixtures; this checks drawing.
  expect(
    Math.abs(
      Number.parseFloat((await floorQuantity.innerText()).replaceAll(',', '')) -
        360,
    ),
  ).toBeLessThan(2);
  await page.getByRole('button', { name: 'Drawing', exact: true }).click();
  await page
    .getByRole('button', { name: 'Clear context', exact: true })
    .click();
  await page.getByRole('button', { name: 'Count (C)', exact: true }).click();
  for (const [x, y] of [
    [100, 200],
    [180, 200],
    [270, 200],
  ] as const)
    await pagePoint(page, x, y);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await page.getByLabel('New group name', { exact: true }).fill('Fixtures');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Recipe to assign', exact: true })
    .selectOption('count');
  await page
    .getByRole('button', { name: 'Assign recipe', exact: true })
    .click();
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  await expect(
    page.getByRole('table', { name: 'Material totals' }),
  ).toContainText('3 ea');
}
