import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Sheet } from '../../src/core/types';
import { PdfWorkerClient } from '../../src/pdf/worker-client';
import type {
  PdfWorkerRequest,
  PdfWorkerResponse,
} from '../../src/pdf/worker-protocol';

const sheet: Sheet = {
  id: 'page',
  name: 'Page',
  assetId: 'plan',
  pageIndex: 0,
  width: 720,
  height: 480,
};

class FakeWorker {
  static current: FakeWorker;
  onmessage: ((event: MessageEvent<PdfWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: PdfWorkerRequest[] = [];
  terminated = false;
  failNext = false;

  constructor() {
    FakeWorker.current = this;
  }

  postMessage(message: PdfWorkerRequest) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Cannot transfer render request');
    }
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  receive(data: PdfWorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<PdfWorkerResponse>);
  }
}

void test('cancelled render stays busy until worker cleanup is acknowledged', async () => {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try {
    let idle = 0;
    const client = new PdfWorkerClient(undefined, () => idle++);
    const abort = new AbortController();
    const request = client.render(
      sheet,
      { x: 0, y: 0, width: 720, height: 480 },
      1440,
      abort.signal,
    );
    const worker = FakeWorker.current;
    const render = worker.messages.find((message) => message.type === 'render');
    assert.ok(render);
    abort.abort();
    await assert.rejects(request);
    assert.equal(client.busy, true);
    assert.equal(idle, 0);
    assert.ok(
      worker.messages.some(
        (message) => message.type === 'cancel' && message.id === render.id,
      ),
    );
    worker.receive({ type: 'render-settled', id: render.id });
    assert.equal(client.busy, false);
    assert.equal(idle, 1);
    client.destroy();
    assert.equal(worker.terminated, true);
    assert.equal(idle, 1);
  } finally {
    globalThis.Worker = original;
  }
});

void test('synchronous render transfer failure clears busy state and abort listener', async () => {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try {
    let idle = 0;
    const client = new PdfWorkerClient(undefined, () => idle++);
    const worker = FakeWorker.current;
    worker.failNext = true;
    const abort = new AbortController();
    const request = client.render(
      sheet,
      { x: 0, y: 0, width: 720, height: 480 },
      1440,
      abort.signal,
    );
    await assert.rejects(request, /Cannot transfer render request/);
    assert.equal(client.busy, false);
    assert.equal(idle, 1);
    abort.abort();
    assert.equal(worker.messages.length, 0);
    client.destroy();
    assert.equal(idle, 1);
  } finally {
    globalThis.Worker = original;
  }
});

void test('encoded render remains busy until worker cleanup follows delivery', async () => {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try {
    let idle = 0;
    const client = new PdfWorkerClient(undefined, () => idle++);
    const request = client.render(
      sheet,
      { x: 0, y: 0, width: 720, height: 480 },
      1440,
    );
    const worker = FakeWorker.current;
    const render = worker.messages.find((message) => message.type === 'render');
    assert.ok(render);
    const bitmap = { width: 1440, height: 960, close() {} } as ImageBitmap;
    const timings = {
      thread: 'worker' as const,
      drawMs: 1,
      resizeMs: 1,
      encodeMs: 1,
      totalMs: 3,
    };
    worker.receive({ type: 'raster', id: render.id, bitmap, timings });
    const result = await request;
    let encodedResolved = false;
    const encoded = result.encoded.then(() => {
      encodedResolved = true;
    });
    worker.receive({
      type: 'encoded',
      id: render.id,
      bytes: new Uint8Array([1]),
      timings,
    });
    await Promise.resolve();
    assert.equal(encodedResolved, false);
    assert.equal(client.busy, true);
    assert.equal(idle, 0);
    worker.receive({ type: 'render-settled', id: render.id });
    await encoded;
    assert.equal(encodedResolved, true);
    assert.equal(client.busy, false);
    assert.equal(idle, 1);
    client.destroy();
  } finally {
    globalThis.Worker = original;
  }
});

void test('pixel-only rendering delivers pixels after worker cleanup', async () => {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try {
    const client = new PdfWorkerClient();
    let resolved = false;
    const request = client
      .renderPixels(sheet, { x: 0, y: 0, width: 720, height: 480 }, 1440)
      .then((value) => {
        resolved = true;
        return value;
      });
    const worker = FakeWorker.current;
    const render = worker.messages.find((message) => message.type === 'render');
    assert.ok(render);
    const bitmap = { width: 1440, height: 960, close() {} } as ImageBitmap;
    const timings = {
      thread: 'worker' as const,
      drawMs: 1,
      resizeMs: 1,
      encodeMs: 0,
      totalMs: 2,
    };
    worker.receive({ type: 'raster', id: render.id, bitmap, timings });
    await Promise.resolve();
    assert.equal(resolved, false);
    assert.equal(client.busy, true);
    worker.receive({ type: 'render-settled', id: render.id });
    assert.equal((await request).bitmap, bitmap);
    assert.equal(client.busy, false);
    client.destroy();
  } finally {
    globalThis.Worker = original;
  }
});

void test('cancelling undelivered pixels closes the bitmap', async () => {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try {
    const client = new PdfWorkerClient();
    const abort = new AbortController();
    const request = client.renderPixels(
      sheet,
      { x: 0, y: 0, width: 720, height: 480 },
      1440,
      abort.signal,
    );
    const worker = FakeWorker.current;
    const render = worker.messages.find((message) => message.type === 'render');
    assert.ok(render);
    let closed = 0;
    const bitmap = {
      width: 1440,
      height: 960,
      close() {
        closed++;
      },
    } as ImageBitmap;
    const timings = {
      thread: 'worker' as const,
      drawMs: 1,
      resizeMs: 1,
      encodeMs: 0,
      totalMs: 2,
    };
    worker.receive({ type: 'raster', id: render.id, bitmap, timings });
    abort.abort();
    await assert.rejects(request);
    assert.equal(closed, 1);
    assert.equal(client.busy, true);
    worker.receive({ type: 'render-settled', id: render.id });
    assert.equal(client.busy, false);
    client.destroy();
  } finally {
    globalThis.Worker = original;
  }
});
