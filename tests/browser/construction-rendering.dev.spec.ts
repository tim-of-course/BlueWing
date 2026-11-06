import { expect, test } from '@playwright/test';
import type { ConstructionRenderingHarness } from './construction-rendering-harness';
import { captureErrors } from './wingman';

declare global {
  interface Window {
    constructionRendering: ConstructionRenderingHarness;
  }
}

test('shared category strokes and uncategorized hatch remain legible at two zooms', async ({
  page,
}) => {
  await page.goto('/tests/browser/construction-rendering-harness.html');
  for (const zoom of [1, 2]) {
    const results = await page.evaluate(
      (scale) => ({
        shared: window.constructionRendering.categoryStrokes(scale, [
          '#0077CC',
          '#C023A0',
        ]),
        framing: window.constructionRendering.categoryStrokes(scale, [
          '#0077CC',
        ]),
        drywall: window.constructionRendering.categoryStrokes(scale, [
          '#C023A0',
        ]),
        unclassified: window.constructionRendering.categoryStrokes(scale, []),
      }),
      zoom,
    );
    expect(results.shared.blue).toBeGreaterThan(100);
    expect(results.shared.magenta).toBeGreaterThan(100);
    expect(results.framing.blue).toBeGreaterThan(100);
    expect(results.framing.magenta).toBe(0);
    expect(results.drywall.magenta).toBeGreaterThan(100);
    expect(results.drywall.blue).toBe(0);
    expect(results.unclassified.hatch).toBeGreaterThan(10);
    expect(results.unclassified.pale).toBeGreaterThan(100);
  }
});

test('deduction dashes preserve parallel category colors for paths, areas, counts and selections', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/construction-rendering-harness.html');
  const draft = await page.evaluate(() => ({
    solid: window.constructionRendering.categoryStrokes(
      1,
      ['#0077CC'],
      'solid',
    ),
    dashed: window.constructionRendering.categoryStrokes(
      1,
      ['#0077CC'],
      'dashed',
    ),
  }));
  expect(draft.dashed.blue).toBeLessThan(draft.solid.blue * 0.9);
  for (const zoom of [1, 2])
    for (const kind of ['path', 'area', 'count'] as const)
      for (const selected of [false, true])
        for (const uncategorized of [false, true]) {
          const result = await page.evaluate(
            ({ zoom, kind, selected, uncategorized }) =>
              window.constructionRendering.categoryDeductionStrokes(
                zoom,
                kind,
                selected,
                uncategorized,
              ),
            { zoom, kind, selected, uncategorized },
          );
          expect(result.deduction?.ink).toBeGreaterThan(5);
          expect(result.deduction?.ink).toBeLessThan(
            (result.positive?.ink ?? 0) * 0.98,
          );
          if (!uncategorized) {
            expect(result.deduction?.blue).toBeGreaterThan(5);
            expect(result.deduction?.magenta).toBeGreaterThan(5);
            expect(result.deduction?.blue).toBeLessThan(
              (result.positive?.blue ?? 0) * 0.98,
            );
            expect(result.deduction?.magenta).toBeLessThan(
              (result.positive?.magenta ?? 0) * 0.98,
            );
          }
          expect(result.deduction?.red).toBe(0);
          expect(result.positive?.red).toBe(0);
        }
  expect(errors).toEqual([]);
});

test('middle-drag pans and right-drag zooms the 3D view', async ({ page }) => {
  await page.goto('/tests/browser/construction-rendering-harness.html');
  await page.evaluate(() => {
    window.constructionRendering.setupNavigation();
  });
  const canvas = page.getByLabel('Construction rendering fixture');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('3D canvas is not visible');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const before = await page.evaluate(() =>
    window.constructionRendering.readNavigation(),
  );
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(x + 50, y + 30);
  await page.mouse.up({ button: 'middle' });
  const panned = await page.evaluate(() =>
    window.constructionRendering.readNavigation(),
  );
  expect(panned.target).not.toEqual(before.target);
  expect(panned.zoom).toBe(before.zoom);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(x, y + 50);
  await page.mouse.up({ button: 'right' });
  const zoomed = await page.evaluate(() =>
    window.constructionRendering.readNavigation(),
  );
  expect(zoomed.zoom).not.toBe(panned.zoom);
  expect(zoomed.target).toEqual(panned.target);
});

test('crossing members occlude and pick at pixel depth from both sides, including exports', async ({
  page,
}, testInfo) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/construction-rendering-harness.html');
  const results = await page.evaluate(() =>
    window.constructionRendering.crossing(),
  );
  await testInfo.attach('occlusion-results', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  for (const [index, result] of results.entries()) {
    expect(result.overlapPixels).toBeGreaterThan(20);
    expect(result.wrongPixels).toBe(0);
    expect(result.picked?.id).toBe(index === 0 ? 'tall-stud' : 'ceiling-tee');
    expect(result.picked?.geometryId).toBe(
      index === 0 ? 'wall-trace' : 'ceiling-trace',
    );
    expect(result.snapshotWidth).toBe(600);
    expect(result.snapshotHeight).toBe(600);
    expect(result.snapshotMismatches).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('concave finishes preserve openings and solid, framing, and X-ray selection match visibility', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/construction-rendering-harness.html');
  const { concave, modes } = await page.evaluate(() =>
    window.constructionRendering.finishes(),
  );
  expect(concave.notchDifference).toBe(0);
  expect(concave.armDifference).toBeGreaterThan(15);
  expect(concave.notchPick).toBeNull();
  expect(concave.armPick?.id).toBe('concave-finish');
  for (const mode of modes) {
    const solid = mode.displayMode === 'solid';
    expect(mode.lowerPick?.id).toBe(solid ? 'concave-finish' : 'tall-stud');
    expect(mode.notchPick?.id).toBe('tall-stud');
    expect(
      solid ? mode.lowerDifferenceFromSurface : mode.lowerDifferenceFromStud,
    ).toBe(0);
  }
  expect(errors).toEqual([]);
});

test('large models keep every member with bounded draw calls and release replaced GPU resources', async ({
  page,
}, testInfo) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/construction-rendering-harness.html');
  const result = await page.evaluate(() =>
    window.constructionRendering.batching(),
  );
  await testInfo.attach('rendering-resources', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.sceneCount).toBe(6_000);
  expect(result.omitted).toBe(0);
  expect(result.full.objects).toBe(6_000);
  expect(result.full.triangles).toBeGreaterThanOrEqual(6_000 * 12);
  expect(result.full.drawCalls).toBeLessThan(10);
  expect(result.full.drawCalls).toBe(result.baseline.drawCalls);
  expect(result.full.geometries).toBe(result.baseline.geometries);
  for (const stats of result.replacements) {
    expect(stats.geometries).toBe(result.baseline.geometries);
    expect(stats.textures).toBe(result.baseline.textures);
    expect(stats.drawCalls).toBe(result.baseline.drawCalls);
  }
  expect(result.highResolution.width).toBe(640);
  expect(result.highResolution.height).toBe(480);
  expect(result.disposed.geometries).toBe(0);
  expect(errors).toEqual([]);
});

test('app screenshot capture includes an idle WebGL construction view', async ({
  page,
}, testInfo) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/construction-rendering-harness.html');
  const result = await page.evaluate(() =>
    window.constructionRendering.screenshotCapture(),
  );
  await testInfo.attach('captured-construction-view', {
    body: Buffer.from(result.image.split(',')[1] ?? '', 'base64'),
    contentType: 'image/png',
  });
  expect(result.checkedPixels).toBeGreaterThan(500);
  expect(result.wrongPixels).toBe(0);
  expect(errors).toEqual([]);
});

test('plan plane is correctly oriented, keeps construction selectable, and releases its texture', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/construction-rendering-harness.html');
  const result = await page.evaluate(() =>
    window.constructionRendering.planPlane(),
  );
  const expected = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
  ];
  for (const [index, color] of result.colors.entries())
    for (const [channel, value] of color.entries())
      expect(Math.abs(value - (expected[index]?.[channel] ?? 0))).toBeLessThan(
        5,
      );
  expect(result.picked?.id).toBe('tall-stud');
  expect(result.withPlan.textures).toBe(result.baseline.textures + 1);
  expect(result.removed.textures).toBe(result.baseline.textures);
  expect(result.removed.geometries).toBe(result.baseline.geometries);
  expect(errors).toEqual([]);
});
