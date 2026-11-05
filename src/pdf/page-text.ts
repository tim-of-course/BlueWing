import type { Sheet } from '../core/types';
import type { SheetTextItem } from './sheet-names';

export interface PageText {
  status: 'text' | 'no-embedded-text';
  text: string;
  titleBlockText: string;
  lines: { text: string; x: number; y: number; height: number }[];
  characterCount: number;
  truncated: boolean;
}

/** Geometry uses the same top-left page coordinates as CLI drawing. */
export function pageText(
  items: readonly SheetTextItem[],
  sheet: Sheet,
  characterCount: number,
  truncated: boolean,
): PageText {
  const [a, b, c, d, e, f] = sheet.pdfToPage ?? [1, 0, 0, -1, 0, sheet.height];
  const lines = items
    .map((item) => {
      const x = item.transform[4] ?? 0,
        y = item.transform[5] ?? 0;
      return {
        text: item.str.trim(),
        x: Math.round((a * x + c * y + e) * 100) / 100,
        y: Math.round((b * x + d * y + f) * 100) / 100,
        height: item.height,
      };
    })
    .filter((line) => line.text);
  lines.sort((left, right) => left.y - right.y || left.x - right.x);
  return {
    status: lines.length ? 'text' : 'no-embedded-text',
    text: lines.map((line) => line.text).join('\n'),
    titleBlockText: lines
      .filter((line) => line.x >= sheet.width / 2 && line.y >= sheet.height / 2)
      .map((line) => line.text)
      .join('\n'),
    lines,
    characterCount,
    truncated,
  };
}
