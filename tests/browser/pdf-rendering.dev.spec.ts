import { expect, test } from '@playwright/test';
import type { PdfRenderingHarness } from './pdf-rendering-harness';
import { captureErrors } from './wingman';

declare global {
  interface Window {
    pdfRendering: PdfRenderingHarness;
  }
}

test('exports above the output limit keep the complete plan and aligned overlays', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() => window.pdfRendering.cappedExport());
  expect(result.metadata.width).toBe(4096);
  expect(result.metadata.height).toBe(4096);
  expect(result.metadata.pageToPixel).toEqual([64, 0, 0, 64, -0, -0]);
  expect(result.left).toEqual([255, 0, 0, 255]);
  expect(result.right).toEqual([0, 0, 255, 255]);
  expect(result.overlay).toEqual([0, 255, 0, 255]);
  expect(errors).toEqual([]);
});

test('a 24 by 36-inch plan keeps one 200 DPI image with neutral antialiased text and colored markup', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() =>
    window.pdfRendering.singleImageClarity(),
  );
  expect(result.dimensions).toEqual({ width: 4800, height: 7200 });
  expect(result.renders).toBe(1);
  expect(result.annotation).toEqual([255, 0, 0, 255]);
  for (const view of [...result.views, result.reloaded]) {
    expect(view.tinted).toBe(0);
    expect(view.ink).toBeGreaterThan(0);
    expect(view.gray).toBeGreaterThan(0);
  }
  expect(result.reloaded).toEqual(result.views[2]);
  expect(errors).toEqual([]);
});

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
  expect(workers.filter((url) => url.includes('render-worker'))).toHaveLength(
    1,
  );
  expect(workers.some((url) => url.includes('parser-bridge'))).toBe(false);
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
  expect(result.closed.sort()).toEqual([1, 2]);
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

test('linearized PDFs import all ranged pages with the correct scale and rotation', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() =>
    window.pdfRendering.linearizedImport(),
  );
  expect(result.sheets).toEqual([
    { width: 128, height: 96, rotation: 0 },
    { width: 96, height: 128, rotation: 90 },
    { width: 256, height: 192, rotation: 0 },
  ]);
  expect(result.colors[0]?.left).toEqual([255, 0, 0, 255]);
  expect(result.colors[1]?.left).toEqual([0, 0, 255, 255]);
  expect(result.colors[2]?.left).toEqual([0, 255, 0, 255]);
  expect(result.reopened).toEqual(result.colors[1]);
  expect(errors).toEqual([]);
});

test('range-backed PDFs open a later nested page before enumeration and after reopening', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() =>
    window.pdfRendering.nestedPageTree(),
  );
  expect(result.actual.left).toEqual([0, 0, 255, 255]);
  expect(result.actual.right).toEqual([0, 0, 255, 255]);
  expect(result.reopened).toEqual(result.actual);
  expect(result.first.left).toEqual([255, 0, 0, 255]);
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

test('range-backed PDFs preserve hidden layers even when settings are outside page availability hints', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() => window.pdfRendering.hiddenLayers());
  expect(result.actual).toEqual(result.expected);
  expect(result.reopened).toEqual(result.expected);
  expect(result.actual.left).toEqual([0, 0, 255, 255]);
  expect(result.actual.right).toEqual([0, 0, 255, 255]);
  expect(errors).toEqual([]);
});

for (const kind of ['missing', 'empty', 'disjoint'] as const) {
  test(`${kind} PDF boxes retain the previous media fallback through reopening`, async ({
    page,
  }) => {
    const errors = await captureErrors(page);
    await page.goto('/tests/browser/pdf-rendering-harness.html');
    const result = await page.evaluate(
      (value) => window.pdfRendering.fallbackBoxes(value),
      kind,
    );
    expect([result.sheet.width, result.sheet.height]).toEqual(
      kind === 'disjoint' ? [64, 64] : [612, 792],
    );
    expect(result.actual.left).toEqual([0, 0, 255, 255]);
    expect(result.actual.right).toEqual([0, 0, 255, 255]);
    expect(result.reopened).toEqual(result.actual);
    expect(errors).toEqual([]);
  });
}

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

for (const [rotation, userUnit] of [
  [0, 1],
  [180, 1],
  [270, 1],
  [90, 2.5],
  [-90, 2.5],
  [450, 1],
] as const) {
  test(`PDF rotation ${String(rotation)} and UserUnit ${String(userUnit)} preserve physical coordinates and crops`, async ({
    page,
  }) => {
    const errors = await captureErrors(page);
    await page.goto('/tests/browser/pdf-rendering-harness.html');
    const result = await page.evaluate(
      ([angle, unit]) =>
        window.pdfRendering.fidelity('rotation-crop', angle, unit),
      [rotation, userUnit] as const,
    );
    const normalized = ((rotation % 360) + 360) % 360;
    const swaps = normalized === 90 || normalized === 270;
    expect(result.sheet.width).toBe((swaps ? 40 : 80) * userUnit);
    expect(result.sheet.height).toBe((swaps ? 80 : 40) * userUnit);
    expect(result.sheet.rotation).toBe(normalized);
    const transforms: Record<number, number[]> = {
      0: [1, 0, 0, -1, -10, 60],
      90: [0, 1, 1, 0, -20, -10],
      180: [-1, 0, 0, 1, 90, -20],
      270: [0, -1, -1, 0, 60, 90],
    };
    expect(result.sheet.pdfToPage).toEqual(
      transforms[normalized]?.map((value) => value * userUnit),
    );
    for (const image of result.results) {
      expect(image.mean).toBeLessThanOrEqual(0.5);
      expect(image.differentFraction).toBeLessThanOrEqual(0.005);
      expect(image.png.mean).toBe(0);
    }
    expect(errors).toEqual([]);
  });
}

for (const fixture of [
  'transfer',
  'transparency',
  'font',
  'rotation-crop',
  'view-annotation',
  'widget',
] as const) {
  test(`${fixture} PDFium pixels and crops preserve content against the independent PDF.js reference`, async ({
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
    expect(
      result.workerEvents.filter((name) => name === 'pdf.worker.raster'),
    ).toHaveLength(4);
    expect(
      result.workerEvents.filter((name) => name === 'pdf.worker.encoded'),
    ).toHaveLength(2);
    const limits = {
      transfer: { mean: 32, fraction: 0.251 },
      transparency: { mean: 7, fraction: 0.251 },
      font: { mean: 2, fraction: 0.04 },
      'rotation-crop': { mean: 0.5, fraction: 0.005 },
      'view-annotation': { mean: 0.5, fraction: 0.005 },
      widget: { mean: 0.5, fraction: 0.005 },
    }[fixture];
    for (const image of result.results) {
      expect(image.width).toBe(image.expectedWidth);
      expect(image.height).toBe(image.expectedHeight);
      // Independent engines differ in font antialiasing, transfer-filtered
      // shading and cropped knockout groups. Probe their actual colors below;
      // retain exact PNG/transient parity and tight geometry/annotation limits.
      expect(image.mean).toBeLessThanOrEqual(limits.mean);
      expect(image.differentFraction).toBeLessThanOrEqual(limits.fraction);
      expect(image.nonWhite).toBeGreaterThan(100);
      expect(image.png.nonWhite / image.nonWhite).toBeGreaterThan(0.9);
      expect(image.png.nonWhite / image.nonWhite).toBeLessThan(1.2);
      expect(image.png.mean).toBe(0);
      expect(image.png.differentFraction).toBe(0);
      expect(image.transient.mean).toBe(0);
      expect(image.transient.differentFraction).toBe(0);
    }
    if (fixture === 'font')
      expect(result.results[0]?.png.dark).toBeGreaterThan(200);
    if (fixture === 'transfer') {
      // Solid, image and pattern transfer maps apply. PDFium leaves the
      // bottom-left shading uninverted; this is a documented engine limit.
      for (const image of result.results) {
        expect(image.probes.slice(0, 3)).toEqual(
          Array.from({ length: 3 }, () => [0, 255, 255, 255]),
        );
        expect(image.probes[4]?.[1]).toBe(0);
        expect(image.probes[5]?.[1]).toBe(0);
        expect(image.referenceProbes[4]?.[1]).toBe(255);
        expect(image.probes[6]).toEqual(image.referenceProbes[6]);
        expect(image.probes[7]).toEqual(image.referenceProbes[7]);
      }
    }
    if (fixture === 'transparency') {
      const expected = [
        [
          [191, 127, 0, 255],
          [191, 127, 0, 255],
          [166, 89, 0, 255],
          [89, 166, 0, 255],
          [128, 0, 0, 255],
          [128, 0, 0, 255],
          [128, 0, 127, 255],
          [128, 0, 127, 255],
        ],
        [
          [96, 191, 126, 255],
          [128, 0, 0, 255],
          [166, 89, 0, 255],
          [166, 89, 0, 255],
          [96, 191, 126, 255],
          [128, 0, 0, 255],
          [128, 0, 127, 255],
          [128, 0, 127, 255],
        ],
      ];
      result.results.forEach((image, index) => {
        image.probes.forEach((color, probe) => {
          color.forEach((channel, component) => {
            expect(
              Math.abs(
                channel - (expected[index]?.[probe]?.[component] ?? NaN),
              ),
            ).toBeLessThanOrEqual(2);
          });
        });
      });
    }
    if (fixture === 'widget') {
      expect(result.sheet.name).toBe('A-3 · widget');
      expect(result.results[0]?.samples.left).toEqual([255, 0, 0, 255]);
      expect(result.results[0]?.samples.right).toEqual([0, 0, 255, 255]);
    }
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
