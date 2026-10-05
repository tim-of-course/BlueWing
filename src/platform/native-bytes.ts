import type { AssetRange } from './storage-model';

/** Bound each native IPC response, including WebView's JSON fallback. */
export const NATIVE_CHUNK_BYTES = 1024 * 1024;

/** PDF.js can request disjoint or repeated ranges, including ranges larger than IPC allows. */
export function nativeRange(
  length: number,
  read: (offset: number, length: number) => Promise<ArrayBuffer | number[]>,
): AssetRange {
  if (!Number.isSafeInteger(length) || length < 0)
    throw new Error('Invalid native byte length');
  return {
    length,
    async read(offset, size) {
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(size) ||
        offset < 0 ||
        size < 0 ||
        offset > length ||
        size > length - offset
      )
        throw new Error('Native byte range is outside the asset');
      return readNativeChunks(size, (position, chunkLength) =>
        read(offset + position, chunkLength),
      );
    },
  };
}

export async function readNativeChunks(
  length: number,
  read: (offset: number, length: number) => Promise<ArrayBuffer | number[]>,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(length) || length < 0)
    throw new Error('Invalid native byte length');
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += NATIVE_CHUNK_BYTES) {
    const size = Math.min(NATIVE_CHUNK_BYTES, length - offset);
    const chunk = new Uint8Array(await read(offset, size));
    if (chunk.length !== size)
      throw new Error('Incomplete native byte transfer');
    bytes.set(chunk, offset);
  }
  return bytes;
}
