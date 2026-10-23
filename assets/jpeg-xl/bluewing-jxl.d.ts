export interface JxlModule {
  /** Re-read after allocating or invoking the codec: memory growth replaces this view. */
  HEAPU8: Uint8Array;
  _malloc(bytes: number): number;
  _free(pointer: number): void;
  _bw_encode(rgba: number, width: number, height: number, quality: number): number;
  _bw_encoded_data(result: number): number;
  _bw_encoded_size(result: number): number;
  _bw_encoded_free(result: number): void;
  _bw_decoder_new(): number;
  _bw_decoder_delete(decoder: number): void;
  /** 0 = final, 1 = progression (optional DC snapshot or flush), 2 = need more bytes, negative = error. */
  _bw_decoder_feed(decoder: number, input: number, length: number): number;
  _bw_decoder_flush(decoder: number): number;
  /** At ratio 8: packed ceil(width/8) by ceil(height/8) RGBA8 sRGB, or 0 if unsupported.
   * Valid until the next DC call or decoder deletion. Does not flush or modify final pixels. */
  _bw_decoder_dc(decoder: number): number;
  _bw_decoder_width(decoder: number): number;
  _bw_decoder_height(decoder: number): number;
  /** Full-width, full-height RGBA8 sRGB output, including at coarse progression. */
  _bw_decoder_pixels(decoder: number): number;
  _bw_decoder_ratio(decoder: number): number;
}
export interface JxlModuleOptions {
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?: (path: string, prefix: string) => string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}
export default function createJxlModule(options?: JxlModuleOptions): Promise<JxlModule>;
