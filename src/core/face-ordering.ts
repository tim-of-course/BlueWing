import type { PayloadSchema } from './commands';
import type { StandardSizes } from './standard-sizes';
import { wholeQuantity } from './purchasing';

export interface SheetChoice {
  width?: number;
  length?: number;
}
export interface WallSheet extends SheetChoice {
  hangDirection?: 'vertical' | 'horizontal';
}
export interface FacePackaging {
  board?: WallSheet;
  battProduct?: string;
  packageSize?: number;
}
export interface OrderCoverage {
  orderArea?: number;
  orderDetail?: string;
  packageKind?: 'sheets' | 'bags';
  packageSize?: number;
}
const length: PayloadSchema = { type: 'number', minimum: Number.MIN_VALUE };
export const sheetChoiceSchema: PayloadSchema = {
  type: 'object',
  properties: { width: length, length },
  required: [],
  additionalProperties: false,
};
export const wallSheetSchema: PayloadSchema = {
  ...sheetChoiceSchema,
  properties: {
    ...sheetChoiceSchema.properties,
    hangDirection: { type: 'string', enum: ['vertical', 'horizontal'] },
  },
};

/** Integral of ceil(height) from zero, for a linearly sloping finish. */
function wholeFootIntegral(height: number) {
  const floor = Math.floor(height);
  return (floor * (floor + 1)) / 2 + (height - floor) * (floor + 1);
}
function roundedHeight(a: number, b: number) {
  return Math.abs(a - b) < 1e-9
    ? wholeQuantity(Math.max(a, b))
    : (wholeFootIntegral(b) - wholeFootIntegral(a)) / (b - a);
}

export function sizeFace(
  sizes: StandardSizes,
  finish: FacePackaging,
  run: number,
  a: number,
  b: number,
  layers: number,
  ceiling = false,
): OrderCoverage {
  const { board, battProduct, packageSize } = finish;
  if (board && battProduct)
    throw new Error('Choose either a board sheet or a batt product.');
  if (battProduct !== undefined) {
    const coverage =
      sizes.batts.find((b) => b.name === battProduct)?.coverage ?? packageSize;
    if (!coverage)
      throw new Error(
        'Enter bag coverage for ' +
          battProduct +
          ' in standard sizes or the finish package size.',
      );
    return {
      orderArea: run * roundedHeight(a, b) * layers,
      packageKind: 'bags',
      packageSize: coverage,
      orderDetail: battProduct,
    };
  }
  if (!board) return packageSize === undefined ? {} : { packageSize };
  const width = board.width ?? 4;
  const direction = board.hangDirection ?? 'vertical';
  const vertical = !ceiling && direction === 'vertical';
  const sheets = sizes.sheets.filter((sheet) => sheet.width === width);
  const sheet = vertical
    ? sheets
        .filter((s) => s.length + 1e-9 >= Math.max(a, b))
        .sort((x, y) => x.length - y.length)[0]
    : sheets.find((s) => s.length === (board.length ?? 12));
  if (!sheet)
    throw new Error(
      vertical
        ? 'No standard sheet at this width covers the finish height. Hang horizontal or split the finish with a start height.'
        : 'Choose a sheet size from the project standard sizes.',
    );
  const orderHeight = ceiling
    ? 1
    : vertical
      ? sheet.length
      : roundedHeight(a, b);
  return {
    orderArea: run * orderHeight * layers,
    packageKind: 'sheets',
    packageSize: sheet.width * sheet.length,
    orderDetail:
      String(sheet.width) +
      'x' +
      String(sheet.length) +
      (ceiling ? '' : ' ' + direction),
  };
}
