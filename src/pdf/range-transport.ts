import { PDFDataRangeTransport } from 'pdfjs-dist';
import type { AssetRange } from '../platform/storage-model';

/** PDF.js requests only the source ranges needed for parsing and visible pages. */
export class AssetRangeTransport extends PDFDataRangeTransport {
  private stopped = false;
  private rejectFailure!: (error: unknown) => void;
  readonly failed = new Promise<never>((_, reject) => {
    this.rejectFailure = reject;
  });

  constructor(
    private readonly source: AssetRange,
    private readonly stopLoading: () => void,
  ) {
    super(source.length, null, true);
  }

  override requestDataRange(begin: number, end: number): void {
    if (this.stopped) return;
    void Promise.resolve()
      .then(() => this.source.read(begin, end - begin))
      .then((bytes) => {
        if (bytes.length !== end - begin)
          throw new Error('Incomplete PDF range read');
        if (!this.stopped) this.onDataRange(begin, bytes);
      })
      .catch((error: unknown) => {
        if (this.stopped) return;
        this.stopped = true;
        this.rejectFailure(error);
        this.stopLoading();
      });
  }

  override abort(): void {
    this.stopped = true;
    this.rejectFailure(new Error('PDF loading was cancelled'));
  }
}
