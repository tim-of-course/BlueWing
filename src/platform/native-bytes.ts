/** Bound each native IPC response, including WebView's JSON fallback. */
export const NATIVE_CHUNK_BYTES = 1024 * 1024;

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
