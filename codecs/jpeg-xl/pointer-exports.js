/* global Module */
// wasm32 returns i32; normalize pointers above 2 GiB for JavaScript heap views.
for (const name of [
  '_bw_encode',
  '_bw_encoded_data',
  '_bw_decoder_new',
  '_bw_decoder_pixels',
  '_bw_decoder_dc',
]) {
  const native = Module[name];
  Module[name] = (...args) => native(...args) >>> 0;
}
