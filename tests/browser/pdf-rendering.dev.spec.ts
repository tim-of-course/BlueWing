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
    const errors = captureErrors(page);
    await page.goto('/tests/browser/pdf-rendering-harness.html');
    const result = await page.evaluate(
      (stop) => window.pdfRendering.backgroundPause(stop),
      cancel,
    );
    expect(result.backgroundStillPaused).toBe(true);
    expect(result.foreground.left).toEqual([255, 0, 0, 255]);
    expect(result.foreground.right).toEqual([0, 0, 255, 255]);
    expect(result.result).toEqual(cancel ? 'cancelled' : result.foreground);
    expect(result.channels).toHaveLength(2);
    expect(result.channels.every((channel) => channel.closed === 2)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('PDF chunks yield to input while rendering without animation frames', async ({
  page,
}, info) => {
  const errors = captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() => window.pdfRendering.yielding());
  await info.attach('pdf-rendering-scheduler', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  expect(result.channels).toHaveLength(1);
  expect(result.channels[0]?.deliveries).toBeGreaterThan(2);
  expect(result.channels[0]?.closed).toBe(2);
  expect(result.inputDuringRender).toBe(true);
  expect(result.drawsBeforeInput).toBeGreaterThan(0);
  expect(result.frameRequests).toBe(0);
  expect(result.width).toBe(64);
  expect(result.height).toBe(64);
  expect(result.left).toEqual([255, 0, 0, 255]);
  expect(result.right).toEqual([0, 0, 255, 255]);
  expect(errors).toEqual([]);
});

for (const action of ['release', 'clear'] as const) {
  test(`PDF ${action} cancels a pending continuation and allows the asset to reload`, async ({
    page,
  }) => {
    const errors = captureErrors(page);
    await page.goto('/tests/browser/pdf-rendering-harness.html');
    const result = await page.evaluate(
      (method) => window.pdfRendering.cancellation(method),
      action,
    );
    expect(result.outcome).toBe('cancelled');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]?.posts).toBeGreaterThan(0);
    expect(result.channels[0]?.closed).toBe(2);
    expect(result.reads).toBe(1);
    expect(result.reloaded.left).toEqual([255, 0, 0, 255]);
    expect(result.reloaded.right).toEqual([0, 0, 255, 255]);
    expect(errors).toEqual([]);
  });
}

test('aborting PDF loading settles before the source responds and allows reopening', async ({
  page,
}) => {
  const errors = captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() => window.pdfRendering.abortLoading());
  expect(result.outcome).toBe('Superseded sheet');
  expect(result.opens).toBe(2);
  expect(result.reopened.left).toEqual([255, 0, 0, 255]);
  expect(result.reopened.right).toEqual([0, 0, 255, 255]);
  expect(errors).toEqual([]);
});

test('PDF cache keeps two recent idle documents and pins active operations', async ({
  page,
}) => {
  const errors = captureErrors(page);
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
  const errors = captureErrors(page);
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
  const errors = captureErrors(page);
  await page.goto('/tests/browser/pdf-rendering-harness.html');
  const result = await page.evaluate(() => window.pdfRendering.rangeFailure());
  expect(result.failures).toBeGreaterThan(0);
  expect(result.failure).toBeTruthy();
  expect(result.opens).toBe(1);
  expect(result.recovered.left).toEqual([255, 0, 0, 255]);
  expect(result.recovered.right).toEqual([0, 0, 255, 255]);
  expect(errors).toEqual([]);
});

test('PDF clear finishes while rendering waits for page content and ignores late delivery', async ({
  page,
}) => {
  const errors = captureErrors(page);
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
    const errors = captureErrors(page);
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
