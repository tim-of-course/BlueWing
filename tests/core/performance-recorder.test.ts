import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PerformanceRecorder } from '../../src/performance/recorder';
import type {
  BrowserTimingEntry,
  PerformanceBrowser,
  PerformanceRecorderStatus,
} from '../../src/performance/recorder';

function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

function fixture(capacity = 2048) {
  let time = 1000;
  const recorder = new PerformanceRecorder({
    capacity,
    now: () => time,
    wallNow: () => Date.UTC(2026, 9, 7, 12),
  });
  return {
    recorder,
    time: () => time,
    advance: (duration: number) => {
      time += duration;
      return time;
    },
  };
}

function browserFixture(
  supportedEntryTypes = ['event', 'longtask', 'long-animation-frame'],
  rejectedTypes: string[] = [],
) {
  const frames = new Map<number, FrameRequestCallback>();
  const visibilityListeners = new Set<() => void>();
  let nextFrame = 0;
  const observers: FakeObserver[] = [];
  class FakeObserver {
    static readonly supportedEntryTypes = supportedEntryTypes;
    options: PerformanceObserverInit | undefined;
    disconnected = false;
    pending: BrowserTimingEntry[] = [];

    constructor(
      readonly callback: (list: { getEntries(): BrowserTimingEntry[] }) => void,
    ) {
      observers.push(this);
    }

    observe(options: PerformanceObserverInit): void {
      this.options = options;
      if (rejectedTypes.includes(required(options.type))) {
        throw new Error('Timing capture unavailable in this webview');
      }
    }

    takeRecords(): BrowserTimingEntry[] {
      return this.pending.splice(0);
    }

    disconnect(): void {
      this.disconnected = true;
      this.pending = [];
    }
  }

  const document = {
    visibilityState: 'visible',
    addEventListener: (_type: 'visibilitychange', listener: () => void) => {
      visibilityListeners.add(listener);
    },
    removeEventListener: (_type: 'visibilitychange', listener: () => void) => {
      visibilityListeners.delete(listener);
    },
  };
  const browser: PerformanceBrowser = {
    document,
    requestAnimationFrame: (callback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => {
      frames.delete(id);
    },
    PerformanceObserver: FakeObserver,
    navigator: { userAgent: 'Test WebView', platform: 'Test OS' },
    innerWidth: 1200,
    innerHeight: 800,
    devicePixelRatio: 2,
  };
  return {
    browser,
    frames,
    observers,
    visibilityListeners,
    frame: (time: number) => {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(time);
    },
    visibility: (state: string) => {
      document.visibilityState = state;
      for (const listener of visibilityListeners) listener();
    },
    observer: (type: string) =>
      required(observers.find((observer) => observer.options?.type === type)),
    emit: (type: string, entries: BrowserTimingEntry[]) => {
      required(
        observers.find((observer) => observer.options?.type === type),
      ).callback({ getEntries: () => entries });
    },
  };
}

void test('idle calls are inert and an empty report is JSON-compatible', () => {
  let clockReads = 0;
  const recorder = new PerformanceRecorder({
    now: () => {
      clockReads++;
      return 0;
    },
  });
  recorder.event('idle');
  recorder.span('idle')({ width: 100 });
  assert.equal(clockReads, 0);
  assert.deepEqual(recorder.status(), {
    active: false,
    startedAt: null,
    elapsedMs: 0,
    recordedEvents: 0,
    retainedEvents: 0,
    droppedEvents: 0,
    capacity: 2048,
    browserAttached: false,
  });
  const report = recorder.stop();
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  assert.deepEqual(report.capabilities, {
    frame: 'not-attached',
    input: 'not-attached',
    longtask: 'not-attached',
    'long-animation-frame': 'not-attached',
  });
  assert.equal(report.summary.frames.p95Ms, null);
});

void test('spans retain stage timestamps, merge results and finish once', () => {
  const { recorder, advance } = fixture();
  recorder.start({ purpose: 'open-sheet', pageId: 'page-1' });
  advance(5);
  const finish = recorder.span('pdf.render', {
    pageId: 'page-1',
    width: 100,
    cacheSource: 'miss',
  });
  advance(25);
  recorder.event('pdf.publish', { height: 200 });
  finish({ cacheSource: 'worker', width: 300 });
  advance(10);
  finish({ width: 999 });
  const report = recorder.stop();
  assert.equal(report.startedAt, '2026-10-07T12:00:00.000Z');
  assert.equal(report.elapsedMs, 40);
  assert.equal(report.active, false);
  assert.deepEqual(report.events, [
    {
      sequence: 1,
      kind: 'event',
      name: 'pdf.publish',
      atMs: 30,
      durationMs: null,
      data: { height: 200 },
    },
    {
      sequence: 2,
      kind: 'span',
      name: 'pdf.render',
      atMs: 5,
      durationMs: 25,
      data: { pageId: 'page-1', width: 300, cacheSource: 'worker' },
    },
  ]);
  assert.equal(report.summary.counts.span, 1);
  advance(1000);
  recorder.event('after-stop');
  recorder.span('after-stop')();
  assert.deepEqual(recorder.stop(), report);
});

void test('start resets the recording and late spans cannot enter a new session', () => {
  const { recorder, advance } = fixture(2);
  recorder.start({ purpose: 'first' });
  const oldFinish = recorder.span('old');
  recorder.event('first');
  advance(10);
  const state = recorder.start({ purpose: 'second' });
  assert.equal(state.elapsedMs, 0);
  assert.equal(state.recordedEvents, 0);
  oldFinish();
  recorder.event('second');
  const afterStop = recorder.span('unfinished');
  recorder.stop();
  afterStop();
  recorder.start();
  afterStop();
  assert.deepEqual(recorder.report().events, []);
  assert.deepEqual(recorder.report().metadata, {});
  assert.equal(recorder.report().summary.counts.span, 0);
});

void test('the ring retains the newest events and counts every dropped event', () => {
  const { recorder, advance } = fixture(3);
  recorder.start();
  for (let index = 0; index < 10; index++) {
    advance(1);
    recorder.event(`event-${String(index)}`, { index });
  }
  const report = recorder.report();
  assert.deepEqual(
    report.events.map((event) => event.name),
    ['event-7', 'event-8', 'event-9'],
  );
  assert.deepEqual(
    report.events.map((event) => event.sequence),
    [8, 9, 10],
  );
  assert.equal(report.droppedEvents, 7);
  assert.equal(report.recordedEvents, 10);
  assert.equal(report.summary.counts.event, 10);
  assert.equal(recorder.status().retainedEvents, 3);
  recorder.stop();
});

void test('long recordings retain slow page timing and preparation progress after timeline eviction', () => {
  const { recorder, time, advance } = fixture();
  const browser = browserFixture([]);
  recorder.attachBrowser(browser.browser);
  recorder.start();
  const slow = recorder.span('page.request', {
    pageId: 'slow-page',
    purpose: 'selected',
    dimension: 3300,
  });
  advance(4563);
  slow();
  const cached = recorder.span('page.request', {
    pageId: 'other-page',
    purpose: 'selected',
    dimension: 3300,
  });
  advance(1);
  cached();
  recorder.span('page.request', { purpose: 'preview', dimension: 640 })();
  recorder.event('page.preparation', { total: 3, completed: 0, running: true });
  recorder.event('page.preparation', {
    total: 3,
    completed: 3,
    running: false,
  });
  browser.frame(time());
  for (let index = 0; index < 36_000; index++)
    browser.frame(advance(1000 / 60));
  const report = recorder.stop();
  assert.equal(
    report.events.some((event) => event.kind === 'span'),
    false,
  );
  const selected = required(
    report.summary.activities.find(
      (activity) => activity.dimensions.purpose === 'selected',
    ),
  );
  assert.equal(selected.count, 2);
  assert.equal(selected.timedCount, 2);
  assert.equal(selected.totalDurationMs, 4564);
  assert.equal(selected.worst?.durationMs, 4563);
  assert.equal(selected.worst.data.pageId, 'slow-page');
  assert.equal(selected.latest.data.pageId, 'other-page');
  assert.deepEqual(
    required(
      report.summary.activities.find(
        (activity) => activity.name === 'page.preparation',
      ),
    ).latest.data,
    { total: 3, completed: 3, running: false },
  );
  assert.equal(report.summary.ungroupedActivityEvents, 0);
  selected.latest.data.pageId = 'mutated';
  assert.equal(
    recorder.report().summary.activities[0]?.latest.data.pageId,
    'other-page',
  );
  recorder.start();
  assert.deepEqual(recorder.report().summary.activities, []);
});

void test('activity summaries bound distinct groups while continuing existing totals', () => {
  const { recorder } = fixture();
  recorder.start();
  for (let index = 0; index < 65; index++)
    recorder.event(`stage-${String(index)}`);
  recorder.event('stage-0');
  const report = recorder.stop();
  assert.equal(report.summary.activities.length, 64);
  assert.equal(report.summary.ungroupedActivityEvents, 1);
  assert.equal(report.summary.activities[0]?.count, 2);
});

void test('snapshots do not expose mutable recorder metadata, events or summaries', () => {
  const { recorder } = fixture();
  const browser = browserFixture();
  recorder.attachBrowser(browser.browser);
  const metadata = { purpose: 'test', width: 10 };
  recorder.start(metadata);
  const data = { pageId: 'page-1', height: 20 };
  recorder.event('render', data);
  metadata.width = 999;
  data.height = 999;
  const snapshot = recorder.report();
  snapshot.metadata.width = -1;
  required(snapshot.events[0]).data.height = -1;
  required(snapshot.events[0]).name = 'mutated';
  snapshot.summary.counts.event = -1;
  required(snapshot.environment.viewport ?? undefined).width = -1;
  snapshot.capabilities.frame = 'unsupported';
  const current = recorder.stop();
  assert.deepEqual(current.metadata, { purpose: 'test', width: 10 });
  assert.deepEqual(required(current.events[0]).data, {
    pageId: 'page-1',
    height: 20,
  });
  assert.equal(required(current.events[0]).name, 'render');
  assert.equal(current.summary.counts.event, 1);
  assert.equal(current.environment.viewport?.width, 1200);
  assert.equal(current.capabilities.frame, 'supported');
});

void test('subscriptions notify lifecycle changes and unsubscribe is idempotent', () => {
  const { recorder } = fixture();
  const statuses: PerformanceRecorderStatus[] = [];
  const unsubscribe = recorder.subscribe((status) => statuses.push(status));
  recorder.start();
  recorder.event('render');
  recorder.span('stage')();
  assert.equal(statuses.length, 1);
  recorder.stop();
  recorder.stop();
  assert.deepEqual(
    statuses.map((status) => status.active),
    [true, false],
  );
  assert.equal(required(statuses[1]).recordedEvents, 2);
  unsubscribe();
  unsubscribe();
  recorder.start();
  recorder.stop();
  assert.equal(statuses.length, 2);
});

void test('dimensions and names are bounded and private string fields are omitted', () => {
  const { recorder } = fixture();
  recorder.start({
    purpose: 'render',
    pageId: 'page-1',
    cacheSource: 'disk',
    rendererVersion: 'renderer-1',
    buildVersion: '2026.10.07',
    width: 3300,
    cached: true,
    missing: null,
    pageText: 'private plan text',
    screenshot: 'private encoded pixels',
    path: '/private/plan.pdf',
    invalid: Infinity,
  });
  assert.deepEqual(recorder.report().metadata, {
    purpose: 'render',
    pageId: 'page-1',
    cacheSource: 'disk',
    rendererVersion: 'renderer-1',
    buildVersion: '2026.10.07',
    width: 3300,
    cached: true,
    missing: null,
  });
  recorder.event('n'.repeat(1000), {
    purpose: 'p'.repeat(1000),
    ...Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`dim${String(index)}`, index]),
    ),
  });
  const event = required(recorder.stop().events[0]);
  assert.equal(event.name.length, 160);
  assert.equal(String(event.data.purpose).length, 160);
  assert.equal(Object.keys(event.data).length, 32);
});

void test('browser attachment is idle until start and RAF samples only visible intervals', () => {
  const { recorder, time, advance } = fixture();
  const browser = browserFixture();
  recorder.attachBrowser(browser.browser);
  assert.equal(browser.frames.size, 0);
  assert.equal(browser.observers.length, 0);
  assert.equal(browser.visibilityListeners.size, 0);
  recorder.start();
  assert.equal(browser.frames.size, 1);
  assert.equal(browser.observers.length, 3);
  assert.equal(browser.visibilityListeners.size, 1);
  browser.frame(time());
  browser.frame(advance(16));
  browser.frame(advance(60));
  browser.visibility('hidden');
  assert.equal(browser.frames.size, 0);
  advance(60_000);
  browser.visibility('visible');
  browser.frame(time());
  browser.frame(advance(20));
  const report = recorder.stop();
  assert.deepEqual(report.summary.frames, {
    count: 3,
    meanMs: 32,
    worstMs: 60,
    p95Ms: 60,
    retainedSamples: 3,
    over50Ms: 1,
    over100Ms: 0,
  });
  assert.equal(browser.frames.size, 0);
  assert.equal(browser.visibilityListeners.size, 0);
  assert.ok(browser.observers.every((observer) => observer.disconnected));
  browser.visibility('hidden');
  browser.visibility('visible');
  assert.equal(browser.frames.size, 0);
});

void test('frame p95 describes retained samples while count and worst cover the whole session', () => {
  const { recorder, time, advance } = fixture(20);
  const browser = browserFixture([]);
  recorder.attachBrowser(browser.browser);
  recorder.start();
  browser.frame(time());
  browser.frame(advance(500));
  for (let gap = 1; gap <= 20; gap++) browser.frame(advance(gap));
  const report = recorder.stop();
  assert.deepEqual(report.summary.frames, {
    count: 21,
    meanMs: 710 / 21,
    worstMs: 500,
    p95Ms: 19,
    retainedSamples: 20,
    over50Ms: 1,
    over100Ms: 1,
  });
  assert.equal(report.droppedEvents, 1);
  assert.equal(report.summary.counts.frame, 21);
});

void test('supported observers capture input delay and long work without private attribution', () => {
  const { recorder, advance } = fixture();
  const browser = browserFixture();
  recorder.attachBrowser(browser.browser);
  recorder.start();
  advance(300);
  const privateEntry = {
    entryType: 'event',
    name: 'pointerdown',
    startTime: 1010,
    duration: 96,
    processingStart: 1040,
    processingEnd: 1050,
    interactionId: 12,
    target: { textContent: 'Private page title' },
  };
  browser.emit('event', [
    { ...privateEntry, startTime: 999 },
    privateEntry,
    {
      ...privateEntry,
      startTime: 1200,
      processingStart: 1210,
      processingEnd: 1220,
    },
    { ...privateEntry, startTime: 2000 },
  ]);
  browser.emit('longtask', [
    {
      entryType: 'longtask',
      name: 'self',
      startTime: 1050,
      duration: 80,
    },
  ]);
  const privateAnimation = {
    entryType: 'long-animation-frame',
    name: 'private script path',
    startTime: 1100,
    duration: 120,
    blockingDuration: 65,
    scripts: [{ sourceURL: '/private/path.js' }],
  };
  browser.emit('long-animation-frame', [privateAnimation]);
  browser.observer('longtask').pending.push({
    entryType: 'longtask',
    name: 'self',
    startTime: 1220,
    duration: 60,
  });
  assert.deepEqual(browser.observer('event').options, {
    type: 'event',
    buffered: false,
    durationThreshold: 16,
  });
  const report = recorder.stop();
  assert.equal(report.events.length, 5);
  assert.deepEqual(report.capabilities, {
    frame: 'supported',
    input: 'supported',
    longtask: 'supported',
    'long-animation-frame': 'supported',
  });
  assert.deepEqual(report.summary.inputDelay, {
    count: 2,
    meanMs: 20,
    worstMs: 30,
    p95Ms: 30,
    retainedSamples: 2,
  });
  assert.deepEqual(required(report.events[0]).data, {
    inputDelayMs: 30,
    processingMs: 10,
    interactionId: 12,
  });
  assert.equal(report.summary.longTasks.count, 2);
  assert.equal(report.summary.longTasks.meanMs, 70);
  assert.equal(report.summary.longTasks.worstMs, 80);
  assert.equal(report.summary.longAnimationFrames.worstMs, 120);
  assert.deepEqual(required(report.events[3]).data, { blockingDurationMs: 65 });
  assert.equal(JSON.stringify(report).includes('Private'), false);
  assert.equal(JSON.stringify(report).includes('/private'), false);
});

void test('capabilities distinguish unsupported APIs from rejected observer setup', () => {
  const { recorder } = fixture();
  const browser = browserFixture(['event', 'longtask'], ['longtask']);
  const target = { ...browser.browser };
  delete target.requestAnimationFrame;
  delete target.cancelAnimationFrame;
  recorder.attachBrowser(target);
  recorder.start();
  const report = recorder.stop();
  assert.deepEqual(report.capabilities, {
    frame: 'unsupported',
    input: 'supported',
    longtask: 'unavailable',
    'long-animation-frame': 'unsupported',
  });
  assert.equal(browser.observers.length, 2);
  assert.ok(browser.observers.every((observer) => observer.disconnected));
  assert.equal(browser.visibilityListeners.size, 0);
  assert.equal(browser.frames.size, 0);
});

void test('detach and restart release capture and ignore callbacks from previous observers', () => {
  const { recorder, advance } = fixture();
  const browser = browserFixture();
  recorder.attachBrowser(browser.browser);
  recorder.start();
  const obsoleteObserver = browser.observer('longtask');
  const obsoleteFrame = required([...browser.frames.values()][0]);
  recorder.detachBrowser();
  assert.equal(recorder.status().active, true);
  assert.equal(recorder.status().browserAttached, false);
  assert.equal(browser.frames.size, 0);
  assert.equal(browser.visibilityListeners.size, 0);
  assert.ok(browser.observers.every((observer) => observer.disconnected));
  recorder.attachBrowser(browser.browser);
  advance(100);
  recorder.start();
  obsoleteObserver.callback({
    getEntries: () => [
      {
        entryType: 'longtask',
        name: 'self',
        startTime: 1100,
        duration: 90,
      },
    ],
  });
  obsoleteFrame(1100);
  assert.deepEqual(recorder.report().events, []);
  assert.equal(browser.frames.size, 1);
  recorder.stop();
  assert.equal(browser.frames.size, 0);
  assert.ok(browser.observers.every((observer) => observer.disconnected));
  recorder.detachBrowser();
  recorder.start();
  assert.equal(recorder.report().capabilities.frame, 'not-attached');
  assert.equal(recorder.report().environment.userAgent, null);
  recorder.stop();
});
