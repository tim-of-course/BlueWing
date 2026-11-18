import { formatLength } from './length';
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
  const realFeet = convertQuantity(scale.real, 'ft').value;
  const feetPerUnit = realFeet / (paperInches * 72);
  if (
    paperInches <= 0 ||
    realFeet <= 0 ||
    !Number.isFinite(feetPerUnit) ||
    feetPerUnit <= 0
  )
    throw new Error('Scale requires positive, finite paper and real distances');
  return { feetPerUnit };
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
];

export function matchingScalePreset(calibration?: Calibration) {
  return calibration
    ? scalePresets.find(
        (preset) =>
          Math.abs(
            calibrationFromRatio(preset).feetPerUnit /
              calibration.feetPerUnit -
              1,
          ) < 1e-9,
      )
    : undefined;
}

export function formatScale(calibration?: Calibration): string {
  if (!calibration) return 'Sheet uncalibrated';
  return (
    matchingScalePreset(calibration)?.label ??
    `1″ = ${formatLength(calibration.feetPerUnit * 72)}`
  );
}
