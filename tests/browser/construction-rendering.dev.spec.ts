import { expect, test } from '@playwright/test';
import type { ConstructionRenderingHarness } from './construction-rendering-harness';
import { captureErrors } from './wingman';

declare global {
  interface Window {
    constructionRendering: ConstructionRenderingHarness;
  }
}

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
