import type { CalculationSnapshot } from './calculation-state';

export function quantityChanges(
  before: CalculationSnapshot,
  after: CalculationSnapshot,
) {
  const key = (total: CalculationSnapshot['totals'][number]) =>
    JSON.stringify([
      total.materialId,
      total.unit,
      total.stockLength,
      total.cutLength,
    ]);
  const previous = new Map(before.totals.map((total) => [key(total), total]));
  const next = new Map(after.totals.map((total) => [key(total), total]));
  return [...new Set([...previous.keys(), ...next.keys()])].flatMap((id) => {
    const a = previous.get(id),
      b = next.get(id);
    const delta = (b?.amount ?? 0) - (a?.amount ?? 0);
    return delta || a?.complete !== b?.complete
      ? [
          {
            materialId: (b ?? a)?.materialId,
            unit: (b ?? a)?.unit,
            stockLength: (b ?? a)?.stockLength,
            before: a?.amount ?? 0,
            after: b?.amount ?? 0,
            delta,
            complete: b?.complete ?? true,
          },
        ]
      : [];
  });
}
