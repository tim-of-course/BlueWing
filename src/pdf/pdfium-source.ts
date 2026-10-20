import type { PdfRuntimeModule, Ptr } from '@embedpdf/engine-runtime';
import type { PdfWorkerRequest } from './worker-protocol';

function pointer(value: number): Ptr {
  return BigInt(value) as Ptr;
}
const CHUNK = 256 * 1024;
const TRANSFER_CHUNKS = 4;
type RangeResult = Extract<PdfWorkerRequest, { type: 'range-result' }>;

/** PDFium probes synchronously; its availability API requests missing bytes
 * before opening a document/page. Only fetched chunks stay in this worker. */
export class PdfiumSource {
  private readonly chunks = new Map<number, Uint8Array>();
  private readonly pending = new Map<number, Promise<void>>();
  private readonly requests = new Map<
    number,
    { index: number; size: number; resolve(): void; reject(error: Error): void }
  >();
  private readonly wanted = new Set<number>();
  private readonly missed = new Set<number>();
  private readVersion = 0;
  private checkingAvailability = false;
  private sequence = 0;
  private readonly file: Ptr;
  private readonly availability: Ptr;
  private readonly hints: Ptr;
  readonly handle: Ptr;

  constructor(
    private readonly module: PdfRuntimeModule,
    readonly length: number,
    private readonly request: (
      rangeId: number,
      begin: number,
      end: number,
    ) => void,
  ) {
    const runtime = module.mem;
    const allocate = (size: number) => {
      const pointer = runtime.alloc(size);
      if (!pointer) throw new Error('Not enough memory to open the PDF');
      return pointer;
    };
    // All three public structs contain 32-bit fields in this WASM build.
    this.file = allocate(12);
    this.availability = allocate(8);
    this.hints = allocate(8);
    const available = (offset: number, size: number) => {
      if (offset < 0 || size < 0 || offset + size > length) return false;
      let found = true;
      const missing: number[] = [];
      for (
        let index = Math.floor(offset / CHUNK);
        index * CHUNK < offset + size;
        index++
      ) {
        if (!this.chunks.has(index)) {
          missing.push(index);
          found = false;
        }
      }
      if (!found && !this.checkingAvailability) {
        this.readVersion++;
        for (const index of missing) {
          this.missed.add(index);
          this.wanted.add(index);
        }
      }
      return found;
    };
    runtime.poke(this.file, 'i32', length);
    runtime.poke(
      this.file,
      'ptr',
      module.cb.register('iiiii', (...args) => {
        const [, offset, destination, size] = args.map(Number) as [
          number,
          number,
          number,
          number,
        ];
        if (!available(offset, size)) return 0;
        let copied = 0;
        while (copied < size) {
          const index = Math.floor((offset + copied) / CHUNK);
          const chunk = this.chunks.get(index);
          if (!chunk) return 0;
          const start = offset + copied - index * CHUNK;
          const count = Math.min(size - copied, chunk.length - start);
          runtime.writeBytes(
            pointer(destination + copied),
            chunk.subarray(start, start + count),
          );
          copied += count;
        }
        return 1;
      }),
      4,
    );
    runtime.poke(this.file, 'i32', 0, 8);
    runtime.poke(this.availability, 'i32', 1);
    runtime.poke(
      this.availability,
      'ptr',
      module.cb.register('iiii', (...args) =>
        Number(available(Number(args[1]), Number(args[2]))),
      ),
      4,
    );
    runtime.poke(this.hints, 'i32', 1);
    runtime.poke(
      this.hints,
      'ptr',
      module.cb.register('viii', (...args) => {
        const offset = Number(args[1]),
          size = Number(args[2]);
        for (
          let index = Math.floor(offset / CHUNK);
          index * CHUNK < Math.min(length, offset + size);
          index++
        ) {
          if (!this.chunks.has(index)) this.wanted.add(index);
        }
      }),
      4,
    );
    this.handle = module.fn.FPDFAvail_Create(this.availability, this.file);
    if (!this.handle) throw new Error('Unable to open the PDF source');
  }

  receive(message: RangeResult): void {
    const request = this.requests.get(message.rangeId);
    if (!request) return;
    this.requests.delete(message.rangeId);
    if (message.error !== undefined || message.bytes?.length !== request.size) {
      request.reject(
        new Error(message.error ?? 'Incomplete native PDF asset range'),
      );
    } else {
      for (let start = 0; start < request.size; start += CHUNK) {
        this.chunks.set(
          request.index + start / CHUNK,
          message.bytes.subarray(start, start + CHUNK),
        );
      }
      request.resolve();
    }
  }

  private fetch(index: number, count: number): Promise<void> {
    if (this.chunks.has(index)) return Promise.resolve();
    const existing = this.pending.get(index);
    if (existing) return existing;
    const rangeId = ++this.sequence;
    const begin = index * CHUNK;
    const size = Math.min(count * CHUNK, this.length - begin);
    const promise = new Promise<void>((resolve, reject) => {
      this.requests.set(rangeId, { index, size, resolve, reject });
      this.request(rangeId, begin, begin + size);
    }).finally(() => {
      for (let part = index; part < index + count; part++)
        this.pending.delete(part);
    });
    for (let part = index; part < index + count; part++)
      this.pending.set(part, promise);
    return promise;
  }

  private async fetchAll(
    indices: Iterable<number>,
    check: () => void,
    wait: (pending: Promise<void>) => Promise<void> = (pending) => pending,
  ): Promise<void> {
    const wanted = [...new Set(indices)].sort((a, b) => a - b);
    for (let position = 0; position < wanted.length;) {
      check();
      const index = wanted[position++] as number;
      if (this.chunks.has(index)) continue;
      let count = 1;
      // Combine only adjacent requested ranges, within the native 1 MiB limit.
      // Sparse dependencies keep the smaller cache/read granularity.
      while (
        count < TRANSFER_CHUNKS &&
        wanted[position] === index + count &&
        !this.pending.has(index) &&
        !this.pending.has(index + count)
      ) {
        position++;
        count++;
      }
      await wait(this.fetch(index, count));
    }
  }

  /** Probe again after satisfying hints. The wait seam lets foreground jobs
   * interrupt a background page even while its storage read remains pending. */
  async ready(
    probe: (hints: Ptr) => number,
    check: () => void,
    wait: (pending: Promise<void>) => Promise<void> = (pending) => pending,
  ): Promise<void> {
    for (;;) {
      check();
      this.wanted.clear();
      let status: number;
      this.checkingAvailability = true;
      try {
        status = probe(this.hints);
      } finally {
        this.checkingAvailability = false;
      }
      if (status === 1 || status === 2) return;
      if (status < 0) throw new Error('PDF data could not be read');
      if (!this.wanted.size)
        throw new Error('PDFium did not request missing PDF data');
      // Bound simultaneous IPC copies and keep large download hints incremental.
      await this.fetchAll(this.wanted, check, wait);
    }
  }

  async document(check: () => void): Promise<Ptr> {
    await this.ready(
      (hints) => this.module.fn.FPDFAvail_IsDocAvail(this.handle, hints),
      check,
    );
    check();
    // GetDocument also probes whole-file availability to choose its parser
    // path. A negative probe is not a request to preload the entire PDF.
    this.checkingAvailability = true;
    try {
      return this.module.fn.FPDFAvail_GetDocument(this.handle, '');
    } finally {
      this.checkingAvailability = false;
    }
  }

  /** Availability hints do not cover every document-level dependency (for
   * example optional-content settings). Never publish a native result that
   * encountered missing reads, even if PDFium reported rendering success. */
  async complete<T>(
    run: () => Promise<T>,
    discard: (value: T) => void,
    check: () => void,
    wait: (pending: Promise<void>) => Promise<void> = (pending) => pending,
  ): Promise<T> {
    for (;;) {
      check();
      const version = this.readVersion;
      let value: T | undefined, failure: unknown;
      let completed = false;
      try {
        value = await run();
        completed = true;
      } catch (error) {
        failure = error;
      }
      if (version === this.readVersion) {
        if (!completed)
          throw failure instanceof Error
            ? failure
            : new Error('Unable to read PDF', { cause: failure });
        return value as T;
      }
      if (completed) discard(value as T);
      check();
      const missed = [...this.missed];
      await this.fetchAll(missed, check, wait);
      for (const index of missed) this.missed.delete(index);
      check();
    }
  }

  async read<T>(read: () => T, check: () => void): Promise<T> {
    for (;;) {
      check();
      this.wanted.clear();
      let value: T | undefined, failure: unknown;
      try {
        value = read();
      } catch (error) {
        failure = error;
      }
      if (!this.wanted.size) {
        if (failure)
          throw failure instanceof Error
            ? failure
            : new Error('Unable to read PDF metadata', { cause: failure });
        return value as T;
      }
      await this.fetchAll(this.wanted, check);
    }
  }

  page(
    index: number,
    check: () => void,
    wait: (pending: Promise<void>) => Promise<void>,
  ) {
    return this.ready(
      (hints) => {
        const probe = () =>
          this.module.fn.FPDFAvail_IsPageAvail(this.handle, index, hints);
        const status = probe();
        // A nested page-tree lookup can enter PDFium's whole-file recovery
        // state without requesting bytes. Probe that next state before waiting.
        return status === 0 && !this.wanted.size ? probe() : status;
      },
      check,
      wait,
    );
  }
}
