import type { PayloadSchema } from './commands';

export interface StandardSizes {
  studLengths: number[];
  trackLengths: number[];
  sheets: { width: number; length: number }[];
  batts: { name: string; coverage: number }[];
  specialOrderMinimum: number;
}

export function companySizes(): StandardSizes {
  return {
    studLengths: [8, 9, 10, 12, 14, 16, 18, 20],
    trackLengths: [10, 12],
    sheets: [
      [4, 8],
      [4, 9],
      [4, 10],
      [4, 12],
      [4, 14],
      [4, 16],
      [4.5, 12],
      [2, 8],
      [2, 10],
      [2, 12],
    ].map(([width = 0, length = 0]) => ({ width, length })),
    batts: [
      { name: 'R-11 unfaced 16 x 96', coverage: 170.67 },
      { name: 'R-19 unfaced 16 x 96', coverage: 96 },
      { name: 'Mineral wool SAFB 3 in 16 x 48', coverage: 53.33 },
    ],
    specialOrderMinimum: 100,
  };
}

const positive: PayloadSchema = { type: 'number', minimum: Number.MIN_VALUE };
const list = (items: PayloadSchema): PayloadSchema => ({
  type: 'array',
  items,
  minItems: 1,
});
const record = (properties: Record<string, PayloadSchema>): PayloadSchema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const standardSizesSchema = record({
  studLengths: list(positive),
  trackLengths: list(positive),
  sheets: list(record({ width: positive, length: positive })),
  batts: list(record({ name: { type: 'string' }, coverage: positive })),
  specialOrderMinimum: { type: 'number', minimum: 1 },
});

/** Structural validation is shared with the CLI schema. */
export function checkSizes(sizes: StandardSizes) {
  for (const values of [
    sizes.studLengths,
    sizes.trackLengths,
    sizes.sheets.map((s) => String(s.width) + 'x' + String(s.length)),
    sizes.batts.map((b) => b.name.trim()),
  ]) {
    if (
      new Set<number | string>(values).size !== values.length ||
      values.some((value) => value === '')
    )
      throw new Error(
        'Standard sizes require distinct lengths, sheet sizes and batt names',
      );
  }
  if (!Number.isSafeInteger(sizes.specialOrderMinimum))
    throw new Error('Special-order minimum must be a whole number');
}
