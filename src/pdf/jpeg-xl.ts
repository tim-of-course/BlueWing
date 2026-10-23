import createJxlModule from '../../assets/jpeg-xl/bluewing-jxl.js';
import wasmUrl from '../../assets/jpeg-xl/bluewing-jxl.wasm?url';
import { JXL_QUALITY } from './jpeg-xl-format';

let instance: ReturnType<typeof createJxlModule> | undefined;
export function jpegXlModule() {
  instance ??= createJxlModule({ locateFile: () => wasmUrl });
  return instance;
}

/** Called in a disposable codec worker so a large encoding heap is released afterward. */
export async function encodeJpegXlPixels(pixels: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}) {
  const module = await jpegXlModule();
  const pointer = module._malloc(pixels.data.byteLength);
  if (!pointer) throw new Error('JPEG XL input allocation failed');
  let encoded = 0;
  try {
    module.HEAPU8.set(pixels.data, pointer);
    encoded = module._bw_encode(
      pointer,
      pixels.width,
      pixels.height,
      JXL_QUALITY,
    );
    if (!encoded) throw new Error('JPEG XL encoding failed');
    const start = module._bw_encoded_data(encoded);
    return module.HEAPU8.slice(start, start + module._bw_encoded_size(encoded));
  } finally {
    if (encoded) module._bw_encoded_free(encoded);
    module._free(pointer);
  }
}
