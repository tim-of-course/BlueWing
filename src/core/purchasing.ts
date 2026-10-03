import type { OutputAllowance } from './types';

export const wholeQuantity = (value: number): number =>
  Math.max(
    value > 0 ? 1 : 0,
    Math.ceil(value - Number.EPSILON * Math.max(1, Math.abs(value)) * 8),
  );

/** Purchasing is always downstream of installed geometry or an explicit estimate. */
export function purchaseAmount(
  baseAmount: number,
  allowance: OutputAllowance,
  wholePieces = false,
) {
  const { wastePercent, packageSize } = allowance;
  const diagnostics: string[] = [];
  const valid =
    Number.isFinite(wastePercent) &&
    wastePercent >= 0 &&
    (packageSize === undefined ||
      (Number.isFinite(packageSize) && packageSize > 0));
  if (!valid)
    diagnostics.push(
      'Waste must be nonnegative and package size must be positive',
    );
  const wasteAmount = valid ? (baseAmount * wastePercent) / 100 : 0;
  const adjustedAmount = baseAmount + wasteAmount;
  const packageCount =
    valid && packageSize !== undefined
      ? wholeQuantity(adjustedAmount / packageSize)
      : null;
  const purchasedAmount =
    packageCount === null
      ? wholePieces
        ? wholeQuantity(adjustedAmount)
        : adjustedAmount
      : packageCount * (packageSize ?? 0);
  if (
    ![baseAmount, wasteAmount, adjustedAmount, purchasedAmount].every(
      Number.isFinite,
    )
  )
    diagnostics.push('Quantity aggregation overflowed');
  return {
    baseAmount,
    wastePercent,
    wasteAmount,
    adjustedAmount,
    packageCount,
    purchasedAmount,
    diagnostics,
  };
}
