/** Flat, bounded dimensions. String fields retain pageId, cacheSource, purpose and build versions. */
export type PerformanceData = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;
type Dimensions = Record<string, string | number | boolean | null>;
export type FinishPerformanceSpan = (resultData?: PerformanceData) => void;
export type PerformanceEventKind =
  'event' | 'span' | 'frame' | 'input' | 'longtask' | 'long-animation-frame';
type MeasuredKind = Exclude<PerformanceEventKind, 'event' | 'span'>;
type Capability = 'supported' | 'unsupported' | 'not-attached' | 'unavailable';

export interface PerformanceCaptureEvent {
  sequence: number;
  kind: PerformanceEventKind;
  name: string;
  /** Milliseconds since start. For spans, this is the beginning of the stage. */
  atMs: number;
  durationMs: number | null;
  data: Dimensions;
}

export interface PerformanceRecorderStatus {
  active: boolean;
  startedAt: string | null;
  elapsedMs: number;
  recordedEvents: number;
  retainedEvents: number;
  droppedEvents: number;
  capacity: number;
  browserAttached: boolean;
}

export interface PerformanceMetricSummary {
  count: number;
  meanMs: number | null;
  worstMs: number | null;
  /** Nearest-rank p95 of retained events only; count/mean/worst cover the whole session. */
  p95Ms: number | null;
  retainedSamples: number;
}

/** Whole-session activity totals survive eviction from the detailed timeline. */
export interface PerformanceActivitySummary {
  name: string;
  dimensions: Dimensions;
  count: number;
  timedCount: number;
  totalDurationMs: number;
  worst: PerformanceCaptureEvent | null;
  latest: PerformanceCaptureEvent;
}

export interface PerformanceReport {
  version: 1;
  startedAt: string | null;
  elapsedMs: number;
  active: boolean;
  metadata: Dimensions;
  environment: {
    userAgent: string | null;
    platform: string | null;
    viewport: { width: number; height: number } | null;
    devicePixelRatio: number | null;
  };
  capabilities: Record<MeasuredKind, Capability>;
  capacity: number;
  recordedEvents: number;
  droppedEvents: number;
  /** Capture/completion order. A finished span can have an earlier atMs. */
  events: PerformanceCaptureEvent[];
  summary: {
    p95Window: 'retained-events';
    inputEventDurationThresholdMs: 16;
    counts: Record<PerformanceEventKind, number>;
    frames: PerformanceMetricSummary & { over50Ms: number; over100Ms: number };
    inputDelay: PerformanceMetricSummary;
    longTasks: PerformanceMetricSummary;
    longAnimationFrames: PerformanceMetricSummary;
    /** Grouped by activity and purpose/resolution/cache/priority, never by page ID. */
    activities: PerformanceActivitySummary[];
    /** New groups beyond the bounded 64-group summary, counted per event. */
    ungroupedActivityEvents: number;
  };
}

// Only these timing fields are used. In particular, DOM targets, task attribution,
// script URLs, page text, paths and screenshots never enter a report.
export interface BrowserTimingEntry {
  entryType: string;
  name: string;
  startTime: number;
  duration: number;
  processingStart?: number;
  processingEnd?: number;
  interactionId?: number;
  blockingDuration?: number;
}

interface TimingObserver {
  // Event Timing's threshold is not declared in the pinned TypeScript DOM types.
  observe(
    options: PerformanceObserverInit & { durationThreshold?: number },
  ): void;
  disconnect(): void;
  takeRecords(): BrowserTimingEntry[];
}

/** A Window satisfies this interface; small fakes can exercise capture in Bun. */
export interface PerformanceBrowser {
  document: {
    readonly visibilityState: string;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
    removeEventListener(type: 'visibilitychange', listener: () => void): void;
  };
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  PerformanceObserver?: {
    readonly supportedEntryTypes?: readonly string[];
    new (
      callback: (list: { getEntries(): BrowserTimingEntry[] }) => void,
    ): TimingObserver;
  };
  navigator?: { userAgent: string; platform: string };
  innerWidth?: number;
  innerHeight?: number;
  devicePixelRatio?: number;
}

export interface PerformanceRecorderOptions {
  /** Defaults to 2,048; at most 20,000 events. */
  capacity?: number;
  /** Use the browser performance time origin when attaching browser capture. */
  now?: () => number;
  wallNow?: () => number;
}

interface MetricTotal {
  count: number;
  totalMs: number;
  worstMs: number;
}

function emptyCounts(): Record<PerformanceEventKind, number> {
  return {
    event: 0,
    span: 0,
    frame: 0,
    input: 0,
    longtask: 0,
    'long-animation-frame': 0,
  };
}

function emptyMetrics(): Record<MeasuredKind, MetricTotal> {
  const empty = () => ({ count: 0, totalMs: 0, worstMs: 0 });
  return {
    frame: empty(),
    input: empty(),
    longtask: empty(),
    'long-animation-frame': empty(),
  };
}

function emptyCapabilities(): Record<MeasuredKind, Capability> {
  return {
    frame: 'not-attached',
    input: 'not-attached',
    longtask: 'not-attached',
    'long-animation-frame': 'not-attached',
  };
}

function dimensions(data: PerformanceData = {}): Dimensions {
  const result: Dimensions = {};
  for (const key of Object.keys(data).slice(0, 32)) {
    if (key.length > 64) continue;
    const value = data[key];
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      result[key] = value;
    } else if (
      typeof value === 'string' &&
      (key === 'pageId' ||
        key === 'cacheSource' ||
        key === 'purpose' ||
        key === 'rendererVersion' ||
        key === 'buildVersion')
    ) {
      result[key] = value.slice(0, 160);
    }
  }
  return result;
}

const finishInactiveSpan: FinishPerformanceSpan = () => {};

export class PerformanceRecorder {
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly wallNow: () => number;
  private active = false;
  private generation = 0;
  private startedAt: string | null = null;
  private startTime = 0;
  private stopTime = 0;
  private metadata: Dimensions = {};
  private buffer: PerformanceCaptureEvent[] = [];
  private nextIndex = 0;
  private recordedEvents = 0;
  private counts = emptyCounts();
  private metrics = emptyMetrics();
  private activities = new Map<string, PerformanceActivitySummary>();
  private ungroupedActivityEvents = 0;
  private over50Ms = 0;
  private over100Ms = 0;
  private capabilities = emptyCapabilities();
  private environment: PerformanceReport['environment'] = {
    userAgent: null,
    platform: null,
    viewport: null,
    devicePixelRatio: null,
  };
  private browser: PerformanceBrowser | undefined;
  private cleanupBrowser: ((drain: boolean) => void) | undefined;
  private readonly listeners = new Set<
    (status: PerformanceRecorderStatus) => void
  >();

  constructor(options: PerformanceRecorderOptions = {}) {
    this.capacity = options.capacity ?? 2048;
    if (
      !Number.isInteger(this.capacity) ||
      this.capacity < 1 ||
      this.capacity > 20_000
    ) {
      throw new RangeError(
        'Recorder capacity must be an integer from 1 to 20000',
      );
    }
    this.now = options.now ?? (() => performance.now());
    this.wallNow = options.wallNow ?? (() => Date.now());
  }

  /** Starts a fresh session, discarding the previous recording. */
  start(metadata?: PerformanceData): PerformanceRecorderStatus {
    this.cleanupBrowser?.(false);
    this.cleanupBrowser = undefined;
    this.generation++;
    this.startTime = this.now();
    this.stopTime = this.startTime;
    this.startedAt = new Date(this.wallNow()).toISOString();
    this.metadata = dimensions(metadata);
    this.buffer = [];
    this.nextIndex = 0;
    this.recordedEvents = 0;
    this.counts = emptyCounts();
    this.metrics = emptyMetrics();
    this.activities.clear();
    this.ungroupedActivityEvents = 0;
    this.over50Ms = 0;
    this.over100Ms = 0;
    this.capabilities = emptyCapabilities();
    this.captureEnvironment();
    this.active = true;
    this.activateBrowser();
    this.notify();
    return this.status();
  }

  stop(): PerformanceReport {
    if (this.active) {
      this.cleanupBrowser?.(true);
      this.cleanupBrowser = undefined;
      this.stopTime = this.now();
      this.active = false;
      this.notify();
    }
    return this.report();
  }

  status(): PerformanceRecorderStatus {
    return {
      active: this.active,
      startedAt: this.startedAt,
      elapsedMs:
        this.startedAt === null
          ? 0
          : Math.max(
              0,
              (this.active ? this.now() : this.stopTime) - this.startTime,
            ),
      recordedEvents: this.recordedEvents,
      retainedEvents: this.buffer.length,
      droppedEvents: this.recordedEvents - this.buffer.length,
      capacity: this.capacity,
      browserAttached: this.browser !== undefined,
    };
  }

  /** Lifecycle notifications only; recording frames never drives UI updates. */
  subscribe(listener: (status: PerformanceRecorderStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  event(name: string, data?: PerformanceData): void {
    if (!this.active) return;
    this.record('event', name, this.now(), null, dimensions(data));
  }

  /** The returned finish callback is idempotent and cannot cross recording sessions. */
  span(name: string, data?: PerformanceData): FinishPerformanceSpan {
    if (!this.active) return finishInactiveSpan;
    const generation = this.generation;
    const startTime = this.now();
    const initialData = dimensions(data);
    let finished = false;
    return (resultData) => {
      if (finished || !this.active || generation !== this.generation) return;
      finished = true;
      this.record(
        'span',
        name,
        startTime,
        Math.max(0, this.now() - startTime),
        dimensions({ ...initialData, ...dimensions(resultData) }),
      );
    };
  }

  /** Attaching while idle retains only the target; observers/RAF start with start(). */
  attachBrowser(
    browser: PerformanceBrowser | undefined = typeof window === 'undefined'
      ? undefined
      : window,
  ): void {
    this.cleanupBrowser?.(true);
    this.cleanupBrowser = undefined;
    this.browser = browser;
    if (this.active) {
      this.captureEnvironment();
      this.activateBrowser();
    }
    this.notify();
  }

  detachBrowser(): void {
    this.cleanupBrowser?.(true);
    this.cleanupBrowser = undefined;
    this.browser = undefined;
    this.notify();
  }

  /** Returns an independent JSON-compatible snapshot; it does not poll or schedule work. */
  report(): PerformanceReport {
    const status = this.status();
    const ordered =
      this.buffer.length < this.capacity
        ? this.buffer
        : [
            ...this.buffer.slice(this.nextIndex),
            ...this.buffer.slice(0, this.nextIndex),
          ];
    const events = ordered.map((event) => ({
      ...event,
      data: { ...event.data },
    }));
    const metric = (kind: MeasuredKind): PerformanceMetricSummary => {
      const total = this.metrics[kind];
      const samples = events
        .filter((event) => event.kind === kind)
        .map((event) =>
          kind === 'input'
            ? (event.data.inputDelayMs as number)
            : (event.durationMs ?? 0),
        )
        .sort((a, b) => a - b);
      return {
        count: total.count,
        meanMs: total.count ? total.totalMs / total.count : null,
        worstMs: total.count ? total.worstMs : null,
        p95Ms: samples[Math.ceil(samples.length * 0.95) - 1] ?? null,
        retainedSamples: samples.length,
      };
    };
    return {
      version: 1,
      startedAt: status.startedAt,
      elapsedMs: status.elapsedMs,
      active: status.active,
      metadata: { ...this.metadata },
      environment: {
        ...this.environment,
        viewport: this.environment.viewport
          ? { ...this.environment.viewport }
          : null,
      },
      capabilities: { ...this.capabilities },
      capacity: this.capacity,
      recordedEvents: status.recordedEvents,
      droppedEvents: status.droppedEvents,
      events,
      summary: {
        p95Window: 'retained-events',
        inputEventDurationThresholdMs: 16,
        counts: { ...this.counts },
        frames: {
          ...metric('frame'),
          over50Ms: this.over50Ms,
          over100Ms: this.over100Ms,
        },
        inputDelay: metric('input'),
        longTasks: metric('longtask'),
        longAnimationFrames: metric('long-animation-frame'),
        activities: structuredClone([...this.activities.values()]),
        ungroupedActivityEvents: this.ungroupedActivityEvents,
      },
    };
  }

  private record(
    kind: PerformanceEventKind,
    name: string,
    time: number,
    durationMs: number | null,
    data: Dimensions,
  ): void {
    const event: PerformanceCaptureEvent = {
      sequence: ++this.recordedEvents,
      kind,
      name: name.slice(0, 160),
      atMs: Math.max(0, time - this.startTime),
      durationMs,
      data,
    };
    this.buffer[this.nextIndex] = event;
    this.nextIndex = (this.nextIndex + 1) % this.capacity;
    this.counts[kind]++;
    if (kind === 'event' || kind === 'span') {
      this.summarizeActivity(event);
      return;
    }
    const value = kind === 'input' ? (data.inputDelayMs as number) : durationMs;
    if (value === null) return;
    const metric = this.metrics[kind];
    metric.count++;
    metric.totalMs += value;
    metric.worstMs = Math.max(metric.worstMs, value);
    if (kind === 'frame') {
      if (value > 50) this.over50Ms++;
      if (value > 100) this.over100Ms++;
    }
  }

  private summarizeActivity(event: PerformanceCaptureEvent): void {
    const group: Dimensions = {};
    for (const key of ['purpose', 'dimension', 'cacheSource', 'priority']) {
      const value = event.data[key];
      if (value !== undefined) group[key] = value;
    }
    const key = JSON.stringify([event.name, group]);
    let activity = this.activities.get(key);
    if (!activity) {
      if (this.activities.size >= 64) {
        this.ungroupedActivityEvents++;
        return;
      }
      activity = {
        name: event.name,
        dimensions: group,
        count: 0,
        timedCount: 0,
        totalDurationMs: 0,
        worst: null,
        latest: event,
      };
      this.activities.set(key, activity);
    }
    activity.count++;
    activity.latest = event;
    if (event.durationMs === null) return;
    activity.timedCount++;
    activity.totalDurationMs += event.durationMs;
    if (
      activity.worst === null ||
      event.durationMs > (activity.worst.durationMs ?? 0)
    )
      activity.worst = event;
  }

  private notify(): void {
    if (!this.listeners.size) return;
    const status = this.status();
    for (const listener of this.listeners) listener(status);
  }

  private captureEnvironment(): void {
    const browser = this.browser;
    this.environment = {
      userAgent: browser?.navigator?.userAgent.slice(0, 512) ?? null,
      platform: browser?.navigator?.platform.slice(0, 160) ?? null,
      viewport:
        browser?.innerWidth !== undefined && browser.innerHeight !== undefined
          ? { width: browser.innerWidth, height: browser.innerHeight }
          : null,
      devicePixelRatio: browser?.devicePixelRatio ?? null,
    };
  }

  private activateBrowser(): void {
    const browser = this.browser;
    if (!browser) return;
    let enabled = true;
    let frameId: number | undefined;
    let previousFrame: number | undefined;
    const observers: TimingObserver[] = [];
    const framesSupported =
      browser.requestAnimationFrame !== undefined &&
      browser.cancelAnimationFrame !== undefined;
    this.capabilities.frame = framesSupported ? 'supported' : 'unsupported';
    const scheduleFrame = () => {
      if (
        enabled &&
        this.active &&
        framesSupported &&
        browser.document.visibilityState === 'visible'
      ) {
        frameId = browser.requestAnimationFrame?.(frame);
      }
    };
    const frame: FrameRequestCallback = (time) => {
      frameId = undefined;
      if (!enabled || !this.active) return;
      if (browser.document.visibilityState !== 'visible') {
        previousFrame = undefined;
        return;
      }
      if (previousFrame !== undefined) {
        this.record(
          'frame',
          'frame.gap',
          time,
          Math.max(0, time - previousFrame),
          {},
        );
      }
      previousFrame = time;
      scheduleFrame();
    };
    const visibility = () => {
      if (frameId !== undefined) browser.cancelAnimationFrame?.(frameId);
      frameId = undefined;
      previousFrame = undefined;
      scheduleFrame();
    };
    if (framesSupported) {
      browser.document.addEventListener('visibilitychange', visibility);
      scheduleFrame();
    }

    const capture = (entries: BrowserTimingEntry[]) => {
      if (!enabled || !this.active) return;
      const endTime = this.now();
      for (const entry of entries) {
        if (entry.startTime < this.startTime || entry.startTime > endTime)
          continue;
        if (
          entry.entryType === 'event' &&
          entry.processingStart !== undefined
        ) {
          const data: Dimensions = {
            inputDelayMs: Math.max(0, entry.processingStart - entry.startTime),
          };
          if (entry.processingEnd !== undefined) {
            data.processingMs = Math.max(
              0,
              entry.processingEnd - entry.processingStart,
            );
          }
          if (entry.interactionId !== undefined)
            data.interactionId = entry.interactionId;
          this.record(
            'input',
            entry.name,
            entry.startTime,
            entry.duration,
            data,
          );
        } else if (entry.entryType === 'longtask') {
          this.record(
            'longtask',
            'browser.longtask',
            entry.startTime,
            entry.duration,
            {},
          );
        } else if (entry.entryType === 'long-animation-frame') {
          this.record(
            'long-animation-frame',
            'browser.long-animation-frame',
            entry.startTime,
            entry.duration,
            entry.blockingDuration === undefined
              ? {}
              : { blockingDurationMs: entry.blockingDuration },
          );
        }
      }
    };
    const Observer = browser.PerformanceObserver;
    for (const [type, kind] of [
      ['event', 'input'],
      ['longtask', 'longtask'],
      ['long-animation-frame', 'long-animation-frame'],
    ] as const) {
      this.capabilities[kind] = 'unsupported';
      if (!Observer?.supportedEntryTypes?.includes(type)) continue;
      let observer: TimingObserver | undefined;
      try {
        observer = new Observer((list) => {
          capture(list.getEntries());
        });
        observer.observe(
          type === 'event'
            ? { type, buffered: false, durationThreshold: 16 }
            : { type, buffered: false },
        );
        observers.push(observer);
        this.capabilities[kind] = 'supported';
      } catch {
        observer?.disconnect();
        this.capabilities[kind] = 'unavailable';
      }
    }
    this.cleanupBrowser = (drain) => {
      if (drain)
        for (const observer of observers) capture(observer.takeRecords());
      enabled = false;
      if (frameId !== undefined) browser.cancelAnimationFrame?.(frameId);
      if (framesSupported)
        browser.document.removeEventListener('visibilitychange', visibility);
      for (const observer of observers) observer.disconnect();
    };
  }
}
