import { convertQuantity } from './geometry';
import type { Calibration, LengthUnit } from './types';

export interface ScaleDistance {
  value: number;
  unit: LengthUnit;
}
export interface PaperScale {
  paper: ScaleDistance;
  real: ScaleDistance;
}

/** PDF viewport coordinates retain 72 page units per paper inch. */
export function calibrationFromRatio(scale: PaperScale): Calibration {
  const paperInches = convertQuantity(scale.paper, 'in').value;
  const realMetres = convertQuantity(scale.real, 'm').value;
  const metresPerUnit = realMetres / (paperInches * 72);
  if (
    paperInches <= 0 ||
    realMetres <= 0 ||
    !Number.isFinite(metresPerUnit) ||
    metresPerUnit <= 0
  )
    throw new Error('Scale requires positive, finite paper and real distances');
  return { metresPerUnit };
}

export const scalePresets: (PaperScale & { label: string })[] = [
  ...[
    ['1/16', 1 / 16],
    ['1/8', 1 / 8],
    ['3/16', 3 / 16],
    ['1/4', 1 / 4],
    ['3/8', 3 / 8],
    ['1/2', 1 / 2],
    ['3/4', 3 / 4],
    ['1', 1],
  ].map(([fraction, value]) => ({
    label: `${String(fraction)}″ = 1′-0″`,
    paper: { value: Number(value), unit: 'in' as const },
    real: { value: 1, unit: 'ft' as const },
  })),
  ...[1, 10, 20, 25, 50, 100, 200, 500].map((value) => ({
    label: `1:${String(value)}`,
    paper: { value: 1, unit: 'mm' as const },
    real: { value, unit: 'mm' as const },
  })),
];

export function matchingScalePreset(calibration?: Calibration) {
  return calibration
    ? scalePresets.find(
        (preset) =>
          Math.abs(
            calibrationFromRatio(preset).metresPerUnit /
              calibration.metresPerUnit -
              1,
          ) < 1e-9,
      )
    : undefined;
}

export function formatScale(calibration?: Calibration): string {
  if (!calibration) return 'Sheet uncalibrated';
  return (
    matchingScalePreset(calibration)?.label ??
    `1″ = ${((calibration.metresPerUnit * 72) / 0.3048).toLocaleString(undefined, { maximumFractionDigits: 6 })}′`
  );
}
