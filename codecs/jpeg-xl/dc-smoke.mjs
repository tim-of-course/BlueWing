import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import createJxlModule from '../../assets/jpeg-xl/bluewing-jxl.js';

const args = process.argv.slice(2);
const wasmBinary = await readFile('assets/jpeg-xl/bluewing-jxl.wasm');
const module = await createJxlModule({ wasmBinary });
const barrier = args.includes('--high-pointers')
  ? module._malloc(2200000000)
  : 0;
if (args.includes('--high-pointers')) assert.ok(barrier);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const colors = [
  [245, 247, 250],
  [20, 35, 55],
  [210, 45, 35],
  [25, 175, 60],
  [35, 65, 210],
  [128, 128, 128],
];
function encode(width, height) {
  const input = module._malloc(width * height * 4);
  for (let y = 0; y < height; ++y)
    for (let x = 0; x < width; ++x) {
      const color = colors[Math.min(5, Math.floor((x * 6) / width))];
      module.HEAPU8.set([...color, 255], input + (y * width + x) * 4);
    }
  const result = module._bw_encode(input, width, height, 80);
  assert.ok(result);
  const bytes = module.HEAPU8.slice(
    module._bw_encoded_data(result),
    module._bw_encoded_data(result) + module._bw_encoded_size(result),
  );
  module._bw_encoded_free(result);
  module._free(input);
  return bytes;
}
function decode(codec, bytes, mode, chunkSize = bytes.length) {
  const dec = codec._bw_decoder_new();
  const input = codec._malloc(Math.min(chunkSize, bytes.length));
  if (codec._bw_decoder_dc) assert.equal(codec._bw_decoder_dc(dec), 0);
  let status = 2,
    offset = 0,
    dcHash,
    dcPixels;
  const start = performance.now(),
    stages = [];
  while (status !== 0) {
    const fed = performance.now();
    if (status === 2) {
      assert.ok(
        offset < bytes.length,
        `input exhausted: mode=${mode} bytes=${bytes.length} size=${codec._bw_decoder_width(dec)}x${codec._bw_decoder_height(dec)} stages=${JSON.stringify(stages)}`,
      );
      const chunk = bytes.subarray(offset, offset + chunkSize);
      codec.HEAPU8.set(chunk, input);
      offset += chunk.length;
      status = codec._bw_decoder_feed(dec, input, chunk.length);
    } else status = codec._bw_decoder_feed(dec, 0, 0);
    assert.ok(status >= 0, 'decode succeeds');
    if (status === 2) continue;
    const feedMs = performance.now() - fed;
    const width = codec._bw_decoder_width(dec),
      height = codec._bw_decoder_height(dec);
    const ratio = codec._bw_decoder_ratio(dec),
      snapshot = performance.now();
    if (status === 1 && mode === 'dc' && ratio === 8) {
      const pointer = codec._bw_decoder_dc(dec);
      assert.ok(pointer, 'bounded DC supported');
      if (barrier && codec === module) assert.ok(pointer > 0x7fffffff);
      dcPixels = codec.HEAPU8.slice(
        pointer,
        pointer + Math.ceil(width / 8) * Math.ceil(height / 8) * 4,
      );
      for (let i = 3; i < dcPixels.length; i += 4)
        assert.equal(dcPixels[i], 255);
      assert.ok(
        dcPixels.some((v, i) => i % 4 !== 3 && v > 0),
        'DC is nonzero',
      );
      dcHash = hash(dcPixels);
      assert.equal(
        hash(codec.HEAPU8.subarray(pointer, pointer + dcPixels.length)),
        dcHash,
      );
      assert.equal(
        codec._bw_decoder_dc(dec),
        pointer,
        'repeated snapshot reuses packed buffer',
      );
    } else if (status === 1 && mode === 'flush')
      assert.equal(codec._bw_decoder_flush(dec), 0);
    else if (codec._bw_decoder_dc && (status === 0 || ratio !== 8))
      assert.equal(codec._bw_decoder_dc(dec), 0);
    stages.push({
      ratio,
      feedMs,
      snapshotMs: performance.now() - snapshot,
      elapsedMs: performance.now() - start,
    });
  }
  const width = codec._bw_decoder_width(dec),
    height = codec._bw_decoder_height(dec);
  const pointer = codec._bw_decoder_pixels(dec);
  const finalHash = hash(
    codec.HEAPU8.subarray(pointer, pointer + width * height * 4),
  );
  codec._free(input);
  codec._bw_decoder_delete(dec);
  return { width, height, dcHash, dcPixels, finalHash, stages };
}
const fixtures = args.includes('--cache')
  ? [new Uint8Array(await readFile(args[args.indexOf('--cache') + 1]))]
  : [encode(16, 16), encode(17, 9), encode(513, 385)];
let baseline;
if (args.includes('--baseline')) {
  const { default: factory } = await import('../../tmp/jxl/baseline-jxl.mjs');
  baseline = await factory({
    wasmBinary: await readFile('tmp/jxl/baseline-jxl.wasm'),
  });
}
for (const bytes of fixtures) {
  const direct = decode(module, bytes, 'dc');
  const plain = decode(module, bytes, 'none');
  const flushed = decode(module, bytes, 'flush');
  assert.equal(
    direct.finalHash,
    plain.finalHash,
    'DC snapshot leaves final pixels unchanged',
  );
  assert.equal(
    direct.finalHash,
    flushed.finalHash,
    'flush and DC continuation agree',
  );
  if (baseline)
    assert.equal(
      direct.finalHash,
      decode(baseline, bytes, 'none').finalHash,
      'rebuilt final equals original asset',
    );
  if (!args.includes('--cache')) {
    const incremental = decode(module, bytes, 'dc', 127);
    assert.equal(incremental.finalHash, direct.finalHash);
    assert.equal(incremental.dcHash, direct.dcHash);
    if (direct.width === 513) {
      assert.ok(direct.dcPixels);
      const w = Math.ceil(direct.width / 8),
        y = Math.floor(Math.ceil(direct.height / 8) / 2);
      console.log(
        'DC color samples',
        colors.map((_, c) =>
          Array.from(
            direct.dcPixels.slice(
              (y * w + Math.floor(((c + 0.5) * direct.width) / 6 / 8)) * 4,
              (y * w + Math.floor(((c + 0.5) * direct.width) / 6 / 8)) * 4 + 3,
            ),
          ),
        ),
      );
      for (let c = 0; c < 6; ++c) {
        const x = Math.floor(((c + 0.5) * direct.width) / 6 / 8);
        for (let k = 0; k < 3; ++k)
          assert.ok(
            Math.abs(direct.dcPixels[(y * w + x) * 4 + k] - colors[c][k]) <= 12,
            'DC color patch ' +
              c +
              ' channel ' +
              k +
              ': ' +
              direct.dcPixels[(y * w + x) * 4 + k],
          );
      }
    }
  }
  if (args.includes('--cache')) {
    const incremental = decode(module, bytes, 'dc', 65536);
    assert.equal(incremental.finalHash, direct.finalHash);
    assert.equal(incremental.dcHash, direct.dcHash);
  }
  const { dcPixels, ...summary } = direct;
  console.log(
    JSON.stringify({
      ...summary,
      dcBytes: dcPixels?.length,
      flushStages: flushed.stages,
    }),
  );
}
if (barrier) module._free(barrier);
