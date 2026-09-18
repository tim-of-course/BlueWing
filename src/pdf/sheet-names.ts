/** Plain PDF text geometry; no renderer, UI, OCR, or network dependencies. */
export interface SheetTextItem {
  str: string;
  transform: readonly number[];
  width: number;
  height: number;
}
export interface SheetTextPage {
  width: number;
  height: number;
  transform: readonly number[];
}
export type SheetNameSuggestion =
  | { status: 'suggested'; code: string; title: string; name: string }
  | { status: 'no-match' | 'no-embedded-text' };
interface Line {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
const codePattern =
  /^([A-Z](?:\s*[A-Z]){0,3})(\s*)(\d{1,4}(?:\s*\.\s*\d{1,3})*)(?=$|\s|[:–—-])/;
const metadata =
  /\b(DATE|ISSUED?|REVISION|PROJECT|DRAWN|CHECKED|SCALE|SHEET (?:NO|NUMBER)|ADDRESS|COPYRIGHT)\b/i;
function isTitle(text: string): boolean {
  return (
    /[A-Za-z]{3}/.test(text) &&
    !metadata.test(text) &&
    !/^\d/.test(text) &&
    !/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(text) &&
    !/\b(?:STREET|AVENUE|ROAD|SUITE|BLVD|AVE)\b/i.test(text) &&
    !/["′″']/.test(text) &&
    !codePattern.test(text)
  );
}

/** Read the visually bottom-right quarter after applying the page viewport. */
export function suggestSheetName(
  items: readonly SheetTextItem[],
  page: SheetTextPage,
): SheetNameSuggestion {
  if (!items.some((item) => item.str.trim()))
    return { status: 'no-embedded-text' };
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = page.transform;
  const fragments: Line[] = [];
  for (const item of items) {
    const text = item.str.trim().replace(/\s+/g, ' ');
    if (!text) continue;
    const [ta = 1, tb = 0, tc = 0, td = 1, tx = 0, ty = 0] = item.transform;
    const vx = a * ta + c * tb;
    const vy = b * ta + d * tb;
    // Exclude vertical addresses and diagonal stamps after page rotation.
    if (vx <= 0 || Math.abs(vy) > Math.abs(vx) * 0.15) continue;
    const x = a * tx + c * ty + e;
    const y = b * tx + d * ty + f;
    if (
      x < page.width / 2 ||
      y < page.height / 2 ||
      x > page.width ||
      y > page.height
    )
      continue;
    const scale = Math.hypot(vx, vy) / Math.max(Math.hypot(ta, tb), 0.001);
    fragments.push({
      text,
      x,
      y,
      width: item.width * scale,
      height: Math.max(1, Math.hypot(a * tc + c * td, b * tc + d * td)),
    });
  }
  fragments.sort((left, right) => left.y - right.y || left.x - right.x);
  const lines: Line[] = [];
  for (const fragment of fragments) {
    const line = lines.find(
      (other) =>
        Math.abs(other.y - fragment.y) <=
          Math.min(other.height, fragment.height) * 0.35 &&
        fragment.x >= other.x &&
        fragment.x - (other.x + other.width) <=
          Math.max(other.height, fragment.height) * 2,
    );
    if (line) {
      const gap = fragment.x - (line.x + line.width);
      line.text += `${gap > Math.min(line.height, fragment.height) * 0.15 ? ' ' : ''}${fragment.text}`;
      line.width = Math.max(line.width, fragment.x + fragment.width - line.x);
      line.height = Math.max(line.height, fragment.height);
    } else lines.push({ ...fragment });
  }
  const candidates = lines.flatMap((line) => {
    const match = codePattern.exec(line.text);
    if (!match?.[1]) return [];
    const rest = line.text.slice(match[0].length).replace(/^[\s:–—-]+/, '');
    if (rest && !isTitle(rest)) return [];
    const code = `${match[1].replace(/\s/g, '')}${match[2] ? ' ' : ''}${(match[3] ?? '').replace(/\s/g, '')}`;
    return [{ line, code, rest }];
  });
  // Repeated aligned codes at the same size are usually a sheet index.
  const isolated = candidates.filter(
    ({ line, code }) =>
      !candidates.some(
        (other) =>
          other.code !== code &&
          Math.abs(other.line.x - line.x) < line.height &&
          Math.abs(other.line.y - line.y) <
            Math.max(line.height, other.line.height) * 4 &&
          Math.abs(other.line.height - line.height) < line.height * 0.3,
      ),
  );
  isolated.sort(
    (left, right) =>
      right.line.x / page.width +
      right.line.y / page.height +
      right.line.height / 30 -
      (left.line.x / page.width +
        left.line.y / page.height +
        left.line.height / 30),
  );
  const chosen = isolated[0];
  if (!chosen) return { status: 'no-match' };
  const { line, code, rest } = chosen;
  let title = rest;
  const nearby = lines.filter(
    (other) =>
      other !== line &&
      isTitle(other.text) &&
      Math.abs(other.y - line.y) <=
        Math.max(line.height * 3, page.height * 0.06) &&
      other.x <= line.x + line.width + line.height &&
      other.x + other.width >= line.x - line.height,
  );
  nearby.sort(
    (left, right) => Math.abs(left.y - line.y) - Math.abs(right.y - line.y),
  );
  const nearest = rest ? { ...line, text: rest } : nearby[0];
  if (nearest) {
    const block = [nearest];
    for (const other of nearby) {
      if (other === nearest) continue;
      if (
        rest
          ? other.y <= line.y
          : Math.sign(other.y - line.y) !== Math.sign(nearest.y - line.y)
      )
        continue;
      if (
        block.some(
          (part) =>
            Math.abs(other.y - part.y) <=
              Math.max(other.height, part.height) * 1.8 &&
            Math.abs(other.height - part.height) < part.height * 0.4,
        )
      )
        block.push(other);
    }
    title = block
      .sort((left, right) => left.y - right.y)
      .map((part) => part.text)
      .join(' ');
  }
  return {
    status: 'suggested',
    code,
    title,
    name: title ? `${code} · ${title}` : code,
  };
}
