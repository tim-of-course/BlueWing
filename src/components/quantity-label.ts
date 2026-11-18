import { formatLength } from '../core/length';

const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });

export function quantityLabel(value: number, unit: string): string {
  if (unit === 'ft' || unit === 'LF') return formatLength(value);
  if (unit === 'in') return formatLength(value / 12);
  return numbers.format(value) + ' ' + (unit === 'ft2' ? 'ft²' : unit);
}
