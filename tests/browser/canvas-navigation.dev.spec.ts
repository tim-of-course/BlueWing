import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator } from '@playwright/test';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { pagePoint, startProject } from './takeoff';

async function view(canvas: Locator) {
  return canvas.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      x: Number(element.getAttribute('data-camera-x')),
      y: Number(element.getAttribute('data-camera-y')),
      zoom: Number(element.getAttribute('data-camera-zoom')),
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      top: bounds.top,
    };
  });
}

test('wheel and pinch anchor the cursor; pan and resize preserve the drawing view', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startProject(page);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      const initial = await view(canvas);
      const cursor = {
        x: Math.round(initial.width * 0.6),
        y: Math.round(initial.height * 0.6),
      };
      await page.mouse.move(initial.left + cursor.x, initial.top + cursor.y);
      await page.mouse.wheel(0, -120);
      await expect
        .poll(async () => (await view(canvas)).zoom)
        .toBeGreaterThan(initial.zoom);
      const zoomed = await view(canvas);
      expect((cursor.x - zoomed.x) / zoomed.zoom).toBeCloseTo(
        (cursor.x - initial.x) / initial.zoom,
        4,
      );
      expect((cursor.y - zoomed.y) / zoomed.zoom).toBeCloseTo(
        (cursor.y - initial.y) / initial.zoom,
        4,
      );
      await canvas.dispatchEvent('wheel', {
        deltaY: -10,
        ctrlKey: true,
        clientX: initial.left + cursor.x,
        clientY: initial.top + cursor.y,
      });
      await expect
        .poll(async () => (await view(canvas)).zoom)
        .toBeGreaterThan(zoomed.zoom);
      const pinched = await view(canvas);
      expect((cursor.x - pinched.x) / pinched.zoom).toBeCloseTo(
        (cursor.x - initial.x) / initial.zoom,
        4,
      );
      expect((cursor.y - pinched.y) / pinched.zoom).toBeCloseTo(
        (cursor.y - initial.y) / initial.zoom,
        4,
      );

      await canvas.focus();
      await page.keyboard.down('Space');
      await page.mouse.down();
      await page.mouse.move(
        initial.left + cursor.x + 40,
        initial.top + cursor.y + 30,
      );
      await page.mouse.up();
      await page.keyboard.up('Space');
      await expect
        .poll(async () => (await view(canvas)).x)
        .toBeCloseTo(pinched.x + 40, 4);
      const panned = await view(canvas);
      expect(panned.y).toBeCloseTo(pinched.y + 30, 4);
      expect(panned.zoom).toBe(pinched.zoom);

      const center = {
        x: (panned.width / 2 - panned.x) / panned.zoom,
        y: (panned.height / 2 - panned.y) / panned.zoom,
      };
      await page
        .getByRole('button', { name: 'Collapse Sheets', exact: true })
        .click();
      await expect
        .poll(async () => (await view(canvas)).width)
        .toBeGreaterThan(panned.width);
      await expect
        .poll(async () => {
          const current = await view(canvas);
          return (current.width / 2 - current.x) / current.zoom;
        })
        .toBeCloseTo(center.x, 4);
      const resized = await view(canvas);
      expect(resized.zoom).toBe(panned.zoom);
      expect((resized.height / 2 - resized.y) / resized.zoom).toBeCloseTo(
        center.y,
        4,
      );
      await page
        .getByRole('button', { name: 'Pin Sheets', exact: true })
        .click();
      await expect
        .poll(async () => (await view(canvas)).width)
        .toBe(initial.width);
      await page.getByRole('button', { name: 'Fit', exact: true }).click();
      await expect
        .poll(async () => (await view(canvas)).zoom)
        .toBeCloseTo(initial.zoom, 4);

      await page.getByRole('button', { name: 'Path (L)', exact: true }).click();
      await pagePoint(page, 72, 144);
      await expect(
        page.getByText('1 points · Enter to finish', { exact: true }),
      ).toBeVisible();
      const beforePan = await view(canvas);
      await page.mouse.move(
        beforePan.left + beforePan.width / 2,
        beforePan.top + beforePan.height / 2,
      );
      await page.mouse.down({ button: 'middle' });
      await page.mouse.move(
        beforePan.left + beforePan.width / 2 + 25,
        beforePan.top + beforePan.height / 2 + 20,
      );
      await page.mouse.up({ button: 'middle' });
      await expect
        .poll(async () => (await view(canvas)).x)
        .toBeCloseTo(beforePan.x + 25, 4);
      await expect(
        page.getByText('1 points · Enter to finish', { exact: true }),
      ).toBeVisible();
      await pagePoint(page, 360, 144);
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('button', { name: 'Finish', exact: true }),
      ).toBeHidden();
      await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
      const drawingView = await view(canvas);
      await page
        .getByRole('button', { name: 'Quantities', exact: true })
        .click();
      await expect(canvas).toBeHidden();
      await page.keyboard.press('Escape');
      await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Drawing', exact: true }).click();
      await expect(canvas).toBeVisible();
      await expect
        .poll(async () => (await view(canvas)).zoom)
        .toBe(drawingView.zoom);
      await canvas.focus();
      await page.keyboard.press('Escape');
      await expect(page.getByText('0 selected', { exact: true })).toBeVisible();
      await page
        .getByRole('button', { name: 'Select (V)', exact: true })
        .click();
      const selectionView = await view(canvas);
      await page.mouse.move(
        selectionView.left + selectionView.x + 150 * selectionView.zoom,
        selectionView.top + selectionView.y + 130 * selectionView.zoom,
      );
      await page.mouse.down();
      await page.mouse.move(
        selectionView.left + selectionView.x + 200 * selectionView.zoom,
        selectionView.top + selectionView.y + 155 * selectionView.zoom,
      );
      await page.mouse.up();
      // This box crosses the path without containing either endpoint.
      await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
      await page
        .getByRole('button', { name: 'Fit selection', exact: true })
        .click();
      await expect
        .poll(async () => (await view(canvas)).zoom)
        .not.toBe(selectionView.zoom);
      await expect(
        page.getByRole('button', { name: 'Finish', exact: true }),
      ).toBeHidden();
    },
    { scenario: 'canvas-navigation-and-drawing' },
  );
  const path = testInfo.outputPath('solid-diagnostics.json');
  await writeFile(path, JSON.stringify(artifact, null, 2));
  await testInfo.attach('solid-diagnostics', {
    path,
    contentType: 'application/json',
  });
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});

test('returning to a sheet restores its camera', async ({ page }) => {
  await startProject(page);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const firstId = await canvas.getAttribute('data-sheet-id');
  if (!firstId) throw new Error('Imported sheet was not selected');
  const initial = await view(canvas);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect
    .poll(async () => (await view(canvas)).zoom)
    .toBeGreaterThan(initial.zoom);
  const firstView = await view(canvas);
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
  await (await choosing).setFiles('tests/fixtures/assessment-plan.pdf');
  await expect(canvas).not.toHaveAttribute('data-sheet-id', firstId);
  await expect(page.getByText('Rendering PDF…', { exact: true })).toBeHidden();
  await page.locator('.sheet-row').first().click();
  await expect(canvas).toHaveAttribute('data-sheet-id', firstId);
  await expect.poll(async () => (await view(canvas)).zoom).toBe(firstView.zoom);
  const restored = await view(canvas);
  expect(restored.x).toBeCloseTo(firstView.x, 4);
  expect(restored.y).toBeCloseTo(firstView.y, 4);
});
