import type { Sheet } from '../../src/core/types';
import {
  PAGE_IMAGE_DIMENSION,
  PAGE_PREVIEW_DIMENSION,
  PageImages,
  pageImageKey,
  type PageImageStore,
} from '../../src/pdf/page-images';

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

class MemoryStore implements PageImageStore {
  readonly bytes = new Map<string, Uint8Array>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  private readonly waiting = new Map<string, ReturnType<typeof gate>>();
  readFailure: 'missing' | 'corrupt' | 'reject' | undefined;
  rejectWrites = false;

  read(key: string): Promise<Uint8Array | null> {
    this.reads.push(key);
    if (this.readFailure === 'reject')
      return Promise.reject(new Error('Cache read unavailable'));
    if (this.readFailure === 'corrupt')
      return Promise.resolve(new Uint8Array([0, 1, 2, 3]));
    if (this.readFailure === 'missing') return Promise.resolve(null);
    return Promise.resolve(this.bytes.get(key)?.slice() ?? null);
  }

  write(key: string, bytes: Uint8Array): Promise<void> {
    this.writes.push(key);
    if (!this.rejectWrites) this.bytes.set(key, bytes.slice());
    this.waiting.get(key)?.open();
    return this.rejectWrites
      ? Promise.reject(new Error('Cache disk full'))
      : Promise.resolve();
  }

  exists(key: string): Promise<boolean> {
    return Promise.resolve(this.bytes.has(key));
  }

  written(sheet: Sheet, dimension: number): Promise<void> {
    const key = pageImageKey(sheet, dimension);
    if (this.writes.includes(key)) return Promise.resolve();
    let waiting = this.waiting.get(key);
    if (!waiting) {
      waiting = gate();
      this.waiting.set(key, waiting);
    }
    return waiting.promise;
  }
}

function sheet(id: string, pageIndex = 0): Sheet {
  return { id, name: id, assetId: id, pageIndex, width: 100, height: 1 };
}

const palettes = [
  ['#ff0000', '#0000ff'],
  ['#00ff00', '#ff00ff'],
  ['#ffff00', '#00ffff'],
] as const;

function colors(source: Sheet): readonly [string, string] {
  const asset =
    source.assetId === 'b' ? 1 : source.assetId === 'changed' ? 2 : 0;
  const pair =
    palettes[(asset + source.pageIndex) % palettes.length] ?? palettes[0];
  return source.rotation ? [pair[1], pair[0]] : pair;
}

function draw(source: Sheet, dimension: number, pair = colors(source)) {
  const canvas = document.createElement('canvas');
  const scale = dimension / Math.max(source.width, source.height);
  canvas.width = Math.ceil(source.width * scale);
  canvas.height = Math.ceil(source.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Page image fixture context unavailable');
  context.fillStyle = pair[0];
  context.fillRect(0, 0, canvas.width / 2, canvas.height);
  context.fillStyle = pair[1];
  context.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);
  return canvas;
}

function pixels(canvas: HTMLCanvasElement) {
  // Read a tiny test-owned buffer, not a production GPU canvas repeatedly.
  const probe = document.createElement('canvas');
  probe.width = 2;
  probe.height = 1;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Page image pixel context unavailable');
  context.drawImage(canvas, Math.floor(canvas.width / 4), 0, 1, 1, 0, 0, 1, 1);
  context.drawImage(
    canvas,
    Math.floor((canvas.width * 3) / 4),
    0,
    1,
    1,
    1,
    0,
    1,
    1,
  );
  const data = context.getImageData(0, 0, 2, 1).data;
  return {
    width: canvas.width,
    height: canvas.height,
    left: [...data.slice(0, 4)],
    right: [...data.slice(4, 8)],
  };
}

function renderer() {
  const calls: { id: string; pageIndex: number; dimension: number }[] = [];
  const render = (source: Sheet, dimension: number) => {
    calls.push({ id: source.id, pageIndex: source.pageIndex, dimension });
    return Promise.resolve(draw(source, dimension));
  };
  return { calls, render };
}

async function ownership() {
  const fake = renderer();
  const images = new PageImages(fake.render);
  const a = sheet('a');
  const b = sheet('b');
  try {
    const first = await images.render(a, 64);
    const original = pixels(first);
    const context = first.getContext('2d');
    if (!context) throw new Error('Page image fixture context unavailable');
    context.clearRect(0, 0, first.width, first.height);
    const mutated = pixels(await images.render(a, 64));
    first.width = first.height = 0;
    const other = pixels(await images.render(b, 64));
    const returned = await images.render(a, 64);
    const revisited = pixels(returned);
    const simultaneous = await images.render(a, 64);
    returned.width = returned.height = 0;
    return {
      original,
      mutated,
      other,
      revisited,
      simultaneous: pixels(simultaneous),
      distinct: returned !== first && simultaneous !== returned,
      calls: fake.calls,
    };
  } finally {
    images.clear();
  }
}

async function diskReuse() {
  const store = new MemoryStore();
  const fake = renderer();
  const a = sheet('a');
  const images = new PageImages(fake.render, store);
  const reopened = new PageImages(fake.render, store);
  try {
    const original = await images.render(a, PAGE_IMAGE_DIMENSION);
    const expected = pixels(original);
    await Promise.all([
      store.written(a, PAGE_IMAGE_DIMENSION),
      store.written(a, PAGE_PREVIEW_DIMENSION),
    ]);
    original.width = original.height = 0;
    images.clear();
    const preview = pixels(await reopened.render(a, PAGE_PREVIEW_DIMENSION));
    const full = pixels(await reopened.render(a, PAGE_IMAGE_DIMENSION));
    return {
      expected,
      full,
      preview,
      calls: fake.calls,
      pngHeaders: [...store.bytes.values()].map((bytes) => [
        ...bytes.slice(0, 8),
      ]),
      reads: store.reads.length,
    };
  } finally {
    images.clear();
    reopened.clear();
  }
}

type DiskFailure = 'missing' | 'corrupt' | 'reject-read' | 'reject-write';
async function diskFailure(failure: DiskFailure) {
  const store = new MemoryStore();
  store.readFailure =
    failure === 'reject-read'
      ? 'reject'
      : failure === 'reject-write'
        ? undefined
        : failure;
  store.rejectWrites = failure === 'reject-write';
  const fake = renderer();
  const a = sheet('a');
  const images = new PageImages(fake.render, store);
  try {
    const rendered = pixels(await images.render(a, 64));
    await store.written(a, 64);
    const cached = pixels(await images.render(a, 64));
    return {
      rendered,
      cached,
      calls: fake.calls.length,
      reads: store.reads.length,
      writes: store.writes.length,
      saved: store.bytes.size,
    };
  } finally {
    images.clear();
  }
}

async function evictionAndChanges() {
  const store = new MemoryStore();
  const fake = renderer();
  const a = sheet('a');
  const b = sheet('b');
  const fullBytes = PAGE_IMAGE_DIMENSION * 33 * 4;
  const images = new PageImages(fake.render, store, fullBytes);
  try {
    const first = await images.render(a, PAGE_IMAGE_DIMENSION);
    await store.written(a, PAGE_IMAGE_DIMENSION);
    await images.render(b, PAGE_IMAGE_DIMENSION);
    await store.written(b, PAGE_IMAGE_DIMENSION);
    const reloaded = pixels(await images.render(a, PAGE_IMAGE_DIMENSION));
    const metadata = {
      ...a,
      id: 'renamed-sheet',
      name: 'New takeoff name',
      order: 42,
      calibration: { metresPerUnit: 0.75 },
    };
    const renamed = pixels(await images.render(metadata, PAGE_IMAGE_DIMENSION));
    const callsAfterMetadata = fake.calls.length;
    const changed = [];
    for (const [source, dimension] of [
      [{ ...a, assetId: 'changed' }, PAGE_IMAGE_DIMENSION],
      [{ ...a, pageIndex: 1 }, PAGE_IMAGE_DIMENSION],
      [{ ...a, rotation: 180 }, PAGE_IMAGE_DIMENSION],
      [{ ...a, height: 2 }, PAGE_IMAGE_DIMENSION],
      [{ ...a, width: 50 }, PAGE_IMAGE_DIMENSION],
      [a, 128],
    ] as const) {
      changed.push(pixels(await images.render(source, dimension)));
    }
    return {
      reloaded,
      retainedCaller: pixels(first),
      renamed,
      callsAfterMetadata,
      readsOfA: store.reads.filter(
        (key) => key === pageImageKey(a, PAGE_IMAGE_DIMENSION),
      ).length,
      changed,
      calls: fake.calls.length,
    };
  } finally {
    images.clear();
  }
}

async function sharedCancellation() {
  const started = gate();
  const release = gate();
  let renderSignal: AbortSignal | undefined;
  let calls = 0;
  const images = new PageImages(async (source, dimension, signal) => {
    calls++;
    renderSignal = signal;
    started.open();
    await release.promise;
    signal.throwIfAborted();
    return draw(source, dimension);
  });
  const cancel = new AbortController();
  try {
    const first = images.render(sheet('a'), 64, cancel.signal).then(
      () => 'completed',
      () => 'cancelled',
    );
    const second = images.render(sheet('a'), 64);
    await started.promise;
    cancel.abort();
    const outcome = await first;
    const workAborted = renderSignal?.aborted;
    release.open();
    const surviving = pixels(await second);
    const cached = pixels(await images.render(sheet('a'), 64));
    return { outcome, workAborted, surviving, cached, calls };
  } finally {
    release.open();
    images.clear();
  }
}

async function cancellation(action: 'abort' | 'clear') {
  const store = new MemoryStore();
  const started = gate();
  const aborted = gate();
  const release = gate();
  let oldCanvas: HTMLCanvasElement | undefined;
  let calls = 0;
  const images = new PageImages(async (source, dimension, signal) => {
    calls++;
    if (calls !== 1) return draw(source, dimension, [...palettes[1]]);
    oldCanvas = draw(source, dimension);
    signal.addEventListener(
      'abort',
      () => {
        aborted.open();
      },
      { once: true },
    );
    started.open();
    // Simulate a PDF continuation delivering its old canvas after cancellation.
    await release.promise;
    return oldCanvas;
  }, store);
  const firstController = new AbortController();
  const secondController = new AbortController();
  try {
    const outcomes = [firstController, secondController].map((controller) =>
      images.render(sheet('a'), 64, controller.signal).then(
        () => 'completed',
        () => 'cancelled',
      ),
    );
    await started.promise;
    if (action === 'clear') images.clear();
    else {
      firstController.abort();
      secondController.abort();
    }
    await aborted.promise;
    const fresh = pixels(await images.render(sheet('a'), 64));
    await store.written(sheet('a'), 64);
    release.open();
    const settled = await Promise.all(outcomes);
    // Flush the cancelled job even when its consumers already rejected.
    await until(() => oldCanvas?.width === 0);
    const cached = pixels(await images.render(sheet('a'), 64));
    const reopened = new PageImages(
      () => Promise.reject(new Error('Fresh disk image was not reusable')),
      store,
    );
    try {
      return {
        settled,
        fresh,
        cached,
        disk: pixels(await reopened.render(sheet('a'), 64)),
        oldCanvasReleased: oldCanvas?.width === 0 && oldCanvas.height === 0,
        calls,
        writes: store.writes.length,
      };
    } finally {
      reopened.clear();
    }
  } finally {
    release.open();
    images.clear();
  }
}

function nextTask() {
  return new Promise<void>((resolve) => setTimeout(resolve, 10));
}

async function until(ready: () => boolean) {
  while (!ready()) await nextTask();
}

async function clearPreparation() {
  const store = new MemoryStore();
  const started = gate();
  const aborted = gate();
  const release = gate();
  let oldCanvas: HTMLCanvasElement | undefined;
  const calls: string[] = [];
  const images = new PageImages(async (source, dimension, signal) => {
    calls.push(source.id);
    if (calls.length !== 1) return draw(source, dimension, [...palettes[1]]);
    oldCanvas = draw(source, dimension);
    signal.addEventListener(
      'abort',
      () => {
        aborted.open();
      },
      { once: true },
    );
    started.open();
    await release.promise;
    return oldCanvas;
  }, store);
  const a = sheet('a');
  try {
    images.prepare([a, sheet('b'), sheet('c')], a.id);
    await started.promise;
    images.clear();
    await aborted.promise;
    const fresh = pixels(await images.render(a, PAGE_IMAGE_DIMENSION));
    await Promise.all([
      store.written(a, PAGE_IMAGE_DIMENSION),
      store.written(a, PAGE_PREVIEW_DIMENSION),
    ]);
    release.open();
    await until(() => oldCanvas?.width === 0);
    return {
      fresh,
      cached: pixels(await images.render(a, PAGE_IMAGE_DIMENSION)),
      calls,
      writes: store.writes.length,
      oldCanvasReleased: oldCanvas?.width === 0,
    };
  } finally {
    release.open();
    images.clear();
  }
}

async function preparation() {
  const store = new MemoryStore();
  const fake = renderer();
  const sheets = Array.from({ length: 5 }, (_, index) => ({
    ...sheet(`page-${String(index)}`, index),
    assetId: 'a',
    order: index,
  }));
  const images = new PageImages(fake.render, store);
  const reopened = new PageImages(fake.render, store);
  try {
    const active = sheets[2];
    if (!active) throw new Error('Active page fixture missing');
    images.prepare([...sheets].reverse(), active.id);
    await Promise.all(
      sheets.flatMap((source) => [
        store.written(source, PAGE_IMAGE_DIMENSION),
        store.written(source, PAGE_PREVIEW_DIMENSION),
      ]),
    );
    const previews = [];
    for (const source of sheets)
      previews.push(
        pixels(await reopened.render(source, PAGE_PREVIEW_DIMENSION)),
      );
    return {
      calls: fake.calls,
      previews,
      pngCount: store.bytes.size,
    };
  } finally {
    images.clear();
    reopened.clear();
  }
}

async function foregroundPriority() {
  const store = new MemoryStore();
  const chunk = gate();
  const continueChunk = gate();
  const paused = gate();
  const foregroundStarted = gate();
  const releaseForeground = gate();
  const events: string[] = [];
  let backgroundFinished = false;
  let pauseObserved = false;
  let backgroundSignal: AbortSignal | undefined;
  let firstChunk: ReturnType<typeof pixels> | undefined;
  const images = new PageImages(async (source, dimension, signal, isPaused) => {
    const canvas = draw(source, dimension);
    events.push(`${source.id}:start`);
    if (source.id === 'foreground') {
      foregroundStarted.open();
      await releaseForeground.promise;
    } else {
      backgroundSignal = signal;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Page image fixture context unavailable');
      context.clearRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);
      firstChunk = pixels(canvas);
      chunk.open();
      await continueChunk.promise;
      while (isPaused()) {
        pauseObserved = true;
        paused.open();
        await nextTask();
        signal.throwIfAborted();
      }
      events.push('background:resume');
      context.fillStyle = colors(source)[1];
      context.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);
      backgroundFinished = true;
    }
    events.push(`${source.id}:end`);
    return canvas;
  }, store);
  const background = sheet('background');
  try {
    images.prepare([background], background.id);
    await chunk.promise;
    images.deferPreparation();
    const foreground = images.render(
      { ...sheet('foreground'), assetId: 'b' },
      64,
    );
    await foregroundStarted.promise;
    continueChunk.open();
    await paused.promise;
    const finishedWhileForegroundHeld = backgroundFinished;
    releaseForeground.open();
    const foregroundPixels = pixels(await foreground);
    await store.written(background, PAGE_IMAGE_DIMENSION);
    return {
      pauseObserved,
      firstChunk,
      finishedWhileForegroundHeld,
      backgroundAborted: backgroundSignal?.aborted,
      foreground: foregroundPixels,
      background: pixels(await images.render(background, PAGE_IMAGE_DIMENSION)),
      events,
    };
  } finally {
    continueChunk.open();
    releaseForeground.open();
    images.clear();
  }
}

const harness = {
  ownership,
  diskReuse,
  diskFailure,
  evictionAndChanges,
  sharedCancellation,
  cancellation,
  clearPreparation,
  preparation,
  foregroundPriority,
};
export type PageImagesHarness = typeof harness;
Object.assign(window, { pageImages: harness });
