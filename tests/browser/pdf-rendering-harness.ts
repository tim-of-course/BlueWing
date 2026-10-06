import { PdfDocuments } from '../../src/pdf/documents';
import type { Sheet } from '../../src/core/types';
import type { AssetRange } from '../../src/platform/storage-model';

function vectorPdf(): Uint8Array {
  const shapes = Array.from(
    { length: 256 },
    (_, index) =>
      `q ${String(index % 2)} 0 ${String(1 - (index % 2))} rg ${String(index % 64)} ${String(Math.floor(index / 64))} 1 1 re f Q`,
  );
  const stream = `${shapes.join('\n')}\n1 0 0 rg 0 0 32 64 re f\n0 0 1 rg 32 0 32 64 re f\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 64 64] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${String(stream.length)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join(
      '',
    )}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** Unused streams occupy the gaps; allocate only ranges PDF.js asks for. */
function sparsePdf() {
  const compact = new TextDecoder().decode(vectorPdf());
  const contentStart = compact.indexOf('4 0 obj\n');
  const encoder = new TextEncoder();
  const segments: { offset: number; bytes: Uint8Array }[] = [];
  const offsets = [
    0,
    ...[1, 2, 3].map((id) => compact.indexOf(`${String(id)} 0 obj\n`)),
  ];
  let cursor = 0;
  const append = (text: string) => {
    const bytes = encoder.encode(text);
    segments.push({ offset: cursor, bytes });
    cursor += bytes.length;
  };
  const padding = (id: number) => {
    const length = 4 * 1024 * 1024;
    offsets[id] = cursor;
    append(`${String(id)} 0 obj\n<< /Length ${String(length)} >>\nstream\n`);
    cursor += length;
    append('\nendstream\nendobj\n');
  };
  append(compact.slice(0, contentStart));
  padding(5);
  const contentOffset = cursor;
  offsets[4] = cursor;
  append(compact.slice(contentStart, compact.indexOf('xref\n')));
  padding(6);
  const xrefOffset = cursor;
  append(
    `xref\n0 7\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
      .join(
        '',
      )}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`,
  );
  const reads: { offset: number; length: number }[] = [];
  const range: AssetRange = {
    length: cursor,
    read(offset, length) {
      reads.push({ offset, length });
      const bytes = new Uint8Array(length).fill(32);
      for (const segment of segments) {
        const start = Math.max(offset, segment.offset);
        const end = Math.min(
          offset + length,
          segment.offset + segment.bytes.length,
        );
        if (end > start)
          bytes.set(
            segment.bytes.subarray(
              start - segment.offset,
              end - segment.offset,
            ),
            start - offset,
          );
      }
      return Promise.resolve(bytes);
    },
  };
  return { range, reads, contentOffset };
}

interface ChannelRecord {
  posts: number;
  deliveries: number;
  closed: number;
}
function trackChannels(
  onPost?: () => void,
  onDelivery?: (record: ChannelRecord) => void,
) {
  const Original = window.MessageChannel;
  const records: ChannelRecord[] = [];
  window.MessageChannel = class extends Original {
    constructor() {
      super();
      const record = { posts: 0, deliveries: 0, closed: 0 };
      records.push(record);
      const post = this.port2.postMessage.bind(this.port2);
      this.port2.postMessage = (value: unknown) => {
        if (value === null) {
          record.posts++;
          onPost?.();
        }
        post(value);
      };
      this.port1.addEventListener('message', () => {
        record.deliveries++;
        onDelivery?.(record);
      });
      for (const port of [this.port1, this.port2]) {
        const close = port.close.bind(port);
        port.close = () => {
          record.closed++;
          close();
        };
      }
    }
  };
  return {
    records,
    restore: () => {
      window.MessageChannel = Original;
    },
  };
}
function pixels(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PDF pixel context unavailable');
  return {
    width: canvas.width,
    height: canvas.height,
    left: [...context.getImageData(16, 32, 1, 1).data],
    right: [...context.getImageData(48, 32, 1, 1).data],
  };
}

async function yielding() {
  const bytes = vectorPdf();
  const pdf = new PdfDocuments(() => Promise.resolve(bytes.slice()));
  const [sheet] = await pdf.import('plan', 'Vector plan.pdf', bytes);
  if (!sheet) throw new Error('PDF fixture has no page');
  const input = document.querySelector('input');
  if (!input) throw new Error('PDF input fixture missing');
  const originalDate = Date.now;
  const originalFrame = window.requestAnimationFrame.bind(window);
  // Retain the native method for proxy forwarding and exact restoration.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalFill = CanvasRenderingContext2D.prototype.fill;
  let clock = originalDate(),
    frameRequests = 0,
    draws = 0,
    settled = false;
  let inputDuringRender = false,
    drawsBeforeInput = 0;
  const probe = new MessageChannel();
  probe.port1.onmessage = () => {
    input.value = 'Input remained responsive';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const onInput = () => {
    inputDuringRender = !settled;
    drawsBeforeInput = draws;
  };
  input.addEventListener('input', onInput);
  const channels = trackChannels(undefined, (record) => {
    // Queue another task between real PDF continuation tasks, after drawing began.
    if (record.deliveries === 2) probe.port2.postMessage(null);
  });
  // Force PDF.js's elapsed-time chunk boundary independently of machine speed.
  Date.now = () => (clock += 20);
  window.requestAnimationFrame = () => {
    frameRequests++;
    throw new Error('Background PDF rendering must not need animation frames');
  };
  CanvasRenderingContext2D.prototype.fill = new Proxy(originalFill, {
    apply(target, context, args) {
      draws++;
      Reflect.apply(target, context, args);
    },
  });
  const started = performance.now();
  try {
    const canvas = await pdf.render(sheet, 64);
    settled = true;
    return {
      ...pixels(canvas),
      inputDuringRender,
      drawsBeforeInput,
      frameRequests,
      channels: channels.records,
      durationMs: performance.now() - started,
    };
  } finally {
    settled = true;
    Date.now = originalDate;
    window.requestAnimationFrame = originalFrame;
    CanvasRenderingContext2D.prototype.fill = originalFill;
    channels.restore();
    probe.port1.close();
    probe.port2.close();
    input.removeEventListener('input', onInput);
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
  let cleanup: Promise<void> | undefined;
  const channels = trackChannels(() => {
    cleanup ??= action === 'release' ? pdf.release('plan') : pdf.clear();
  });
  try {
    const outcome = await pdf.render(sheet, 64).then(
      () => 'completed',
      () => 'cancelled',
    );
    await cleanup;
    const closed = channels.records.map((record) => ({ ...record }));
    channels.restore();
    const reloaded = await pdf.render(sheet, 64);
    return { outcome, channels: closed, reads, reloaded: pixels(reloaded) };
  } finally {
    channels.restore();
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
    const recovered = pixels(await pdf.render(sheet, 64));
    return { failure, failures, opens, recovered };
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
    const pinned = pdf.render(fixtureSheet('pinned'), 64);
    await started;
    for (const id of ['a', 'b', 'c', 'b', 'c']) {
      await pdf.render(fixtureSheet(id), 64);
    }
    const cached = { ...opens };
    await pdf.render(fixtureSheet('a'), 64);
    unblock();
    return { cached, opens, pinned: pixels(await pinned) };
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
  const originalDate = Date.now;
  let clock = originalDate();
  Date.now = () => (clock += 20);
  let paused = true;
  let settled = false;
  let notify = () => {};
  const blocked = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const abort = new AbortController();
  const channels = trackChannels();
  const background = pdf
    .render(sheet, 64, abort.signal, () => {
      notify();
      return paused;
    })
    .then(
      (canvas) => {
        settled = true;
        return pixels(canvas);
      },
      () => {
        settled = true;
        return 'cancelled' as const;
      },
    );
  try {
    await blocked;
    const foreground = pixels(await pdf.render(sheet, 64));
    const backgroundStillPaused = !settled;
    if (cancel) abort.abort();
    else paused = false;
    const result = await background;
    return {
      foreground,
      backgroundStillPaused,
      result,
      channels: channels.records,
    };
  } finally {
    abort.abort();
    Date.now = originalDate;
    channels.restore();
    await pdf.clear();
  }
}

const harness = {
  backgroundPause,
  yielding,
  cancellation,
  rangedRendering,
  rangeFailure,
  cancelRange,
  cancelRenderRange,
  abortLoading,
  idleCache,
};
export type PdfRenderingHarness = typeof harness;
Object.assign(window, { pdfRendering: harness });
