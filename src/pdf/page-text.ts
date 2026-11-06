import type { Sheet } from '../core/types';

export const TITLE_TEXT_LIMIT = 1500;
export interface PageText {
  status: 'text' | 'no-title-block-text';
  text: string;
  region: { x: number; y: number; width: number; height: number };
  characterCount: number;
  truncated: boolean;
}

/** Same visually bottom-right quarter used by the previous page-naming tool. */
export function titleBlockRegion(sheet: Pick<Sheet, 'width' | 'height'>) {
  return {
    x: sheet.width / 2,
    y: sheet.height / 2,
    width: sheet.width / 2,
    height: sheet.height / 2,
  };
}

/** Convert the displayed title-block region to the PDF's unrotated coordinates. */
export function pdfTitleBlockBounds(sheet: Sheet) {
  const [a, b, c, d, e, f] = sheet.pdfToPage ?? [1, 0, 0, -1, 0, sheet.height];
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    throw new Error('Invalid PDF page transform');
  const region = titleBlockRegion(sheet);
  const points = [
    [region.x, region.y],
    [sheet.width, region.y],
    [region.x, sheet.height],
    [sheet.width, sheet.height],
  ].map(([x = 0, y = 0]) => ({
    x: (d * (x - e) - c * (y - f)) / determinant,
    y: (-b * (x - e) + a * (y - f)) / determinant,
  }));
  return {
    left: Math.min(...points.map((point) => point.x)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.min(...points.map((point) => point.y)),
    top: Math.max(...points.map((point) => point.y)),
  };
}
