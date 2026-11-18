import { readFile } from 'node:fs/promises';
import type { Project } from '../../src/core/types';
import { expect, test } from '@playwright/test';
import type { SheetAnnotation } from '../../src/core/annotations';
import { cli, startWingmanProject } from './wingman';
import { drawWall, pagePoint } from './takeoff';

test('permanent annotations draw, edit, hide and render independently of takeoff selection', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 950 });
  await startWingmanProject(page, true);
  await drawWall(page);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const rail = page.getByRole('button', { name: 'Annotations (A)' });
  const sheetId = await canvas.getAttribute('data-sheet-id');
  const records = async () =>
    (await cli<SheetAnnotation[]>(page, 'annotation.list', { sheetId }))
      .response.data;
  const choose = async (name: string) => {
    await rail.click();
    await page
      .getByRole('group', { name: 'Annotation tools' })
      .getByRole('button', { name, exact: true })
      .click();
  };
  const drag = async (...points: [number, number][]) => {
    const camera = await canvas.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return {
        x: box.x + Number(el.getAttribute('data-camera-x')),
        y: box.y + Number(el.getAttribute('data-camera-y')),
        zoom: Number(el.getAttribute('data-camera-zoom')),
      };
    });
    for (const [i, p] of points.entries()) {
      await page.mouse.move(
        camera.x + p[0] * camera.zoom,
        camera.y + p[1] * camera.zoom,
        { steps: i ? 4 : 1 },
      );
      if (i === 0) await page.mouse.down();
    }
    await page.mouse.up();
  };
  for (const [name, start, end] of [
    ['Arrow', [125, 100], [155, 143]],
    ['Line', [200, 144], [290, 144]],
    ['Ellipse', [355, 165], [427, 204]],
    ['Rectangle', [105, 211], [215, 248]],
    ['Revision cloud', [285, 245], [385, 289]],
  ] as const) {
    await choose(name);
    await drag([...start], [...end]);
    await expect
      .poll(async () => (await records()).at(-1)?.kind)
      .toBe(name.toLowerCase().replace(' ', '-'));
  }
  await choose('Text');
  await pagePoint(page, 150, 70);
  await page
    .getByLabel('Annotation text', { exact: true })
    .fill('Confirm top of wall');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => (await records()).at(-1)?.text)
    .toBe('Confirm top of wall');
  await canvas.press('Enter');
  await page
    .getByLabel('Annotation text', { exact: true })
    .fill('Verify head detail');
  await page.getByLabel('Annotation text', { exact: true }).press('Enter');
  await expect
    .poll(async () => (await records()).at(-1)?.text)
    .toBe('Verify head detail');
  await choose('Freehand');
  await drag([125, 290], [141, 282], [155, 302], [174, 286], [193, 294]);
  await expect.poll(async () => (await records()).length).toBe(7);
  expect((await records()).every((a) => a.author === 'user')).toBe(true);
  await pagePoint(page, 105, 225);
  await drag([105, 211], [97, 202]);
  await expect
    .poll(
      async () =>
        (await records()).find((a) => a.kind === 'rectangle')?.points[0]?.x,
    )
    .toBeCloseTo(97, 0);
  await page.mouse.move(8, 8);
  await page.screenshot({ path: info.outputPath('annotation-selected.png') });
  await canvas.press('v');
  await pagePoint(page, 240, 144);
  await expect(page.locator('.workspace-toolbar .muted')).toHaveText(
    '1 selected',
  );
  await canvas.press('Escape');
  await page.mouse.move(8, 8);
  await page.screenshot({ path: info.outputPath('all-annotations.png') });
  const rendered = page.waitForEvent('download');
  expect(
    (
      await cli(page, 'sheet.render', {
        sheetId,
        maxDimension: 1224,
        path: 'sheet.png',
      })
    ).exitCode,
  ).toBe(0);
  await (await rendered).saveAs(info.outputPath('cli-sheet-render.png'));
  const raspberryPixels = () =>
    canvas.evaluate((el) => {
      const surface = el as HTMLCanvasElement;
      const context = surface.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      const bytes = context.getImageData(
        0,
        0,
        surface.width,
        surface.height,
      ).data;
      let count = 0;
      for (let i = 0; i < bytes.length; i += 4)
        if (bytes[i] === 158 && bytes[i + 1] === 23 && bytes[i + 2] === 77)
          count++;
      return count;
    });
  await expect.poll(raspberryPixels).toBeGreaterThan(100);
  async function cropHasAnnotation() {
    const downloaded = page.waitForEvent('download');
    const result = await cli(page, 'sheet.render', {
      sheetId,
      bounds: { x: 195, y: 135, width: 100, height: 30 },
      maxDimension: 400,
      path: 'detail.png',
    });
    expect(result.exitCode).toBe(0);
    const path = await (await downloaded).path();
    if (!path) throw new Error('Missing rendered crop');
    const encoded = (await readFile(path)).toString('base64');
    return page.evaluate(async (data) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + data;
      await img.decode();
      const crop = document.createElement('canvas');
      crop.width = img.width;
      crop.height = img.height;
      const ctx = crop.getContext('2d');
      if (!ctx) throw new Error('Missing crop context');
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, crop.width, crop.height).data;
      return pixels.some(
        (v, i) =>
          i % 4 === 0 &&
          v === 158 &&
          pixels[i + 1] === 23 &&
          pixels[i + 2] === 77,
      );
    }, encoded);
  }
  expect(await cropHasAnnotation()).toBe(true);
  await page.getByLabel('Show annotations').uncheck();
  expect(await cropHasAnnotation()).toBe(false);
  await expect.poll(raspberryPixels).toBe(0);
  await page.screenshot({ path: info.outputPath('annotations-hidden.png') });
  await canvas.press('a');
  await drag([300, 160], [330, 180]);
  expect(await records()).toHaveLength(7);
  await page.getByLabel('Show annotations').check();
  // A resumes the last explicitly chosen shape, even after selecting a takeoff.
  await drag([300, 160], [330, 180]);
  await expect.poll(async () => (await records()).length).toBe(8);
  await canvas.press('Delete');
  await expect.poll(async () => (await records()).length).toBe(7);
  await expect(page.locator('.workspace-toolbar .muted')).toHaveText(
    '0 selected',
  );
  // The nearby arrow endpoint at (125,100) must not snap a count marker.
  await canvas.press('c');
  await pagePoint(page, 129, 103);
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect
    .poll(async () => {
      const project = (await cli<Project>(page, 'project.inspect')).response
        .data;
      return Object.values(project.geometries).find((g) => g.kind === 'count')
        ?.points[0]?.x;
    })
    .toBeCloseTo(129, 0);
});
