import { getDocument, GlobalWorkerOptions, version } from 'pdfjs-dist';
import { PdfDocuments } from '../../src/pdf/documents';
import type { Sheet } from '../../src/core/types';
import type { AssetRange } from '../../src/platform/storage-model';
import {
  embeddedFontPdf,
  rotatedCropPdf,
  sparsePdf,
  thinPdf,
  transferPdf,
  transparencyPdf,
  viewAnnotationPdf,
  vectorPdf,
} from './pdf-fixtures';

function pixels(source: HTMLCanvasElement | ImageBitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('PDF pixel context unavailable');
  context.drawImage(source, 0, 0);
  return {
    width: canvas.width,
    height: canvas.height,
    left: [
      ...context.getImageData(canvas.width / 4, canvas.height / 2, 1, 1).data,
    ],
    right: [
      ...context.getImageData((canvas.width * 3) / 4, canvas.height / 2, 1, 1)
        .data,
    ],
  };
}

async function rasterPixels(pdf: PdfDocuments, sheet: Sheet, dimension = 64) {
  const result = await pdf.raster(sheet, dimension);
  try {
    const image = pixels(result.bitmap);
    await result.encoded;
    return image;
  } finally {
    result.bitmap.close();
    result.previewBitmap?.close();
  }
}

async function yielding() {
  const bytes = vectorPdf();
  const pdf = new PdfDocuments(() => Promise.resolve(bytes.slice()));
  const [sheet] = await pdf.import('plan', 'Vector plan.pdf', bytes);
  if (!sheet) throw new Error('PDF fixture has no page');
  const calls = {
    fill: 0,
    text: 0,
    image: 0,
    read: 0,
    write: 0,
    encode: 0,
    offscreenContext: 0,
    offscreenEncode: 0,
  };
  const capture = <K extends keyof CanvasRenderingContext2D>(key: K) =>
    Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, key)
      ?.value as CanvasRenderingContext2D[K];
  const original = {
    fill: capture('fill'),
    text: capture('fillText'),
    image: capture('drawImage'),
    read: capture('getImageData'),
    write: capture('putImageData'),
    encode: Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      'toBlob',
    )?.value as HTMLCanvasElement['toBlob'],
    offscreenContext: Object.getOwnPropertyDescriptor(
      OffscreenCanvas.prototype,
      'getContext',
    )?.value as OffscreenCanvas['getContext'],
    offscreenEncode: Object.getOwnPropertyDescriptor(
      OffscreenCanvas.prototype,
      'convertToBlob',
    )?.value as OffscreenCanvas['convertToBlob'],
  };
  // Observe the UI realm only. Worker, fonts, and filters are native and untouched.
  CanvasRenderingContext2D.prototype.fill = new Proxy(original.fill, {
    apply(target, receiver, args) {
      calls.fill++;
      Reflect.apply(target, receiver, args);
    },
  });
  CanvasRenderingContext2D.prototype.fillText = function (...args) {
    calls.text++;
    original.text.apply(this, args);
  };
  CanvasRenderingContext2D.prototype.drawImage = new Proxy(original.image, {
    apply(target, receiver, args) {
      calls.image++;
      Reflect.apply(target, receiver, args);
    },
  });
  CanvasRenderingContext2D.prototype.getImageData = function (...args) {
    calls.read++;
    return original.read.apply(this, args);
  };
  CanvasRenderingContext2D.prototype.putImageData = new Proxy(original.write, {
    apply(target, receiver, args) {
      calls.write++;
      Reflect.apply(target, receiver, args);
    },
  });
  HTMLCanvasElement.prototype.toBlob = function (...args) {
    calls.encode++;
    original.encode.apply(this, args);
  };
  OffscreenCanvas.prototype.getContext = new Proxy(original.offscreenContext, {
    apply(target, receiver, args) {
      calls.offscreenContext++;
      return Reflect.apply(target, receiver, args) as ReturnType<typeof target>;
    },
  });
  OffscreenCanvas.prototype.convertToBlob = function (...args) {
    calls.offscreenEncode++;
    return original.offscreenEncode.apply(this, args);
  };
  const restore = () => {
    CanvasRenderingContext2D.prototype.fill = original.fill;
    CanvasRenderingContext2D.prototype.fillText = original.text;
    CanvasRenderingContext2D.prototype.drawImage = original.image;
    CanvasRenderingContext2D.prototype.getImageData = original.read;
    CanvasRenderingContext2D.prototype.putImageData = original.write;
    HTMLCanvasElement.prototype.toBlob = original.encode;
    OffscreenCanvas.prototype.getContext = original.offscreenContext;
    OffscreenCanvas.prototype.convertToBlob = original.offscreenEncode;
  };
  const input = document.createElement('input');
  let settled = false;
  let inputDuringRender = false;
  input.addEventListener('input', () => {
    inputDuringRender = !settled;
  });
  const timer = setTimeout(() => input.dispatchEvent(new Event('input')), 0);
  try {
    const result = await pdf.raster(sheet, 128);
    let encoded = false;
    void result.encoded.then(() => {
      encoded = true;
    });
    await Promise.resolve();
    const displayBeforeEncoding = !encoded;
    await result.encoded;
    settled = true;
    const uiCalls = { ...calls };
    restore();
    try {
      return {
        ...pixels(result.bitmap),
        inputDuringRender,
        displayBeforeEncoding,
        uiCalls,
      };
    } finally {
      result.bitmap.close();
      result.previewBitmap?.close();
    }
  } finally {
    settled = true;
    clearTimeout(timer);
    restore();
    await pdf.clear();
  }
}

async function cancellation(action: 'release' | 'clear') {
  const bytes = vectorPdf();
  let reads = 0;
  const pdf = new PdfDocuments(() => {
    reads++;
    return Promise.resolve(bytes.slice());
  });
  const [sheet] = await pdf.import('plan', 'Vector plan.pdf', bytes);
  if (!sheet) throw new Error('PDF fixture has no page');
  try {
    let requested!: () => void;
    const started = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const outcomes = [64, 128].map((dimension) =>
      pdf
        .raster(sheet, dimension, undefined, () => {
          requested();
          return true;
        })
        .then(
          (result) => {
            result.bitmap.close();
            result.previewBitmap?.close();
            return 'completed';
          },
          () => 'cancelled',
        ),
    );
    await started;
    if (action === 'release') await pdf.release('plan');
    else await pdf.clear();
    const settled = await Promise.all(outcomes);
    const reloaded = await rasterPixels(pdf, sheet);
    return { settled, reads, reloaded };
  } finally {
    await pdf.clear();
  }
}

async function cancelEncoding(action: 'release' | 'clear') {
  const bytes = thinPdf();
  const pdf = new PdfDocuments(() => Promise.resolve(bytes.slice()));
  const [sheet] = await pdf.import('encoded', 'Vector plan.pdf', bytes);
  if (!sheet) throw new Error('PDF fixture has no page');
  try {
    const result = await pdf.raster(sheet, 3300);
    const outcome = result.encoded.then(
      () => 'completed',
      () => 'cancelled',
    );
    if (action === 'release') await pdf.release(sheet.assetId);
    else await pdf.clear();
    try {
      return {
        outcome: await outcome,
        retained: pixels(result.bitmap),
        preview: result.previewBitmap ? pixels(result.previewBitmap) : null,
        reopened: await rasterPixels(pdf, sheet),
      };
    } finally {
      result.bitmap.close();
      result.previewBitmap?.close();
    }
  } finally {
    await pdf.clear();
  }
}

async function fullPreview() {
  const bytes = thinPdf();
  const pdf = new PdfDocuments(() => Promise.resolve(bytes.slice()));
  try {
    const [sheet] = await pdf.import('preview', 'Thin page.pdf', bytes);
    if (!sheet) throw new Error('Missing preview fixture sheet');
    const result = await pdf.raster(sheet, 3300);
    try {
      if (!result.previewBitmap)
        throw new Error('Full PDF raster omitted its preview');
      const encoded = await result.encoded;
      if (!encoded.previewBytes)
        throw new Error('Full PDF raster omitted its preview PNG');
      const [full, preview] = await Promise.all([
        createImageBitmap(
          new Blob([encoded.bytes.slice().buffer], { type: 'image/png' }),
        ),
        createImageBitmap(
          new Blob([encoded.previewBytes.slice().buffer], {
            type: 'image/png',
          }),
        ),
      ]);
      try {
        return {
          full: pixels(result.bitmap),
          preview: pixels(result.previewBitmap),
          decodedFull: pixels(full),
          decodedPreview: pixels(preview),
          headers: [encoded.bytes, encoded.previewBytes].map((png) => [
            ...png.slice(0, 8),
          ]),
        };
      } finally {
        full.close();
        preview.close();
      }
    } finally {
      result.bitmap.close();
      result.previewBitmap?.close();
    }
  } finally {
    await pdf.clear();
  }
}

async function rangedRendering() {
  const source = sparsePdf();
  let opens = 0;
  const pdf = new PdfDocuments(() => {
    opens++;
    return Promise.resolve(source.range);
  });
  try {
    const [sheet] = await pdf.import('ranged', 'Sparse plan.pdf', source.range);
    if (!sheet) throw new Error('Range PDF fixture has no page');
    const first = pixels(await pdf.render(sheet, 64));
    const initialReads = source.reads.map((read) => ({ ...read }));
    await pdf.release('ranged');
    const reopened = pixels(await pdf.render(sheet, 64));
    return {
      first,
      reopened,
      initialReads,
      totalReads: source.reads.length,
      opens,
      length: source.range.length,
    };
  } finally {
    await pdf.clear();
  }
}

async function rangeFailure() {
  const source = sparsePdf();
  let failing = false,
    failures = 0,
    opens = 0;
  const range: AssetRange = {
    length: source.range.length,
    read(offset, length) {
      if (
        failing &&
        offset <= source.contentOffset &&
        offset + length > source.contentOffset
      ) {
        failures++;
        return Promise.reject(new Error('Fixture range read failed'));
      }
      return source.range.read(offset, length);
    },
  };
  const pdf = new PdfDocuments(() => {
    opens++;
    return Promise.resolve(range);
  });
  try {
    const [sheet] = await pdf.import('failure', 'Sparse plan.pdf', range);
    if (!sheet) throw new Error('Range PDF fixture has no page');
    failing = true;
    const failure = await pdf.render(sheet, 64).then(
      () => null,
      (error: unknown) =>
        error instanceof Error ? error.message : String(error),
    );
    failing = false;
    const opensBeforeRetry = opens;
    const recovered = pixels(await pdf.render(sheet, 64));
    return {
      failure,
      failures,
      opens,
      reopenedSources: opens - opensBeforeRetry,
      recovered,
    };
  } finally {
    await pdf.clear();
  }
}

async function cancelRange(action: 'release' | 'clear') {
  const source = sparsePdf();
  let markStarted!: () => void;
  let unblock!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const pdf = new PdfDocuments(() => Promise.resolve(source.range));
  const held: AssetRange = {
    length: source.range.length,
    read(offset, length) {
      markStarted();
      return blocked.then(() => source.range.read(offset, length));
    },
  };
  try {
    const importing = pdf.import('cancelled', 'Sparse plan.pdf', held).then(
      () => 'completed',
      () => 'cancelled',
    );
    await started;
    if (action === 'release') await pdf.release('cancelled');
    else await pdf.clear();
    const outcome = await importing;
    // Deliver the old read after cancellation while a fresh import owns this ID.
    const reopened = pdf.import('cancelled', 'Sparse plan.pdf', source.range);
    unblock();
    const [sheet] = await reopened;
    if (!sheet) throw new Error('Reopened range PDF fixture has no page');
    return { outcome, reopened: pixels(await pdf.render(sheet, 64)) };
  } finally {
    unblock();
    await pdf.clear();
  }
}

async function cancelRenderRange() {
  const source = sparsePdf();
  let markStarted!: () => void;
  let unblock!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const held: AssetRange = {
    length: source.range.length,
    read(offset, length) {
      if (
        offset <= source.contentOffset &&
        offset + length > source.contentOffset
      ) {
        markStarted();
        return blocked.then(() => source.range.read(offset, length));
      }
      return source.range.read(offset, length);
    },
  };
  const pdf = new PdfDocuments(() => Promise.resolve(source.range));
  try {
    const [sheet] = await pdf.import(
      'render-cancelled',
      'Sparse plan.pdf',
      held,
    );
    if (!sheet) throw new Error('Range PDF fixture has no page');
    const rendering = pdf.render(sheet, 64).then(
      () => 'completed',
      () => 'cancelled',
    );
    await started;
    // The worker is building its operator list and waiting for page content.
    // Teardown must finish while that source read remains blocked.
    await pdf.clear();
    const outcome = await rendering;
    const reopened = pdf.render(sheet, 64);
    unblock();
    return { outcome, reopened: pixels(await reopened) };
  } finally {
    unblock();
    await pdf.clear();
  }
}

function fixtureSheet(assetId: string): Sheet {
  return {
    id: assetId,
    assetId,
    name: assetId,
    pageIndex: 0,
    width: 64,
    height: 64,
  };
}

async function abortLoading() {
  const bytes = vectorPdf();
  let markStarted!: () => void;
  let unblock!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let opens = 0;
  const pdf = new PdfDocuments(async () => {
    opens++;
    if (opens === 1) {
      markStarted();
      await blocked;
    }
    return bytes.slice();
  });
  const controller = new AbortController();
  try {
    const rendering = pdf
      .render(fixtureSheet('aborted'), 64, controller.signal)
      .then(
        () => 'completed',
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
    await started;
    controller.abort(new Error('Superseded sheet'));
    // Cancellation must settle before the source responds, without waiting for I/O.
    const outcome = await rendering;
    const reopened = pdf.render(fixtureSheet('aborted'), 64);
    unblock();
    return { outcome, reopened: pixels(await reopened), opens };
  } finally {
    unblock();
    await pdf.clear();
  }
}

async function idleCache() {
  const bytes = vectorPdf();
  let markStarted!: () => void;
  let unblock!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const opens: Record<string, number> = {};
  const pdf = new PdfDocuments(async (id) => {
    opens[id] = (opens[id] ?? 0) + 1;
    if (id === 'pinned') {
      markStarted();
      await blocked;
    }
    return bytes.slice();
  });
  try {
    const pinned = rasterPixels(pdf, fixtureSheet('pinned'));
    await started;
    for (const id of ['a', 'b', 'c', 'b', 'c']) {
      await rasterPixels(pdf, fixtureSheet(id));
    }
    const cached = { ...opens };
    await rasterPixels(pdf, fixtureSheet('a'));
    unblock();
    return { cached, opens, pinned: await pinned };
  } finally {
    unblock();
    await pdf.clear();
  }
}

async function backgroundPause(cancel: boolean) {
  const bytes = vectorPdf();
  const pdf = new PdfDocuments(() => Promise.resolve(bytes.slice()));
  const [sheet] = await pdf.import('pause', 'Vector plan.pdf', bytes);
  if (!sheet) throw new Error('PDF fixture has no page');
  let paused = true;
  let settled = false;
  let notify!: () => void;
  const requested = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const abort = new AbortController();
  const background = pdf
    .raster(
      sheet,
      64,
      abort.signal,
      () => {
        notify();
        return paused;
      },
      10,
    )
    .then(
      async (result) => {
        settled = true;
        try {
          await result.encoded;
          return pixels(result.bitmap);
        } finally {
          result.bitmap.close();
          result.previewBitmap?.close();
        }
      },
      () => {
        settled = true;
        return 'cancelled' as const;
      },
    );
  try {
    await requested;
    const foreground = await rasterPixels(pdf, sheet);
    const backgroundStillPaused = !settled;
    if (cancel) abort.abort();
    else paused = false;
    return { foreground, backgroundStillPaused, result: await background };
  } finally {
    abort.abort();
    await pdf.clear();
  }
}

async function nameCache() {
  const bytes = new Uint8Array(
    await (await fetch('/tests/fixtures/sheet-name-plan.pdf')).arrayBuffer(),
  );
  let opens = 0;
  const documents = new PdfDocuments(() => {
    opens++;
    return Promise.resolve(bytes.slice());
  });
  const [sheet] = await documents.import('names', 'names.pdf', bytes);
  if (!sheet) throw new Error('Missing name fixture sheet');
  try {
    const [first, duplicate] = await Promise.all([
      documents.suggestName(sheet),
      documents.suggestName({
        ...sheet,
        id: 'duplicate',
        name: 'Renamed copy',
      }),
    ]);
    if (first.status === 'suggested') first.name = 'Caller edit';
    const unchanged = await documents.suggestName({
      ...sheet,
      name: 'New label',
    });
    const sharedOpens = opens;
    const failures = [];
    for (let attempt = 0; attempt < 2; attempt++)
      failures.push(
        await documents.suggestName({ ...sheet, pageIndex: 999 }).then(
          () => '',
          (error: unknown) => String(error),
        ),
      );
    const recovered = await documents.suggestName(sheet);
    await documents.release('names');
    const released = await documents.suggestName(sheet);
    await documents.clear();
    const cleared = await documents.suggestName(sheet);
    return {
      duplicate,
      unchanged,
      recovered,
      released,
      cleared,
      sharedOpens,
      opens,
      failures,
    };
  } finally {
    await documents.clear();
  }
}

async function preemption(cancel: boolean) {
  const source = sparsePdf(true);
  let unblock!: () => void;
  const held = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let contentRequested!: () => void;
  const requested = new Promise<void>((resolve) => {
    contentRequested = resolve;
  });
  let pauseObserved!: () => void;
  const pauseRead = new Promise<void>((resolve) => {
    pauseObserved = resolve;
  });
  const range: AssetRange = {
    length: source.range.length,
    read(offset, length) {
      if (
        offset <= source.contentOffset &&
        offset + length > source.contentOffset
      ) {
        contentRequested();
        return held.then(() => source.range.read(offset, length));
      }
      return source.range.read(offset, length);
    },
  };
  let opens = 0;
  const pdf = new PdfDocuments(() => {
    opens++;
    return Promise.resolve(source.range);
  });
  const abort = new AbortController();
  let paused = false;
  const state = { settled: false };
  try {
    const [backgroundSheet, foregroundSheet] = await pdf.import(
      'preempt',
      'Two pages.pdf',
      range,
    );
    if (!backgroundSheet || !foregroundSheet)
      throw new Error('Missing preemption fixture page');
    const background = pdf
      .raster(
        backgroundSheet,
        64,
        abort.signal,
        () => {
          if (paused) pauseObserved();
          return paused;
        },
        10,
      )
      .then(
        async (result) => {
          state.settled = true;
          try {
            await result.encoded;
            return pixels(result.bitmap);
          } finally {
            result.bitmap.close();
            result.previewBitmap?.close();
          }
        },
        () => {
          state.settled = true;
          return 'cancelled' as const;
        },
      );
    await requested;
    paused = true;
    await pauseRead;
    const foreground = await rasterPixels(pdf, foregroundSheet);
    const pausedWhileContentHeld = !state.settled;
    if (cancel) {
      abort.abort();
      // Cancellation must settle while the source range is still held.
      await background;
    }
    unblock();
    if (!cancel) {
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
      if (state.settled)
        throw new Error('Paused PDF resumed before permission to continue');
      paused = false;
    }
    const result = await background;
    const reused = await rasterPixels(pdf, backgroundSheet);
    return { foreground, pausedWhileContentHeld, result, reused, opens };
  } finally {
    unblock();
    abort.abort();
    await pdf.clear();
  }
}

function buffer(source: HTMLCanvasElement | ImageBitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Fidelity fixture context unavailable');
  context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function difference(actual: Uint8ClampedArray, expected: Uint8ClampedArray) {
  let total = 0,
    different = 0,
    nonWhite = 0,
    dark = 0;
  for (let offset = 0; offset < expected.length; offset += 4) {
    let largest = 0;
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(
        (actual[offset + channel] ?? 0) - (expected[offset + channel] ?? 0),
      );
      total += delta;
      largest = Math.max(largest, delta);
    }
    if (largest > 8) different++;
    if (Math.min(...expected.subarray(offset, offset + 3)) < 240) nonWhite++;
    if (Math.max(...expected.subarray(offset, offset + 3)) < 80) dark++;
  }
  return {
    mean: total / expected.length,
    differentFraction: different / (expected.length / 4),
    nonWhite,
    dark,
  };
}

type FidelityFixture =
  'transfer' | 'transparency' | 'font' | 'rotation-crop' | 'view-annotation';
async function fidelity(fixture: FidelityFixture) {
  const fixtures = {
    transfer: transferPdf,
    transparency: transparencyPdf,
    font: embeddedFontPdf,
    'rotation-crop': rotatedCropPdf,
    'view-annotation': viewAnnotationPdf,
  };
  const bytes = await fixtures[fixture]();
  const documents = new PdfDocuments(() => Promise.resolve(bytes.slice()));
  // The independent reference uses unmodified PDF.js DOM canvas/filter/font seams.
  GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
  const referenceTask = getDocument({
    data: bytes.slice(),
    standardFontDataUrl: new URL('/pdfjs/standard_fonts/', location.href).href,
    cMapUrl: new URL('/pdfjs/cmaps/', location.href).href,
    cMapPacked: true,
    wasmUrl: new URL('/pdfjs/wasm/', location.href).href,
  });
  try {
    const [sheet] = await documents.import(fixture, `${fixture}.pdf`, bytes);
    if (!sheet) throw new Error('Missing fidelity fixture sheet');
    const reference = await referenceTask.promise;
    const page = await reference.getPage(1);
    const results = [];
    const bounds = [
      { x: 0, y: 0, width: sheet.width, height: sheet.height },
      {
        x: sheet.width / 4,
        y: sheet.height / 4,
        width: sheet.width / 2,
        height: sheet.height / 2,
      },
    ];
    for (const region of bounds) {
      const dimension = 192;
      const scale = dimension / Math.max(region.width, region.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(region.width * scale);
      canvas.height = Math.ceil(region.height * scale);
      await page.render({
        canvas,
        viewport: page.getViewport({
          scale,
          rotation: sheet.rotation ?? 0,
          offsetX: -region.x * scale,
          offsetY: -region.y * scale,
        }),
        intent: 'display',
      }).promise;
      const result = await documents.rasterRegion(sheet, region, dimension);
      try {
        const encoded = await result.encoded;
        const decoded = await createImageBitmap(
          new Blob([encoded.bytes.slice().buffer], { type: 'image/png' }),
        );
        try {
          results.push({
            width: result.bitmap.width,
            height: result.bitmap.height,
            expectedWidth: canvas.width,
            expectedHeight: canvas.height,
            samples: pixels(result.bitmap),
            ...difference(buffer(result.bitmap), buffer(canvas)),
            png: difference(buffer(decoded), buffer(result.bitmap)),
          });
        } finally {
          decoded.close();
        }
      } finally {
        result.bitmap.close();
        result.previewBitmap?.close();
      }
    }
    let printSamples: ReturnType<typeof pixels> | null = null;
    if (fixture === 'view-annotation') {
      const canvas = document.createElement('canvas');
      const viewport = page.getViewport({
        scale: 192 / Math.max(sheet.width, sheet.height),
      });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport, intent: 'print' }).promise;
      printSamples = pixels(canvas);
    }
    return {
      version,
      printSamples,
      sheet: {
        width: sheet.width,
        height: sheet.height,
        rotation: sheet.rotation,
        pdfToPage: sheet.pdfToPage,
      },
      results,
    };
  } finally {
    await documents.clear();
    await referenceTask.destroy();
  }
}

const harness = {
  nameCache,
  backgroundPause,
  yielding,
  cancellation,
  cancelEncoding,
  fullPreview,
  fidelity,
  preemption,
  rangedRendering,
  rangeFailure,
  cancelRange,
  cancelRenderRange,
  abortLoading,
  idleCache,
};
export type PdfRenderingHarness = typeof harness;
Object.assign(window, { pdfRendering: harness });
