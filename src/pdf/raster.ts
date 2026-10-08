/** A display lease shares immutable source pixels; releasing it cannot erase another view. */
export interface RasterLease {
  readonly source: ImageBitmap;
  readonly width: number;
  readonly height: number;
  release(): void;
}

export class RasterResource {
  private references = 1;
  readonly width: number;
  readonly height: number;
  constructor(
    readonly bitmap: ImageBitmap,
    readonly bytes: Promise<Uint8Array>,
  ) {
    this.width = bitmap.width;
    this.height = bitmap.height;
    void bytes.catch(() => undefined);
  }
  get pixelBytes() {
    return this.width * this.height * 4;
  }
  retain() {
    this.references++;
  }
  release() {
    if (--this.references === 0) this.bitmap.close();
  }
  lease(): RasterLease {
    this.retain();
    let released = false;
    return {
      source: this.bitmap,
      width: this.width,
      height: this.height,
      release: () => {
        if (!released) {
          released = true;
          this.release();
        }
      },
    };
  }
}
