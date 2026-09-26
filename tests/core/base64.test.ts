import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeBase64, decodeBase64 } from '../../src/platform/base64';
void test('chunked PDF byte encoding matches canonical base64 across boundaries and padding', () => {
  for (const length of [0, 1, 2, 3, 24575, 24576, 24577, 98309]) {
    const bytes = Uint8Array.from({ length }, (_, index) => index % 256);
    const encoded = encodeBase64(bytes);
    assert.equal(encoded, Buffer.from(bytes).toString('base64'));
    assert.deepEqual(decodeBase64(encoded), bytes);
    assert.deepEqual(decodeBase64(encoded.replace(/.{80}/g, '$&\n')), bytes);
  }
  assert.throws(() => decodeBase64('!invalid!'));
});
