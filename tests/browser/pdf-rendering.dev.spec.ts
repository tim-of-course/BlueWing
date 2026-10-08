import { expect, test } from '@playwright/test';
import type { PdfRenderingHarness } from './pdf-rendering-harness';
import { captureErrors } from './wingman';

declare global {
  interface Window {
    pdfRendering: PdfRenderingHarness;
  }
}

for (const cancel of [false, true]) {
  test(`background PDF pauses for a foreground render and ${cancel ? 'cancels' : 'resumes'}`, async ({
    page,
  }) => {
    const errors = await captureErrors(page);
    await page.goto('/tests/browser/pdf-rendering-harness.html');
    const result = await page.evaluate(
      (stop) => window.pdfRendering.backgroundPause(stop),
      cancel,
    );
    expect(result.backgroundStillPaused).toBe(true);
    expect(result.foreground.left).toEqual([255, 0, 0, 255]);
    expect(result.foreground.right).toEqual([0, 0, 255, 255]);
    expect(result.result).toEqual(cancel ? 'cancelled' : result.foreground);
    expect(errors).toEqual([]);
  });
}

test('native PDF workers return display pixels before PNG encoding without UI canvas work', async ({
  page,
}, info) => {
  const errors = await captureErrors(page);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() => window.pdfRendering.yielding());
  await info.attach('pdf-rendering-scheduler', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(workers.some((url) => url.includes('render-worker'))).toBe(true);
  expect(workers.some((url) => url.includes('parser-bridge'))).toBe(true);
  expect(result.inputDuringRender).toBe(true);
  expect(result.displayBeforeEncoding).toBe(true);
  expect(result.uiCalls).toEqual({
    fill: 0,
    text: 0,
    image: 0,
    read: 0,
    write: 0,
    encode: 0,
    offscreenContext: 0,
    offscreenEncode: 0,
  });
  expect(result.width).toBe(128);
  expect(result.height).toBe(128);
  expect(result.left).toEqual([255, 0, 0, 255]);
  expect(result.right).toEqual([0, 0, 255, 255]);
  expect(errors).toEqual([]);
});

for (const cancel of [false, true]) {
  test(`a foreground page preempts a held background page, which ${cancel ? 'cancels' : 'restarts'} and remains reusable`, async ({
    page,
  }) => {
    const errors = await captureErrors(page);
    await page.goto('/tests/browser/pdf-rendering-harness.html');
    const result = await page.evaluate(
      (stop) => window.pdfRendering.preemption(stop),
      cancel,
    );
    expect(result.pausedWhileContentHeld).toBe(true);
    expect(result.foreground).toEqual({
      width: 64,
      height: 64,
      left: [255, 0, 0, 255],
      right: [0, 0, 255, 255],
    });
    expect(result.result).toEqual(cancel ? 'cancelled' : result.foreground);
    expect(result.reused).toEqual(result.foreground);
    expect(result.opens).toBe(cancel ? 1 : 0);
    expect(errors).toEqual([]);
  });
}

for (const action of ['release', 'clear'] as const) {
  test(`PDF ${action} settles every paused render RPC and allows the asset to reload`, async ({
    page,
  }) => {
    const errors = await captureErrors(page);
    await page.goto('/tests/browser/pdf-rendering-harness.html');
    const result = await page.evaluate(
      (method) => window.pdfRendering.cancellation(method),
      action,
    );
    expect(result.settled).toEqual(['cancelled', 'cancelled']);
    expect(result.reads).toBe(1);
    expect(result.reloaded.left).toEqual([255, 0, 0, 255]);
    expect(result.reloaded.right).toEqual([0, 0, 255, 255]);
    expect(errors).toEqual([]);
  });

  test(`PDF ${action} rejects outstanding encoding while transferred display bitmaps remain usable`, async ({
    page,
  }) => {
    const errors = await captureErrors(page);
    await page.goto('/tests/browser/pdf-rendering-harness.html');
    const result = await page.evaluate(
      (method) => window.pdfRendering.cancelEncoding(method),
      action,
    );
    expect(result.outcome).toBe('cancelled');
    expect(result.retained).toEqual({
      width: 3300,
      height: 33,
      left: [255, 0, 0, 255],
      right: [0, 0, 255, 255],
    });
    expect(result.preview).toEqual({
      width: 640,
      height: 7,
      left: [255, 0, 0, 255],
      right: [0, 0, 255, 255],
    });
    expect(result.reopened.left).toEqual([255, 0, 0, 255]);
    expect(result.reopened.right).toEqual([0, 0, 255, 255]);
    expect(errors).toEqual([]);
  });
}

test('aborting PDF loading settles before the source responds and allows reopening', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() => window.pdfRendering.abortLoading());
  expect(result.outcome).toBe('Superseded sheet');
  expect(result.opens).toBe(2);
  expect(result.reopened.left).toEqual([255, 0, 0, 255]);
  expect(result.reopened.right).toEqual([0, 0, 255, 255]);
  expect(errors).toEqual([]);
});

test('one full PDF raster delivers the display bitmap, a 640-pixel preview and both encoded PNGs', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() => window.pdfRendering.fullPreview());
  expect(result.full).toEqual({
    width: 3300,
    height: 33,
    left: [255, 0, 0, 255],
    right: [0, 0, 255, 255],
  });
  expect(result.preview).toEqual({
    width: 640,
    height: 7,
    left: [255, 0, 0, 255],
    right: [0, 0, 255, 255],
  });
  expect(result.decodedFull).toEqual(result.full);
  expect(result.decodedPreview).toEqual(result.preview);
  for (const header of result.headers)
    expect(header).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(errors).toEqual([]);
});

test('PDF cache keeps two recent idle documents and pins active operations', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() => window.pdfRendering.idleCache());
  expect(result.cached).toEqual({ pinned: 1, a: 1, b: 1, c: 1 });
  expect(result.opens).toEqual({ pinned: 1, a: 2, b: 1, c: 1 });
  expect(result.pinned.left).toEqual([255, 0, 0, 255]);
  expect(result.pinned.right).toEqual([0, 0, 255, 255]);
  expect(errors).toEqual([]);
});

test('range-backed PDFs read needed objects and reopen from the persistent source', async ({
  page,
}, info) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() =>
    window.pdfRendering.rangedRendering(),
  );
  await info.attach('pdf-range-reads', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.length).toBeGreaterThan(8 * 1024 * 1024);
  expect(result.initialReads.length).toBeGreaterThan(0);
  // The unused middle ranges dominate this fixture; no speed or heap threshold.
  expect(
    result.initialReads.reduce((sum, read) => sum + read.length, 0),
  ).toBeLessThan(result.length / 4);
  expect(result.totalReads).toBeGreaterThan(result.initialReads.length);
  expect(result.opens).toBe(1);
  expect(result.first.left).toEqual([255, 0, 0, 255]);
  expect(result.first.right).toEqual([0, 0, 255, 255]);
  expect(result.reopened).toEqual(result.first);
  expect(errors).toEqual([]);
});

test('a page range read failure rejects rendering and permits retry', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() => window.pdfRendering.rangeFailure());
  expect(result.failures).toBeGreaterThan(0);
  expect(result.failure).toBeTruthy();
  expect(result.reopenedSources).toBe(1);
  expect(result.recovered.left).toEqual([255, 0, 0, 255]);
  expect(result.recovered.right).toEqual([0, 0, 255, 255]);
  expect(errors).toEqual([]);
});

test('PDF clear finishes while rendering waits for page content and ignores late delivery', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() =>
    window.pdfRendering.cancelRenderRange(),
  );
  expect(result.outcome).toBe('cancelled');
  expect(result.reopened.left).toEqual([255, 0, 0, 255]);
  expect(result.reopened.right).toEqual([0, 0, 255, 255]);
  expect(errors).toEqual([]);
});

for (const action of ['release', 'clear'] as const) {
  test(`PDF ${action} cancels a pending range read and ignores its late delivery`, async ({
    page,
  }) => {
    const errors = await captureErrors(page);
    await page.goto('/tests/browser/pdf-rendering-harness.html');
    const result = await page.evaluate(
      (method) => window.pdfRendering.cancelRange(method),
      action,
    );
    expect(result.outcome).toBe('cancelled');
    expect(result.reopened.left).toEqual([255, 0, 0, 255]);
    expect(result.reopened.right).toEqual([0, 0, 255, 255]);
    expect(errors).toEqual([]);
  });
}

test('sheet naming returns independent suggestions and remains usable after errors, release and clear', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() => window.pdfRendering.nameCache());
  expect(result.duplicate.status).toBe('suggested');
  expect(result.unchanged).toEqual(result.duplicate);
  expect(result.recovered).toEqual(result.duplicate);
  expect(result.released).toEqual(result.duplicate);
  expect(result.cleared).toEqual(result.duplicate);
  expect(result.sharedOpens).toBe(0);
  expect(result.opens).toBe(2);
  expect(result.failures).toHaveLength(2);
  for (const failure of result.failures) expect(failure).toBeTruthy();
  expect(errors).toEqual([]);
});

for (const fixture of [
  'transfer',
  'transparency',
  'font',
  'rotation-crop',
  'view-annotation',
] as const) {
  test(`${fixture} worker pixels and crops match the official PDF.js 6.4.299 DOM renderer`, async ({
    page,
  }, info) => {
    const errors = await captureErrors(page);
    await page.goto('/tests/browser/pdf-rendering-harness.html');
    const result = await page.evaluate(
      (kind) => window.pdfRendering.fidelity(kind),
      fixture,
    );
    await info.attach(`pdf-${fixture}-parity`, {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });
    expect(result.version).toBe('6.4.299');
    expect(result.results).toHaveLength(2);
    for (const image of result.results) {
      expect(image.width).toBe(image.expectedWidth);
      expect(image.height).toBe(image.expectedHeight);
      // Allow small SVG/CPU rounding differences, while a missing transfer map,
      // mask or font changes thousands of pixels and fails both limits.
      expect(image.mean).toBeLessThanOrEqual(0.5);
      expect(image.differentFraction).toBeLessThanOrEqual(0.005);
      expect(image.nonWhite).toBeGreaterThan(100);
      expect(image.png.mean).toBe(0);
      expect(image.png.differentFraction).toBe(0);
    }
    if (fixture === 'font')
      expect(result.results[0]?.dark).toBeGreaterThan(100);
    if (fixture === 'view-annotation') {
      expect(result.results[0]?.samples.left).toEqual([255, 0, 0, 255]);
      expect(result.results[0]?.samples.right).toEqual([0, 0, 255, 255]);
      expect(result.printSamples?.left).toEqual([0, 0, 255, 255]);
      expect(result.printSamples?.right).toEqual([0, 0, 255, 255]);
    }
    if (fixture === 'rotation-crop') {
      expect(result.sheet.width).toBe(40);
      expect(result.sheet.height).toBe(80);
      expect(result.sheet.rotation).toBe(90);
      expect(result.sheet.pdfToPage).toEqual([0, 1, 1, 0, -20, -10]);
    }
    expect(errors).toEqual([]);
  });
}
