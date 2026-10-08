/** Select PDF.js 6.4.299's CPU filters, rather than constructing DOM SVGs.
 * Its TR fallback covers solid colors, images, shading/mesh/tiling patterns,
 * and group compositing. _bakeSMaskCanvas handles alpha/luminosity transfer
 * maps; _createKnockoutMaskCanvas handles knockout alpha scaling.
 */
export class WorkerFilterFactory {
  addFilter(): string {
    return 'none';
  }

  addAlphaFilter(): string {
    return 'none';
  }

  addLuminosityFilter(): string {
    return 'none';
  }

  addKnockoutFilter(): string {
    return 'none';
  }

  addHCMFilter(foreground?: string, background?: string): string {
    if (foreground || background)
      throw new Error('PDF pageColors require DOM SVG filters');
    return 'none';
  }

  destroy(): void {}
}

interface CanvasEntry {
  canvas: OffscreenCanvas | null;
  context: OffscreenCanvasRenderingContext2D | null;
}

export class WorkerCanvasFactory {
  private readonly enableHWA: boolean;

  constructor({ enableHWA = false }: { enableHWA?: boolean } = {}) {
    this.enableHWA = enableHWA;
  }

  create(width: number, height: number) {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', {
      willReadFrequently: !this.enableHWA,
    });
    if (!context) throw new Error('PDF worker requires OffscreenCanvas 2D');
    return { canvas, context };
  }

  reset({ canvas }: CanvasEntry, width: number, height: number): void {
    if (!canvas) throw new Error('PDF canvas has been released');
    canvas.width = width;
    canvas.height = height;
  }

  destroy(entry: CanvasEntry): void {
    if (entry.canvas) entry.canvas.width = entry.canvas.height = 0;
    entry.canvas = entry.context = null;
  }
}

export function workerFontOwner(): Pick<Document, 'fonts'> {
  // tsconfig uses DOM only. This is the native WorkerGlobalScope.fonts member,
  // not a synthetic document or a replacement font implementation.
  const { fonts } = globalThis as unknown as { fonts?: FontFaceSet };
  if (typeof FontFace !== 'function' || !fonts)
    throw new Error('PDF worker requires native FontFace and FontFaceSet');
  if (typeof DOMMatrix !== 'function')
    throw new Error('PDF worker requires native DOMMatrix');
  if (typeof Path2D !== 'function')
    throw new Error('PDF worker requires native Path2D');
  if (typeof OffscreenCanvas !== 'function')
    throw new Error('PDF worker requires native OffscreenCanvas');
  if (typeof createImageBitmap !== 'function')
    throw new Error('PDF worker requires native createImageBitmap');
  if (typeof OffscreenCanvas.prototype.convertToBlob !== 'function')
    throw new Error('PDF worker requires OffscreenCanvas PNG encoding');
  return { fonts };
}

export function workerAssetOptions(assetBaseUrl: string) {
  // The host supplies the absolute URL of its locally cached PDF.js assets.
  const root = new URL(
    assetBaseUrl.endsWith('/') ? assetBaseUrl : `${assetBaseUrl}/`,
  );
  return {
    cMapUrl: new URL('cmaps/', root).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', root).href,
    wasmUrl: new URL('wasm/', root).href,
    // Explicitly bypass PDF.js's document.baseURI-based URL inference.
    useWorkerFetch: true,
  };
}
