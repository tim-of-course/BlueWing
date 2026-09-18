import { expect, type Page } from '@playwright/test';
import { pagePoint } from './takeoff';

async function moveTo(page: Page, x: number, y: number) {
  const position = await page
    .getByLabel('Drawing canvas', { exact: true })
    .evaluate(
      (canvas, point) => {
        const box = canvas.getBoundingClientRect();
        const zoom = Number(canvas.getAttribute('data-camera-zoom'));
        return {
          x:
            box.x +
            Number(canvas.getAttribute('data-camera-x')) +
            point.x * zoom,
          y:
            box.y +
            Number(canvas.getAttribute('data-camera-y')) +
            point.y * zoom,
        };
      },
      { x, y },
    );
  await page.mouse.move(position.x, position.y);
}

export async function selectionWorkflow(page: Page) {
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const selected = page.locator('.workspace-toolbar .muted');
  await canvas.press('Control+1');
  await page.getByRole('button', { name: 'Path (L)', exact: true }).click();
  for (const y of [144, 220]) {
    await pagePoint(page, 72, y);
    await pagePoint(page, 360, y);
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Finish', exact: true }),
    ).toBeHidden();
  }
  await canvas.press('Escape');
  await moveTo(page, 180, 100);
  await expect(page.locator('.canvas-reticle')).toBeVisible();
  await expect(canvas).toHaveCSS('cursor', 'none');
  // No mouse button: one fast sweep must catch both paths between events.
  await page.keyboard.down('b');
  await expect(canvas).toHaveAttribute('data-brush-mode', 'add');
  await moveTo(page, 180, 260);
  await expect(selected).toHaveText('2 selected');
  await page.keyboard.up('b');
  await expect(canvas).not.toHaveAttribute('data-brush-mode');
  await expect(
    page.getByRole('button', { name: 'Path (L)', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Finish', exact: true }),
  ).toBeHidden();

  await moveTo(page, 180, 100);
  await page.keyboard.down('Alt');
  await page.keyboard.down('b');
  await expect(canvas).toHaveAttribute('data-brush-mode', 'subtract');
  await moveTo(page, 180, 260);
  await expect(selected).toHaveText('0 selected');
  await page.keyboard.up('b');
  await page.keyboard.up('Alt');

  await page.getByRole('button', { name: 'Select (V)', exact: true }).click();
  await pagePoint(page, 180, 144);
  await page.keyboard.down('Shift');
  await pagePoint(page, 180, 144);
  await expect(selected).toHaveText('1 selected');
  await pagePoint(page, 180, 220);
  await page.keyboard.up('Shift');
  await expect(selected).toHaveText('2 selected');
  await page.keyboard.down('Alt');
  await pagePoint(page, 180, 144);
  await expect(selected).toHaveText('1 selected');
  await moveTo(page, 160, 200);
  await page.mouse.down();
  await moveTo(page, 200, 240);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(selected).toHaveText('0 selected');

  // Holding B never hijacks text entry or remains held after focus loss.
  const input = page.getByLabel('New group name', { exact: true });
  await input.fill('');
  await input.press('b');
  await expect(input).toHaveValue('b');
  await expect(canvas).not.toHaveAttribute('data-brush-mode');
  await input.fill('');
  await canvas.focus();
  await moveTo(page, 180, 100);
  await page.keyboard.down('b');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(canvas).not.toHaveAttribute('data-brush-mode');
  await page.keyboard.up('b');

  // Closed panel controls have their own space on both ends of the toolbar.
  await page
    .getByRole('button', { name: 'Collapse Sheets', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Collapse Inspector', exact: true })
    .click();
  await canvas.focus();
  await moveTo(page, 180, 100);
  const left = await page
    .getByRole('button', { name: 'Pin Sheets', exact: true })
    .boundingBox();
  const right = await page
    .getByRole('button', { name: 'Pin Inspector', exact: true })
    .boundingBox();
  const undo = await page
    .getByRole('button', { name: 'Undo', exact: true })
    .boundingBox();
  const counter = await selected.boundingBox();
  if (!left || !right || !undo || !counter)
    throw new Error('Missing toolbar controls');
  expect(undo.x).toBeGreaterThanOrEqual(left.x + left.width + 4);
  expect(counter.x + counter.width).toBeLessThanOrEqual(right.x - 4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Redo', exact: true }),
  ).toBeEnabled();
  await canvas.focus();
  await moveTo(page, 180, 100);
}
