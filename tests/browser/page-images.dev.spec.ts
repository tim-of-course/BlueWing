import { expect, test } from '@playwright/test';
import type { PageImagesHarness } from './page-images-harness';
import { captureErrors } from './wingman';

declare global {
  interface Window {
    pageImages: PageImagesHarness;
  }
}

const red = [255, 0, 0, 255];
const blue = [0, 0, 255, 255];
const green = [0, 255, 0, 255];
const magenta = [255, 0, 255, 255];
const yellow = [255, 255, 0, 255];
const cyan = [0, 255, 255, 255];

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/browser/page-images-harness.html');
  await page.waitForFunction(() => Boolean(window.pageImages));
});

test('revisiting A after B reuses pixels and each caller owns its canvas', async ({
  page,
}) => {
  const errors = captureErrors(page);
  const result = await page.evaluate(() => window.pageImages.ownership());
  expect(result.original).toEqual({
    width: 64,
    height: 1,
    left: red,
    right: blue,
  });
  for (const image of [result.mutated, result.revisited, result.simultaneous])
    expect(image).toEqual(result.original);
  expect(result.other.left).toEqual(green);
  expect(result.other.right).toEqual(magenta);
  expect(result.distinct).toBe(true);
  expect(result.calls.map((call) => call.id)).toEqual(['a', 'b']);
  expect(errors).toEqual([]);
});

test('new PageImages instances decode saved full images and previews without PDF rendering', async ({
  page,
}) => {
  const errors = captureErrors(page);
  const result = await page.evaluate(() => window.pageImages.diskReuse());
  expect(result.full).toEqual(result.expected);
  expect(result.full).toEqual({
    width: 3300,
    height: 33,
    left: red,
    right: blue,
  });
  expect(result.preview).toEqual({
    width: 640,
    height: 7,
    left: red,
    right: blue,
  });
  expect(result.calls).toHaveLength(1);
  expect(result.reads).toBe(3);
  expect(result.pngHeaders).toHaveLength(2);
  for (const header of result.pngHeaders)
    expect(header).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(errors).toEqual([]);
});

for (const failure of [
  'missing',
  'corrupt',
  'reject-read',
  'reject-write',
] as const) {
  test(`${failure} disk cache still returns successful PDF pixels`, async ({
    page,
  }) => {
    const errors = captureErrors(page);
    const result = await page.evaluate(
      (mode) => window.pageImages.diskFailure(mode),
      failure,
    );
    expect(result.rendered).toEqual({
      width: 64,
      height: 1,
      left: red,
      right: blue,
    });
    expect(result.cached).toEqual(result.rendered);
    expect(result.calls).toBe(1);
    expect(result.reads).toBe(1);
    expect(result.writes).toBe(1);
    expect(result.saved).toBe(failure === 'reject-write' ? 0 : 1);
    expect(errors).toEqual([]);
  });
}

for (const failure of ['missing', 'corrupt'] as const) {
  test(`${failure} preview cache recovers from the saved full PNG alongside a full disk hit`, async ({
    page,
  }) => {
    const errors = captureErrors(page);
    const result = await page.evaluate(
      (mode) => window.pageImages.previewRecovery(mode),
      failure,
    );
    expect(result.full).toEqual({
      width: 3300,
      height: 33,
      left: red,
      right: blue,
    });
    expect(result.preview).toEqual({
      width: 640,
      height: 7,
      left: red,
      right: blue,
    });
    expect(result.calls).toBe(1);
    expect(result.writes).toBe(1);
    expect(result.header).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(errors).toEqual([]);
  });
}

test('memory eviction reloads disk; metadata reuses pixels while source, rotation, size and resolution changes refresh them', async ({
  page,
}) => {
  const errors = captureErrors(page);
  const result = await page.evaluate(() =>
    window.pageImages.evictionAndChanges(),
  );
  expect(result.reloaded).toEqual({
    width: 3300,
    height: 33,
    left: red,
    right: blue,
  });
  expect(result.retainedCaller).toEqual(result.reloaded);
  expect(result.renamed).toEqual(result.reloaded);
  expect(result.readsOfA).toBe(2);
  expect(result.callsAfterMetadata).toBe(2);
  expect(result.changed).toEqual([
    { width: 3300, height: 33, left: yellow, right: cyan },
    { width: 3300, height: 33, left: green, right: magenta },
    { width: 3300, height: 33, left: blue, right: red },
    { width: 3300, height: 66, left: red, right: blue },
    { width: 3300, height: 66, left: red, right: blue },
    { width: 128, height: 2, left: red, right: blue },
  ]);
  expect(result.calls).toBe(8);
  expect(errors).toEqual([]);
});

test('one consumer aborts a shared pending request while another receives its image', async ({
  page,
}) => {
  const errors = captureErrors(page);
  const result = await page.evaluate(() =>
    window.pageImages.sharedCancellation(),
  );
  expect(result.outcome).toBe('cancelled');
  expect(result.workAborted).toBe(false);
  expect(result.surviving).toEqual({
    width: 64,
    height: 1,
    left: red,
    right: blue,
  });
  expect(result.cached).toEqual(result.surviving);
  expect(result.calls).toBe(1);
  expect(errors).toEqual([]);
});

for (const action of ['abort', 'clear'] as const) {
  test(`${action} cancels all consumers and a late result cannot replace the fresh memory or disk image`, async ({
    page,
  }) => {
    const errors = captureErrors(page);
    const result = await page.evaluate(
      (method) => window.pageImages.cancellation(method),
      action,
    );
    expect(result.settled).toEqual(['cancelled', 'cancelled']);
    expect(result.fresh).toEqual({
      width: 64,
      height: 1,
      left: green,
      right: magenta,
    });
    expect(result.cached).toEqual(result.fresh);
    expect(result.disk).toEqual(result.fresh);
    expect(result.oldBitmapReleased).toBe(true);
    expect(result.calls).toBe(2);
    expect(result.writes).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('project clear aborts background preparation and discards its queue and late pixels', async ({
  page,
}) => {
  const errors = captureErrors(page);
  const result = await page.evaluate(() =>
    window.pageImages.clearPreparation(),
  );
  expect(result.fresh).toEqual({
    width: 3300,
    height: 33,
    left: green,
    right: magenta,
  });
  expect(result.cached).toEqual(result.fresh);
  expect(result.calls).toEqual(['a', 'a']);
  expect(result.writes).toBe(2);
  expect(result.oldBitmapReleased).toBe(true);
  expect(errors).toEqual([]);
});

test('preparation visits every page nearby first and saves previews derived from full images', async ({
  page,
}) => {
  const errors = captureErrors(page);
  const result = await page.evaluate(() => window.pageImages.preparation());
  expect(result.calls).toHaveLength(5);
  expect(result.calls[0]?.pageIndex).toBe(2);
  expect(result.calls.map((call) => call.pageIndex).sort()).toEqual([
    0, 1, 2, 3, 4,
  ]);
  const distances = result.calls.map((call) => Math.abs(call.pageIndex - 2));
  expect(distances).toEqual([...distances].sort());
  expect(result.calls.every((call) => call.dimension === 3300)).toBe(true);
  expect(result.pngCount).toBe(10);
  expect(result.status).toEqual({
    total: 5,
    completed: 5,
    failed: 0,
    running: false,
    paused: false,
  });
  expect(result.calls.every((call) => call.priority === 10)).toBe(true);
  expect(result.previews).toEqual([
    { width: 640, height: 7, left: red, right: blue },
    { width: 640, height: 7, left: green, right: magenta },
    { width: 640, height: 7, left: yellow, right: cyan },
    { width: 640, height: 7, left: red, right: blue },
    { width: 640, height: 7, left: green, right: magenta },
  ]);
  expect(errors).toEqual([]);
});

test('display leases retain their pixels through eviction, clear and another lease release', async ({
  page,
}) => {
  const errors = captureErrors(page);
  const result = await page.evaluate(() => window.pageImages.leaseLifetime());
  expect(result.original).toEqual({
    width: 3300,
    height: 33,
    left: red,
    right: blue,
  });
  for (const image of [
    result.afterEviction,
    result.afterClear,
    result.surviving,
  ])
    expect(image).toEqual(result.original);
  expect(result.sameSource).toBe(true);
  expect(result.readsOfA).toBe(2);
  expect(result.calls).toBe(2);
  expect(result.released).toBe(true);
  expect(errors).toEqual([]);
});

test('full and preview display arrive while encoding is held and share one PDF render', async ({
  page,
}) => {
  const errors = captureErrors(page);
  const result = await page.evaluate(() =>
    window.pageImages.displayBeforeEncoding(),
  );
  expect(result.visible).toEqual({
    width: 3300,
    height: 33,
    left: red,
    right: blue,
  });
  expect(result.previewPixels).toEqual({
    width: 640,
    height: 7,
    left: red,
    right: blue,
  });
  expect(result.pending).toBe(true);
  expect(result.writesBeforeEncoding).toBe(0);
  expect(result.header).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0]?.dimension).toBe(3300);
  expect(result.writes).toBe(2);
  expect(errors).toEqual([]);
});

test('preparation pause preserves its queue and progress counts saved pages after encoding', async ({
  page,
}) => {
  const errors = captureErrors(page);
  const result = await page.evaluate(() =>
    window.pageImages.preparationProgress(),
  );
  expect(result.queued).toEqual({
    total: 3,
    completed: 0,
    failed: 0,
    running: true,
    paused: true,
  });
  expect(result.callsWhilePaused).toBe(0);
  expect(result.encoding.completed).toBe(0);
  expect(result.encoding.running).toBe(true);
  expect(result.paused).toEqual({
    total: 3,
    completed: 1,
    failed: 0,
    running: true,
    paused: true,
  });
  expect(result.callsBeforeResume).toBe(1);
  expect(result.selected).toEqual({
    width: 3300,
    height: 33,
    left: red,
    right: blue,
  });
  expect(result.final).toEqual({
    total: 3,
    completed: 3,
    failed: 0,
    running: false,
    paused: false,
  });
  expect(
    result.statuses.some((status) => status.completed === 1 && status.paused),
  ).toBe(true);
  expect(result.calls).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('selecting the page being prepared reuses its work and promotes its priority', async ({
  page,
}) => {
  const errors = captureErrors(page);
  const result = await page.evaluate(() =>
    window.pageImages.reusePreparation(),
  );
  expect(result.initialPriority).toBe(10);
  expect(result.priorityAfterReuse).toBe(100);
  expect(result.pauseAfterReuse).toBe(false);
  expect(result.visible).toEqual({
    width: 3300,
    height: 33,
    left: red,
    right: blue,
  });
  expect(result.calls).toHaveLength(1);
  expect(result.calls[0]?.priority).toBe(100);
  expect(result.status.completed).toBe(1);
  expect(errors).toEqual([]);
});

for (const failure of ['write', 'encode'] as const) {
  test(`${failure} failure counts preparation as failed while held display pixels remain usable`, async ({
    page,
  }) => {
    const errors = captureErrors(page);
    const result = await page.evaluate(
      (mode) => window.pageImages.preparationFailure(mode),
      failure,
    );
    expect(result.completedBeforeEncoding).toBe(0);
    expect(result.status).toEqual({
      total: 1,
      completed: 0,
      failed: 1,
      running: false,
      paused: false,
    });
    expect(result.visible).toEqual({
      width: 3300,
      height: 33,
      left: red,
      right: blue,
    });
    expect(result.previewCached).toBe(failure === 'write');
    expect(result.calls).toBe(1);
    expect(result.writes).toBe(failure === 'write' ? 2 : 0);
    expect(result.saved).toBe(0);
    expect(result.released).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const userPause of [false, true]) {
  test(`${userPause ? 'user pause stops active preparation, then resuming' : 'input and foreground requests'} lets active background preparation make progress`, async ({
    page,
  }) => {
    const errors = captureErrors(page);
    const result = await page.evaluate(
      (pause) => window.pageImages.backgroundProgress(pause),
      userPause,
    );
    expect(result.pauseObserved).toBe(userPause);
    expect(result.finishedDuringUserPause).toBe(userPause ? false : undefined);
    expect(result.finishedWhileForegroundHeld).toBe(true);
    expect(result.backgroundAborted).toBe(false);
    expect(result.firstChunk).toEqual({
      width: 3300,
      height: 33,
      left: red,
      right: [0, 0, 0, 0],
    });
    expect(result.foreground).toEqual({
      width: 64,
      height: 1,
      left: green,
      right: magenta,
    });
    expect(result.background).toEqual({
      width: 3300,
      height: 33,
      left: red,
      right: blue,
    });
    expect(result.events).toEqual([
      'background:start',
      'foreground:start',
      'background:resume',
      'background:end',
      'foreground:end',
    ]);
    expect(errors).toEqual([]);
  });
}
