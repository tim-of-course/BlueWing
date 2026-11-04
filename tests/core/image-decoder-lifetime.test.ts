import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ImageDecoder } from '../../src/pdf/image-decoder';

type Message = { type: 'decode' | 'cancel'; id: number };
class FakeWorker {
  static current: FakeWorker;
  static failDecode = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: Message[] = [];
  terminated = false;
  constructor() {
    FakeWorker.current = this;
  }
  postMessage(message: Message) {
    if (message.type === 'decode' && FakeWorker.failDecode)
      throw new Error('Cannot transfer image bytes');
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  receive(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

void test('cancelled native decode stays busy until cleanup and closes late pixels', async () => {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try {
    let idle = 0;
    const decoder = new ImageDecoder(() => idle++);
    const abort = new AbortController();
    const request = decoder.decode(
      new Uint8Array([1]),
      { width: 64, height: 32 },
      abort.signal,
    );
    const worker = FakeWorker.current;
    const started = worker.messages.find(
      (message) => message.type === 'decode',
    );
    assert.ok(started);
    abort.abort();
    await assert.rejects(request);
    assert.equal(decoder.busy, true);
    assert.equal(idle, 0);
    assert.ok(
      worker.messages.some(
        (message) => message.type === 'cancel' && message.id === started.id,
      ),
    );
    let closed = 0;
    worker.receive({
      id: started.id,
      bitmap: { close: () => closed++ },
      bytes: new Uint8Array([1]),
    });
    assert.equal(closed, 1);
    worker.receive({ id: started.id, settled: true });
    assert.equal(decoder.busy, false);
    assert.equal(idle, 1);
    decoder.clear();
    assert.equal(worker.terminated, true);
    assert.equal(idle, 1);
  } finally {
    globalThis.Worker = original;
  }
});

void test('synchronous decode transfer failure clears busy state and abort listener', async () => {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  FakeWorker.failDecode = true;
  try {
    let idle = 0;
    const decoder = new ImageDecoder(() => idle++);
    const abort = new AbortController();
    const request = decoder.decode(
      new Uint8Array([1]),
      { width: 64, height: 32 },
      abort.signal,
    );
    await assert.rejects(request, /Cannot transfer image bytes/);
    assert.equal(decoder.busy, false);
    assert.equal(idle, 1);
    abort.abort();
    assert.equal(FakeWorker.current.messages.length, 0);
    decoder.clear();
    assert.equal(idle, 1);
  } finally {
    FakeWorker.failDecode = false;
    globalThis.Worker = original;
  }
});

void test('decoded pixels are returned before worker cleanup without reporting idle', async () => {
  const original = globalThis.Worker;
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  try {
    let idle = 0;
    const decoder = new ImageDecoder(() => idle++);
    const request = decoder.decode(
      new Uint8Array([1]),
      { width: 64, height: 32 },
      new AbortController().signal,
    );
    const worker = FakeWorker.current;
    const started = worker.messages.find(
      (message) => message.type === 'decode',
    );
    assert.ok(started);
    const bitmap = { close() {} };
    worker.receive({ id: started.id, bitmap, bytes: new Uint8Array([1]) });
    assert.equal((await request).bitmap, bitmap as unknown as ImageBitmap);
    assert.equal(decoder.busy, true);
    assert.equal(idle, 0);
    worker.receive({ id: started.id, settled: true });
    assert.equal(decoder.busy, false);
    assert.equal(idle, 1);
    decoder.clear();
  } finally {
    globalThis.Worker = original;
  }
});
