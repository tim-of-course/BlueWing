import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  suggestSheetName,
  type SheetTextItem,
} from '../../src/pdf/sheet-names';

const page = { width: 1000, height: 800, transform: [1, 0, 0, -1, 0, 800] };
void test('continues an inline title onto a nearby line below', () => {
  assert.deepEqual(
    suggestSheetName(
      [
        text('A 2.0 NEW WORK', 760, 700),
        text('FLOOR PLAN', 800, 716),
        text('ISSUE DATE 03/27/26', 760, 732),
      ],
      page,
    ),
    {
      status: 'suggested',
      code: 'A 2.0',
      title: 'NEW WORK FLOOR PLAN',
      name: 'A 2.0 · NEW WORK FLOOR PLAN',
    },
  );
});
function text(
  str: string,
  x: number,
  y: number,
  height = 12,
  width = str.length * height * 0.55,
): SheetTextItem {
  return { str, transform: [height, 0, 0, height, x, 800 - y], height, width };
}
void test('joins fragmented decimal codes and titles on close lines above the code', () => {
  const result = suggestSheetName(
    [
      text('NEW WORK', 770, 665),
      text('FLOOR PLAN', 770, 681),
      text('A', 810, 735, 24, 16),
      text('2', 832, 735, 24, 12),
      text('.', 844, 735, 24, 5),
      text('0', 849, 735, 24, 12),
      text('03/27/26', 800, 710),
      text('PROJECT 123', 800, 650),
    ],
    page,
  );
  assert.deepEqual(result, {
    status: 'suggested',
    code: 'A 2.0',
    title: 'NEW WORK FLOOR PLAN',
    name: 'A 2.0 · NEW WORK FLOOR PLAN',
  });
});
void test('reads multi-letter codes and multiline titles below them', () => {
  assert.deepEqual(
    suggestSheetName(
      [
        text('A S 101.2', 800, 660, 20),
        text('LEVEL TWO', 800, 692),
        text('REFLECTED CEILING PLAN', 760, 708),
      ],
      page,
    ),
    {
      status: 'suggested',
      code: 'AS 101.2',
      title: 'LEVEL TWO REFLECTED CEILING PLAN',
      name: 'AS 101.2 · LEVEL TWO REFLECTED CEILING PLAN',
    },
  );
});
void test('reads an inline title and normalizes embedded newlines', () => {
  assert.deepEqual(
    suggestSheetName([text('M 2.01 MECHANICAL\nFLOOR PLAN', 650, 740)], page),
    {
      status: 'suggested',
      code: 'M 2.01',
      title: 'MECHANICAL FLOOR PLAN',
      name: 'M 2.01 · MECHANICAL FLOOR PLAN',
    },
  );
});
void test('preserves explicit code spacing but joins tightly adjacent glyph fragments', () => {
  assert.deepEqual(suggestSheetName([text('A 2 . 0', 800, 740)], page), {
    status: 'suggested',
    code: 'A 2.0',
    title: '',
    name: 'A 2.0',
  });
  assert.deepEqual(
    suggestSheetName(
      [
        text('A', 800, 740, 24, 16),
        text('2', 817, 740, 24, 12),
        text('.', 829, 740, 24, 5),
        text('0', 834, 740, 24, 12),
      ],
      page,
    ),
    { status: 'suggested', code: 'A2.0', title: '', name: 'A2.0' },
  );
});
void test('uses only the bottom-right quarter and distinguishes missing text', () => {
  assert.deepEqual(suggestSheetName([], page), { status: 'no-embedded-text' });
  assert.deepEqual(
    suggestSheetName([text('A101', 100, 740), text('A102', 800, 200)], page),
    { status: 'no-match' },
  );
  assert.deepEqual(
    suggestSheetName(
      [
        text('03/27/2026', 800, 700),
        text('12" = 1\u2032', 800, 730),
        text('3300 S NATIONAL AVE', 650, 760),
      ],
      page,
    ),
    { status: 'no-match' },
  );
});
void test('rejects sheet-index codes and does not attach dates or addresses as titles', () => {
  assert.deepEqual(
    suggestSheetName(
      [
        text('A1.0', 650, 500),
        text('A1.1', 650, 520),
        text('A2.0', 650, 540),
        text('COVER', 800, 740, 30),
      ],
      page,
    ),
    { status: 'no-match' },
  );
  assert.deepEqual(
    suggestSheetName(
      [
        text('A9.0', 800, 740, 24),
        text('3300 S NATIONAL AVE', 740, 700),
        text('ISSUE DATE', 800, 710),
        text('03/27/26', 800, 720),
      ],
      page,
    ),
    {
      status: 'suggested',
      code: 'A9.0',
      title: '',
      name: 'A9.0',
    },
  );
});
void test('applies PDF viewport translation, scaling, and 90/180/270 degree rotation', () => {
  for (const transform of [
    [0, 1, 1, 0, 20, 30],
    [-1, 0, 0, 1, 1020, 30],
    [0, -1, -1, 0, 1020, 830],
    [2, 0, 0, -2, 20, 830],
  ]) {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = transform;
    const determinant = a * d - b * c;
    const items = [
      text('A2.0', 800, 740, 24),
      text('FLOOR PLAN', 780, 690),
    ].map((item) => {
      const x = item.transform[4] ?? 0;
      const y = 800 - (item.transform[5] ?? 0);
      const h = item.height;
      const scale = Math.hypot(a, b);
      return {
        ...item,
        width: item.width / scale,
        height: h / scale,
        transform: [
          (d * h) / determinant,
          (-b * h) / determinant,
          (c * h) / determinant,
          (-a * h) / determinant,
          (d * (x - e) - c * (y - f)) / determinant,
          (-b * (x - e) + a * (y - f)) / determinant,
        ],
      };
    });
    assert.equal(
      suggestSheetName(items, { ...page, transform }).status,
      'suggested',
    );
    assert.deepEqual(suggestSheetName(items, { ...page, transform }), {
      status: 'suggested',
      code: 'A2.0',
      title: 'FLOOR PLAN',
      name: 'A2.0 · FLOOR PLAN',
    });
  }
});
