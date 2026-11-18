import type { OutputAllowance } from './types';

/** First fit in stick-opening order, longest cuts first. */
export function packedStickCount(cuts: number[], stockLength: number): number {
  const lengths = [...cuts].sort((a, b) => b - a);
  // Each subtree records the largest offcut in that range of sticks. Finding
  // the first fit stays logarithmic even at the 50,000-piece generation limit.
  const leaves = 2 ** Math.ceil(Math.log2(Math.max(1, lengths.length)));
  const remaining = new Float64Array(2 * leaves);
  const tolerance = Math.min(3.28e-8, stockLength * 1e-9);
  let count = 0;
  for (const length of lengths) {
    // Endpoints are in world coordinates. Allow roundoff at a tight joint,
    // while still requiring positive space for every positive cut.
    const needed = Math.max(length / 2, length - tolerance);
    let node = 1;
    if (needed > (remaining[node] ?? 0) || !count) {
      node = leaves + count++;
      remaining[node] = stockLength;
    } else {
      while (node < leaves) {
        node *= 2;
        if (needed > (remaining[node] ?? 0)) node++;
      }
    }
    remaining[node] = Math.max(0, (remaining[node] ?? 0) - length);
    while (node > 1) {
      node = Math.floor(node / 2);
      remaining[node] = Math.max(
        remaining[node * 2] ?? 0,
        remaining[node * 2 + 1] ?? 0,
      );
    }
  }
  return count;
}

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
