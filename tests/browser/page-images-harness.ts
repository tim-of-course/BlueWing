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

function png(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Fixture PNG encoding failed'));
    }, 'image/png');
  }).then(async (blob) => new Uint8Array(await blob.arrayBuffer()));
}

async function raster(canvas: HTMLCanvasElement, dimension: number) {
  const bitmap = await createImageBitmap(canvas);
  let preview: HTMLCanvasElement | undefined;
  let previewBitmap: ImageBitmap | undefined;
  if (dimension === PAGE_IMAGE_DIMENSION) {
    preview = document.createElement('canvas');
    const scale =
      PAGE_PREVIEW_DIMENSION / Math.max(canvas.width, canvas.height);
    preview.width = Math.ceil(canvas.width * scale);
    preview.height = Math.ceil(canvas.height * scale);
    const context = preview.getContext('2d');
    if (!context) throw new Error('Fixture preview context unavailable');
    context.drawImage(canvas, 0, 0, preview.width, preview.height);
    previewBitmap = await createImageBitmap(preview);
  }
  const encoded = Promise.all([
    png(canvas),
    preview ? png(preview) : undefined,
  ]).then(([bytes, previewBytes]) => ({
    bytes,
    ...(previewBytes ? { previewBytes } : {}),
  }));
  return { bitmap, ...(previewBitmap ? { previewBitmap } : {}), encoded };
}

function pixels(canvas: HTMLCanvasElement | ImageBitmap) {
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
  const calls: {
    id: string;
    pageIndex: number;
    dimension: number;
    priority: number;
  }[] = [];
  const render: ConstructorParameters<typeof PageImages>[0] = (
    source,
    dimension,
    _signal,
    _paused,
    priority,
  ) => {
    calls.push({
      id: source.id,
      pageIndex: source.pageIndex,
      dimension,
      priority: priority(),
    });
    return raster(draw(source, dimension), dimension);
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

async function leaseLifetime() {
  const store = new MemoryStore();
  const fake = renderer();
  const images = new PageImages(
    fake.render,
    store,
    PAGE_IMAGE_DIMENSION * 33 * 4,
  );
  const a = sheet('a');
  const first = await images.acquire(a);
  const second = await images.acquire(a);
  try {
    const sameSource = first.source === second.source;
    const original = pixels(first.source);
    await store.written(a, PAGE_IMAGE_DIMENSION);
    const other = await images.acquire(sheet('b'));
    other.release();
    const afterEviction = pixels(first.source);
    const reloaded = await images.acquire(a);
    reloaded.release();
    const readsOfA = store.reads.filter(
      (key) => key === pageImageKey(a, PAGE_IMAGE_DIMENSION),
    ).length;
    images.clear();
    const afterClear = pixels(first.source);
    first.release();
    first.release();
    const surviving = pixels(second.source);
    second.release();
    return {
      original,
      afterEviction,
      afterClear,
      surviving,
      sameSource,
      readsOfA,
      released: second.source.width === 0,
      calls: fake.calls.length,
    };
  } finally {
    first.release();
    second.release();
    images.clear();
  }
}

async function displayBeforeEncoding() {
  const store = new MemoryStore();
  const encode = gate();
  const fake = renderer();
  const images = new PageImages(async (...args) => {
    const output = await fake.render(...args);
    return { ...output, encoded: encode.promise.then(() => output.encoded) };
  }, store);
  const a = sheet('a');
  try {
    const full = images.acquire(a);
    let previewFinished = false;
    const preview = images.preview(a).then((bytes) => {
      previewFinished = true;
      return bytes;
    });
    const lease = await full;
    try {
      const visible = pixels(lease.source);
      const thumbnail = await images.acquire(a, PAGE_PREVIEW_DIMENSION);
      const previewPixels = pixels(thumbnail.source);
      thumbnail.release();
      await nextTask();
      const pending = !previewFinished;
      const writesBeforeEncoding = store.writes.length;
      encode.open();
      const bytes = await preview;
      await Promise.all([
        store.written(a, PAGE_IMAGE_DIMENSION),
        store.written(a, PAGE_PREVIEW_DIMENSION),
      ]);
      return {
        visible,
        previewPixels,
        pending,
        writesBeforeEncoding,
        header: [...bytes.slice(0, 8)],
        calls: fake.calls,
        writes: store.writes.length,
      };
    } finally {
      lease.release();
    }
  } finally {
    encode.open();
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
async function previewRecovery(failure: 'missing' | 'corrupt') {
  const store = new MemoryStore();
  const fake = renderer();
  const a = sheet('a');
  const images = new PageImages(fake.render, store);
  const reopened = new PageImages(
    () => Promise.reject(new Error('Preview recovery opened the PDF')),
    store,
  );
  try {
    const lease = await images.acquire(a);
    lease.release();
    await Promise.all([
      store.written(a, PAGE_IMAGE_DIMENSION),
      store.written(a, PAGE_PREVIEW_DIMENSION),
    ]);
    images.clear();
    const previewKey = pageImageKey(a, PAGE_PREVIEW_DIMENSION);
    if (failure === 'missing') store.bytes.delete(previewKey);
    else store.bytes.set(previewKey, new Uint8Array([0, 1, 2, 3]));
    const writesBeforeRecovery = store.writes.length;
    // A concurrent full disk hit must still let the preview request recover
    // separately from the saved full PNG, without another PDF operator pass.
    const [full, preview] = await Promise.all([
      reopened.acquire(a),
      reopened.preview(a),
    ]);
    try {
      const bitmap = await createImageBitmap(
        new Blob([preview.slice().buffer], { type: 'image/png' }),
      );
      try {
        const previewPixels = pixels(bitmap);
        await until(() => store.writes.length > writesBeforeRecovery);
        return {
          full: pixels(full.source),
          preview: previewPixels,
          calls: fake.calls.length,
          writes: store.writes.length - writesBeforeRecovery,
          header: [...preview.slice(0, 8)],
        };
      } finally {
        bitmap.close();
      }
    } finally {
      full.release();
    }
  } finally {
    images.clear();
    reopened.clear();
  }
}

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
    return raster(draw(source, dimension), dimension);
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
  let oldRaster: Awaited<ReturnType<typeof raster>> | undefined;
  let calls = 0;
  const images = new PageImages(async (source, dimension, signal) => {
    calls++;
    if (calls !== 1)
      return raster(draw(source, dimension, [...palettes[1]]), dimension);
    oldRaster = await raster(draw(source, dimension), dimension);
    signal.addEventListener(
      'abort',
      () => {
        aborted.open();
      },
      { once: true },
    );
    started.open();
    // Simulate a worker transferring an old bitmap after cancellation.
    await release.promise;
    return oldRaster;
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
    await until(() => oldRaster?.bitmap.width === 0);
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
        oldBitmapReleased:
          oldRaster?.bitmap.width === 0 && oldRaster.bitmap.height === 0,
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
  const deadline = performance.now() + 10_000;
  while (!ready()) {
    if (performance.now() > deadline)
      throw new Error('Image fixture did not settle');
    await nextTask();
  }
}

async function clearPreparation() {
  const store = new MemoryStore();
  const started = gate();
  const aborted = gate();
  const release = gate();
  let oldRaster: Awaited<ReturnType<typeof raster>> | undefined;
  const calls: string[] = [];
  const images = new PageImages(async (source, dimension, signal) => {
    calls.push(source.id);
    if (calls.length !== 1)
      return raster(draw(source, dimension, [...palettes[1]]), dimension);
    oldRaster = await raster(draw(source, dimension), dimension);
    signal.addEventListener(
      'abort',
      () => {
        aborted.open();
      },
      { once: true },
    );
    started.open();
    await release.promise;
    return oldRaster;
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
    await until(() => oldRaster?.bitmap.width === 0);
    return {
      fresh,
      cached: pixels(await images.render(a, PAGE_IMAGE_DIMENSION)),
      calls,
      writes: store.writes.length,
      oldBitmapReleased:
        oldRaster?.bitmap.width === 0 && oldRaster.previewBitmap?.width === 0,
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
    await until(() => !images.status().running);
    const status = images.status();
    const previews = [];
    for (const source of sheets) {
      const bytes = await reopened.preview(source);
      const bitmap = await createImageBitmap(
        new Blob([bytes.slice().buffer], { type: 'image/png' }),
      );
      try {
        previews.push(pixels(bitmap));
      } finally {
        bitmap.close();
      }
    }
    return {
      calls: fake.calls,
      previews,
      pngCount: store.bytes.size,
      status,
    };
  } finally {
    images.clear();
    reopened.clear();
  }
}

async function preparationProgress() {
  const store = new MemoryStore();
  const started = gate();
  const encode = gate();
  const fake = renderer();
  const images = new PageImages(async (...args) => {
    const output = await fake.render(...args);
    if (fake.calls.length !== 1) return output;
    started.open();
    return { ...output, encoded: encode.promise.then(() => output.encoded) };
  }, store);
  const statuses: ReturnType<PageImages['status']>[] = [];
  const unsubscribe = images.subscribe(() => statuses.push(images.status()));
  const a = sheet('a');
  const sheets = [a, sheet('b'), sheet('c')];
  try {
    images.setPreparationPaused(true);
    images.prepare(sheets, 'a');
    await nextTask();
    const queued = images.status();
    const callsWhilePaused = fake.calls.length;
    images.setPreparationPaused(false);
    await started.promise;
    const encoding = images.status();
    images.setPreparationPaused(true);
    encode.open();
    await until(() => images.status().completed === 1);
    const paused = images.status();
    const visible = await images.acquire(a);
    const selected = pixels(visible.source);
    visible.release();
    const callsBeforeResume = fake.calls.length;
    images.setPreparationPaused(false);
    await until(() => !images.status().running);
    return {
      queued,
      callsWhilePaused,
      encoding,
      paused,
      callsBeforeResume,
      selected,
      final: images.status(),
      statuses,
      calls: fake.calls,
    };
  } finally {
    encode.open();
    unsubscribe();
    images.clear();
  }
}

async function reusePreparation() {
  const store = new MemoryStore();
  const started = gate();
  const deliver = gate();
  const fake = renderer();
  let paused: (() => boolean) | undefined;
  let priority: (() => number) | undefined;
  let initialPriority: number | undefined;
  const images = new PageImages(async (...args) => {
    paused = args[3];
    priority = args[4];
    initialPriority = priority();
    started.open();
    await deliver.promise;
    return fake.render(...args);
  }, store);
  const a = sheet('a');
  try {
    images.prepare([a], a.id);
    await started.promise;
    const selected = images.acquire(a);
    await until(() => paused?.() === false);
    const pauseAfterReuse = paused?.();
    const priorityAfterReuse = priority?.();
    deliver.open();
    const lease = await selected;
    const visible = pixels(lease.source);
    lease.release();
    await store.written(a, PAGE_IMAGE_DIMENSION);
    await until(() => !images.status().running);
    return {
      pauseAfterReuse,
      initialPriority,
      priorityAfterReuse,
      visible,
      calls: fake.calls,
      status: images.status(),
    };
  } finally {
    deliver.open();
    images.clear();
  }
}

async function preparationFailure(failure: 'write' | 'encode') {
  const store = new MemoryStore();
  store.rejectWrites = failure === 'write';
  const encode = gate();
  const started = gate();
  const fake = renderer();
  const images = new PageImages(async (...args) => {
    const output = await fake.render(...args);
    started.open();
    return {
      ...output,
      encoded: encode.promise.then(() => {
        if (failure === 'encode')
          throw new Error('Fixture PNG encoding failed');
        return output.encoded;
      }),
    };
  }, store);
  const a = sheet('a');
  let lease: Awaited<ReturnType<PageImages['acquire']>> | undefined;
  try {
    images.prepare([a], a.id);
    await started.promise;
    lease = await images.acquire(a);
    const completedBeforeEncoding = images.status().completed;
    encode.open();
    await until(() => !images.status().running);
    const visible = pixels(lease.source);
    const cached = images.peek(a);
    const previewCached = Boolean(cached);
    cached?.release();
    const result = {
      completedBeforeEncoding,
      visible,
      previewCached,
      status: images.status(),
      calls: fake.calls.length,
      writes: store.writes.length,
      saved: store.bytes.size,
    };
    lease.release();
    images.clear();
    return { ...result, released: lease.source.width === 0 };
  } finally {
    encode.open();
    lease?.release();
    images.clear();
  }
}

async function backgroundProgress(userPause: boolean) {
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
    return raster(canvas, dimension);
  }, store);
  const background = sheet('background');
  try {
    images.prepare([background], background.id);
    await chunk.promise;
    images.deferPreparation();
    if (userPause) images.setPreparationPaused(true);
    const foreground = images.render(
      { ...sheet('foreground'), assetId: 'b' },
      64,
    );
    await foregroundStarted.promise;
    continueChunk.open();
    let finishedDuringUserPause: boolean | undefined;
    if (userPause) {
      await paused.promise;
      finishedDuringUserPause = backgroundFinished;
      images.setPreparationPaused(false);
    }
    await Promise.all([
      store.written(background, PAGE_IMAGE_DIMENSION),
      store.written(background, PAGE_PREVIEW_DIMENSION),
    ]);
    await until(() => images.status().completed === 1);
    const finishedWhileForegroundHeld = backgroundFinished;
    releaseForeground.open();
    const foregroundPixels = pixels(await foreground);
    await store.written(background, PAGE_IMAGE_DIMENSION);
    return {
      pauseObserved,
      firstChunk,
      finishedWhileForegroundHeld,
      finishedDuringUserPause,
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
  leaseLifetime,
  displayBeforeEncoding,
  diskReuse,
  diskFailure,
  previewRecovery,
  evictionAndChanges,
  sharedCancellation,
  cancellation,
  clearPreparation,
  preparation,
  preparationProgress,
  reusePreparation,
  preparationFailure,
  backgroundProgress,
};
export type PageImagesHarness = typeof harness;
Object.assign(window, { pageImages: harness });
