export function encodeBase64(bytes: Uint8Array): string {
  // Encode complete three-byte groups independently, avoiding a second full binary string.
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 24576)
    chunks.push(
      btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576))),
    );
  return chunks.join('');
}

export function decodeBase64(encoded: string): Uint8Array {
  const clean = /\s/.test(encoded) ? encoded.replace(/\s/g, '') : encoded;
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4) - padding);
  let index = 0;
  // Uint8Array.from(string) materializes an enormous iterable for large PDF files.
  for (let offset = 0; offset < clean.length; offset += 32768) {
    const binary = atob(clean.slice(offset, offset + 32768));
    for (let i = 0; i < binary.length; i++)
      bytes[index++] = binary.charCodeAt(i);
  }
  return bytes;
}
