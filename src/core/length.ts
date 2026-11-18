export const lengthHint = 'Lengths are feet. Add " for inches: 10\' 6", 16"';
export const lengthError = 'Enter a length in feet or mark inches with ".';

const decimal = /^(?:\d+(?:\.\d+)?|\.\d+)$/;

function inchValue(text: string): number {
  if (decimal.test(text)) return Number(text);
  const fraction = /^(?:(\d+)[ -])?(\d+)\/(\d+)$/.exec(text);
  if (!fraction || Number(fraction[3]) === 0 || Number(fraction[2]) >= Number(fraction[3]))
    throw new Error(lengthError);
  return Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3]);
}

/** An explicit unit overrides the bare-number unit selected on a scale form. */
export function parseLength(text: string, bareUnit: 'ft' | 'in' = 'ft'): number {
  const signed = /^([+-]?)(.+)$/.exec(text.trim());
  if (!signed) throw new Error(lengthError);
  const value = signed[2] ?? '';
  const feet = /^(\d+(?:\.\d+)?|\.\d+)\s*(?:'|ft)\s*(.*)$/i.exec(value);
  let result: number;
  if (feet) {
    const rest = feet[2] ?? '';
    if (rest && !/^\d+$/.test(feet[1] ?? '')) throw new Error(lengthError);
    result = Number(feet[1]) + (rest ? inchValue(rest.replace(/\s*(?:"|in)$/i, '')) / 12 : 0);
  } else if (/(?:"|in)$/i.test(value)) {
    result = inchValue(value.replace(/\s*(?:"|in)$/i, '')) / 12;
  } else if (decimal.test(value)) {
    result = Number(value) / (bareUnit === 'in' ? 12 : 1);
  } else throw new Error(lengthError);
  if (!Number.isFinite(result)) throw new Error(lengthError);
  return signed[1] === '-' ? -result : result;
}

export function formatLength(feet: number): string {
  if (!Number.isFinite(feet)) throw new Error(lengthError);
  const ticks = Math.round(Math.abs(feet) * 192);
  if (!ticks) return "0'";
  const wholeFeet = Math.floor(ticks / 192);
  const inches = Math.floor((ticks % 192) / 16);
  let numerator = ticks % 16;
  let denominator = 16;
  while (numerator && numerator % 2 === 0) {
    numerator /= 2;
    denominator /= 2;
  }
  const inchParts = [
    inches ? String(inches) : '',
    numerator ? String(numerator) + '/' + String(denominator) : '',
  ].filter(Boolean);
  const parts = [wholeFeet ? String(wholeFeet) + "'" : '', inchParts.length ? inchParts.join(' ') + '"' : ''];
  return (feet < 0 ? '-' : '') + parts.filter(Boolean).join(' ');
}
