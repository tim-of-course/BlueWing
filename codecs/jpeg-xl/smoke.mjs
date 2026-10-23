import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import createJxlModule from '../../assets/jpeg-xl/bluewing-jxl.js';

const large = process.argv.includes('--large');
const width = large ? 9600 : 512;
const height = large ? 7200 : 384;
const module = await createJxlModule({
  wasmBinary: await readFile(
    new URL('../../assets/jpeg-xl/bluewing-jxl.wasm', import.meta.url),
  ),
});
const barrier = process.argv.includes('--high-pointers')
  ? module._malloc(2200000000)
  : 0;
if (process.argv.includes('--high-pointers')) assert.ok(barrier);
const rgba = module._malloc(width * height * 4);
assert.ok(rgba);
if (barrier)
  assert.ok(rgba > 0x7fffffff, 'exercise unsigned pointers above 2 GiB');
let heap = module.HEAPU8;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const p = rgba + (y * width + x) * 4;
    const line = x % 97 < 2 || y % 83 < 2 || (x % 311 < 100 && y % 173 < 10);
    heap[p] = line ? 20 : 245;
    heap[p + 1] = line ? 35 : 247;
    heap[p + 2] = line ? 55 : 250;
    heap[p + 3] = 255;
  }
}
const start = performance.now();
let result;
try {
  result = module._bw_encode(rgba, width, height, 80);
} catch (error) {
  console.error({
    encodeFailureMs: performance.now() - start,
    heapBytes: module.HEAPU8.byteLength,
    rssBytes: process.memoryUsage().rss,
    error: error.message,
  });
  process.exit(1);
}
if (!result)
  console.error({
    encodeFailureMs: performance.now() - start,
    heapBytes: module.HEAPU8.byteLength,
    rssBytes: process.memoryUsage().rss,
  });
assert.ok(result, 'encode succeeds');
if (barrier) {
  assert.ok(result > 0x7fffffff);
  assert.ok(module._bw_encoded_data(result) > 0x7fffffff);
}
const encodeMs = performance.now() - start;
const encoded = module.HEAPU8.slice(
  module._bw_encoded_data(result),
  module._bw_encoded_data(result) + module._bw_encoded_size(result),
);
module._bw_encoded_free(result);
module._free(rgba);
const encodeHeapBytes = module.HEAPU8.byteLength;

function decode(chunkSize) {
  const started = performance.now();
  const dec = module._bw_decoder_new();
  assert.ok(dec);
  if (barrier) assert.ok(dec > 0x7fffffff);
  const input = module._malloc(Math.min(chunkSize, encoded.length));
  const ratios = [];
  const samples = [];
  const stages = [];
  let status = 2;
  let offset = 0;
  while (status !== 0) {
    if (status === 2) {
      assert.ok(offset < encoded.length, 'complete stream reaches final image');
      const chunk = encoded.subarray(offset, offset + chunkSize);
      module.HEAPU8.set(chunk, input);
      offset += chunk.length;
      status = module._bw_decoder_feed(dec, input, chunk.length);
    } else {
      status = module._bw_decoder_feed(dec, 0, 0);
    }
    assert.ok(status >= 0, `decode status ${status}`);
    if (status === 1 || status === 0) {
      assert.equal(module._bw_decoder_flush(dec), 0);
      stages.push({
        ratio: module._bw_decoder_ratio(dec),
        elapsedMs: Math.round(performance.now() - started),
      });
      assert.equal(module._bw_decoder_width(dec), width);
      assert.equal(module._bw_decoder_height(dec), height);
      const pixels = module._bw_decoder_pixels(dec);
      assert.ok(pixels);
      if (barrier) assert.ok(pixels > 0x7fffffff);
      ratios.push(module._bw_decoder_ratio(dec));
      let sample = 0;
      for (let i = 0; i < width * height; i += 113) {
        assert.equal(module.HEAPU8[pixels + i * 4 + 3], 255);
        sample = (Math.imul(sample, 31) + module.HEAPU8[pixels + i * 4]) | 0;
      }
      samples.push(sample);
      if (status === 0) {
        const middle =
          pixels + (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
        assert.ok(module.HEAPU8[pixels] < 80, 'dark drawing line survives');
        assert.ok(
          module.HEAPU8[middle] > 210,
          'light page background survives',
        );
      }
    }
  }
  assert.ok(
    ratios.some((ratio) => ratio > 1),
    'coarse progression exists',
  );
  assert.equal(ratios.at(-1), 1);
  assert.ok(new Set(samples).size > 1, 'progression changes pixels');
  module._free(input);
  module._bw_decoder_delete(dec);
  return { ratios, samples, stages };
}
const decodeStart = performance.now();
const whole = decode(encoded.length);
const decodeMs = performance.now() - decodeStart;
if (!large) {
  const chunked = decode(127);
  assert.deepEqual(
    chunked.ratios,
    whole.ratios,
    'incremental and complete input produce identical ratios',
  );
  assert.deepEqual(
    chunked.samples,
    whole.samples,
    'incremental and complete input produce identical pixels',
  );
  assert.equal(module._bw_encode(0, 1, 1, 80), 0);
  const bad = module._bw_decoder_new();
  const input = module._malloc(32);
  module.HEAPU8.fill(0, input, input + 32);
  assert.ok(module._bw_decoder_feed(bad, input, 32) < 0);
  module._free(input);
  module._bw_decoder_delete(bad);
}
console.log(
  JSON.stringify(
    {
      width,
      height,
      quality: 80,
      encodedBytes: encoded.length,
      encodeMs: Math.round(encodeMs),
      decodeMs: Math.round(decodeMs),
      encodeHeapBytes,
      finalHeapBytes: module.HEAPU8.byteLength,
      rssBytes: process.memoryUsage().rss,
      ...whole,
    },
    null,
    2,
  ),
);
if (barrier) module._free(barrier);
