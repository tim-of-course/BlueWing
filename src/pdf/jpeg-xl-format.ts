export const JXL_QUALITY = 80;

export function isJpegXl(bytes: Uint8Array) {
  return (
    (bytes[0] === 0xff && bytes[1] === 0x0a) ||
    (bytes[0] === 0 &&
      bytes[1] === 0 &&
      bytes[2] === 0 &&
      bytes[3] === 12 &&
      bytes[4] === 0x4a &&
      bytes[5] === 0x58 &&
      bytes[6] === 0x4c &&
      bytes[7] === 0x20)
  );
}
