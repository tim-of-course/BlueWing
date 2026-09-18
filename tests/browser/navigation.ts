import { expect, type Page } from '@playwright/test';
import { drawWall, startProject } from './takeoff';

export async function navigatorWorkflow(page: Page) {
  await startProject(page);
  await drawWall(page);
  await page.getByLabel('New group name', { exact: true }).fill('Walls');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const firstId = await canvas.getAttribute('data-sheet-id');
  if (!firstId) throw new Error('Missing first sheet');
  const firstBranch = page.locator(`.sheet-branch[data-sheet-id="${firstId}"]`);
  await expect(
    firstBranch.getByRole('button', {
      name: 'Walls, 1 drawing objects',
      exact: true,
    }),
  ).toBeVisible();
  await firstBranch.locator('.sheet-row').hover();
  const preview = page.getByRole('tooltip', { name: 'Sheet preview' });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('img')).toBeVisible();
  const thumbnailSource = await preview.getByRole('img').getAttribute('src');
  if (!thumbnailSource) throw new Error('Missing preview thumbnail');
  await canvas.focus();
  await page.mouse.move(700, 600);
  await expect(preview).toBeHidden();
  // Inspect the tooltip as it mounts, before an eventual image assertion could
  // hide a loading flash on repeated hover.
  const [repeatedPreview] = await Promise.all([
    page.evaluate(
      () =>
        new Promise<{ source: string | null; loading: boolean }>((resolve) => {
          const observer = new MutationObserver(() => {
            const tooltip = document.querySelector('.sheet-preview');
            if (!tooltip) return;
            observer.disconnect();
            resolve({
              source: tooltip.querySelector('img')?.getAttribute('src') ?? null,
              loading: !!tooltip.querySelector('[role="status"]'),
            });
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }),
    ),
    firstBranch.locator('.sheet-row').hover(),
  ]);
  expect(repeatedPreview).toEqual({ source: thumbnailSource, loading: false });
  await firstBranch
    .getByRole('button', { name: 'Walls, 1 drawing objects', exact: true })
    .hover();
  await expect(preview).toHaveAttribute('data-sheet-id', firstId);
  await expect(canvas).toHaveAttribute('data-sheet-id', firstId);
  await page
    .getByLabel('Group for new drawing', { exact: true })
    .selectOption('');
  await firstBranch
    .getByRole('button', { name: 'Walls, 1 drawing objects', exact: true })
    .click();
  await firstBranch.locator('.sheet-row').click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Sheet actions', exact: true })
    .press('Escape');
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select (V)', exact: true }).click();
  await expect(page.getByLabel('Object name', { exact: true })).toHaveValue(
    'Path 1',
  );
  await expect(
    page
      .getByRole('complementary', { name: 'Inspector', exact: true })
      .getByText('24 ft', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Object name', { exact: true }).fill('North wall');
  await page.getByRole('button', { name: 'Save name', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Save name', exact: true }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Recipes', exact: true }).click();
  const editor = page.getByRole('dialog', {
    name: 'Recipe editor',
    exact: true,
  });
  await editor
    .getByLabel('Choose recipe', { exact: true })
    .selectOption('wall-area');
  await editor
    .getByText('Preview on selected drawing', { exact: true })
    .click();
  await expect(
    editor.getByText('Wall area: 192 ft2', { exact: true }),
  ).toBeVisible();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Path (L)', exact: true }).click();
  await expect(
    page.getByLabel('Group for new drawing', { exact: true }),
  ).toHaveValue('');
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await page
    .getByLabel('Filter sheets and groups', { exact: true })
    .fill('Walls');
  await expect(firstBranch).toBeVisible();
  await page
    .getByLabel('Filter sheets and groups', { exact: true })
    .fill('no match');
  await expect(
    page.getByText('No sheets or groups match.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Filter sheets and groups', { exact: true }).fill('');

  const separator = page.getByRole('separator', {
    name: 'Resize Sheets',
    exact: true,
  });
  const beforeWidth = Number(await separator.getAttribute('aria-valuenow'));
  const handle = await separator.boundingBox();
  if (!handle) throw new Error('Missing resize handle');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 180);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 50, handle.y + 180, {
    steps: 4,
  });
  await page.mouse.up();
  await expect(separator).toHaveAttribute(
    'aria-valuenow',
    String(beforeWidth + 50),
  );
  await page
    .getByRole('button', { name: 'Collapse Sheets', exact: true })
    .click();
  await page.mouse.move(700, 600);
  await canvas.focus();
  await expect(
    page.getByRole('complementary', { name: 'Sheets', exact: true }),
  ).toBeHidden();
  const pin = page.getByRole('button', { name: 'Pin Sheets', exact: true });
  await pin.hover();
  await expect(
    page.getByRole('complementary', { name: 'Sheets', exact: true }),
  ).toBeVisible();
  await pin.click();
  await expect(separator).toHaveAttribute(
    'aria-valuenow',
    String(beforeWidth + 50),
  );

  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoom = await canvas.getAttribute('data-camera-zoom');
  await page.getByRole('button', { name: 'Quantities', exact: true }).click();
  await page.getByRole('button', { name: 'Drawing', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-camera-zoom', zoom ?? '');

  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
  await (await choosing).setFiles('tests/fixtures/assessment-plan.pdf');
  await expect(canvas).not.toHaveAttribute('data-sheet-id', firstId);
  const secondId = await canvas.getAttribute('data-sheet-id');
  const firstRow = firstBranch.locator('.sheet-row');
  await firstRow.click({ button: 'right' });
  await expect(canvas).toHaveAttribute('data-sheet-id', secondId ?? '');
  await page
    .getByRole('menuitem', { name: 'Rename sheet…', exact: true })
    .click();
  await page.getByLabel('Sheet name', { exact: true }).fill('A2.0 Floor plan');
  await page.getByRole('button', { name: 'Save sheet', exact: true }).click();
  await expect(firstRow).toContainText('A2.0 Floor plan');
  await firstRow.hover();
  await expect(preview.getByRole('img')).toHaveAttribute(
    'src',
    thumbnailSource,
  );
  await expect(preview.getByRole('img')).toHaveAttribute(
    'alt',
    'Plan preview: A2.0 Floor plan',
  );
  await firstRow.press('Alt+ArrowDown');
  await expect(page.locator('.sheet-row').last()).toContainText(
    'A2.0 Floor plan',
  );
  await firstRow.click();
  await expect(canvas).toHaveAttribute('data-sheet-id', firstId);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(page.locator('.sheet-row').last()).toContainText(
    'A2.0 Floor plan',
  );
  await expect(
    firstBranch.getByRole('button', {
      name: 'Walls, 1 drawing objects',
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('separator', { name: 'Resize Sheets', exact: true }),
  ).toHaveAttribute('aria-valuenow', String(beforeWidth + 50));
}
