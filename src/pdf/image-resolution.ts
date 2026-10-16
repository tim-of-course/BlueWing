export const PAGE_IMAGE_DPI = 200;
export const PAGE_PREVIEW_DIMENSION = 640;

// A 36 x 48-inch sheet uses 69 MP at 200 DPI. Bound oversized roll drawings
// while keeping ordinary architectural sheets at their requested resolution.
const MAX_IMAGE_PIXELS = 100_000_000;
const MAX_IMAGE_DIMENSION = 16_384;

export function imageDimension(
  bounds: { width: number; height: number },
  requested: number,
): number {
  const longest = Math.max(bounds.width, bounds.height);
  return Math.max(
    64,
    Math.min(
      Math.ceil(requested),
      MAX_IMAGE_DIMENSION,
      Math.floor(
        longest * Math.sqrt(MAX_IMAGE_PIXELS / (bounds.width * bounds.height)),
      ),
    ),
  );
}

export function pageImageDimension(sheet: { width: number; height: number }) {
  return imageDimension(
    sheet,
    (Math.max(sheet.width, sheet.height) * PAGE_IMAGE_DPI) / 72,
  );
}
