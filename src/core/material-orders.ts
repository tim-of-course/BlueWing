import type { CalculationSnapshot } from './calculation-state';
import type { CalculationOutput } from './types';
import { aggregationOverflowDiagnostic, wholeQuantity } from './purchasing';

/** Requirements use the output unit. A stock cut contributes its fraction of a stick. */
export function orderGroups(output: CalculationSnapshot['outputs'][number]) {
  if (output.groupRequirements) return output.groupRequirements;
  const groups = new Map<string, number>();
  if ((output.stockLength || output.role) && output.sources.length) {
    for (const source of output.sources) {
      const id = source.groupId ?? output.groupId;
      const count = source.value ?? 0;
      const amount = output.stockLength
        ? (count * (source.cutLength?.value ?? output.stockLength.value)) /
          output.stockLength.value
        : count * (1 + output.wastePercent / 100);
      groups.set(id, (groups.get(id) ?? 0) + amount);
    }
  } else groups.set(output.groupId, output.adjustedAmount);
  return [...groups].map(([groupId, amount]) => ({ groupId, amount }));
}

function checkOrderAmounts(order: CalculationOutput): CalculationOutput {
  const amounts = [
    order.baseAmount,
    order.wasteAmount,
    order.adjustedAmount,
    order.packageCount ?? 0,
    order.purchasedAmount,
    order.purchasedLength?.value ?? 0,
    order.grossArea ?? 0,
    order.openingArea ?? 0,
    order.orderArea ?? 0,
    order.packedCount ?? 0,
  ];
  if (
    !amounts.every(Number.isFinite) ||
    order.groupRequirements?.some(({ amount }) => !Number.isFinite(amount))
  ) {
    order.complete = false;
    if (!order.diagnostics.includes(aggregationOverflowDiagnostic))
      order.diagnostics = [...order.diagnostics, aggregationOverflowDiagnostic];
  }
  return order;
}

export function poolOrders(
  contributions: CalculationOutput[],
): CalculationOutput[] {
  const orders = new Map<string, CalculationOutput[]>();
  for (const output of contributions) {
    const key = JSON.stringify([
      output.category ?? '',
      output.materialId,
      output.direction ?? 'add',
      output.unit === 'in' ? 'ft' : output.unit,
      output.stockLength?.value ?? null,
      output.stockLength ? null : (output.cutLength?.value ?? null),
      ...(output.specialOrder ? ['special'] : []),
      output.packageKind ?? null,
      output.orderDetail ?? null,
      output.wastePercent,
      output.packageSize === undefined
        ? null
        : output.packageSize / (output.unit === 'in' ? 12 : 1),
      ...(output.complete
        ? []
        : ['incomplete', output.quantityKey ?? output.outputId]),
    ]);
    const items = orders.get(key) ?? [];
    items.push(output);
    orders.set(key, items);
  }
  return [...orders].map(([key, contributions]) => {
    const mixedLengths =
      contributions.some((i) => i.unit === 'in') &&
      contributions.some((i) => i.unit === 'ft');
    const items = mixedLengths
      ? contributions.map((item) => {
          if (item.unit !== 'in') return item;
          return {
            ...item,
            unit: 'ft' as const,
            baseAmount: item.baseAmount / 12,
            adjustedAmount: item.adjustedAmount / 12,
            wasteAmount: item.wasteAmount / 12,
            purchasedAmount: item.purchasedAmount / 12,
            ...(item.packageSize === undefined
              ? {}
              : { packageSize: item.packageSize / 12 }),
            sources: item.sources.map((s) => ({
              ...s,
              value: s.value === null ? null : s.value / 12,
            })),
          };
        })
      : contributions;
    const first = items[0];
    if (!first) throw new Error('Empty order');
    const order = { ...first };
    const groups = new Map<string, number>();
    for (const item of items) {
      for (const group of orderGroups(item))
        groups.set(
          group.groupId,
          (groups.get(group.groupId) ?? 0) + group.amount,
        );
    }
    order.groupRequirements = [...groups].map(([groupId, amount]) => ({
      groupId,
      amount,
    }));
    order.quantityKey = key;
    if (items.length === 1) return checkOrderAmounts(order);
    const sum = (
      field:
        | 'baseAmount'
        | 'wasteAmount'
        | 'adjustedAmount'
        | 'grossArea'
        | 'openingArea'
        | 'orderArea',
    ) => items.reduce((n, i) => n + (i[field] ?? 0), 0);
    for (const field of ['grossArea', 'openingArea', 'orderArea'] as const)
      if (items.some((i) => i[field] !== undefined))
        order[field] = items.reduce(
          (n, i) =>
            n +
            (i[field] ??
              (field === 'openingArea' ? 0 : (i.grossArea ?? i.baseAmount))),
          0,
        );
    order.sources = items.flatMap((i) => i.sources);
    order.baseAmount = sum('baseAmount');
    order.wasteAmount = sum('wasteAmount');
    order.adjustedAmount = sum('adjustedAmount');
    const size = order.packageSize;
    order.packageCount =
      size === undefined ? null : wholeQuantity(order.adjustedAmount / size);
    order.purchasedAmount =
      size !== undefined
        ? size * (order.packageCount ?? 0)
        : order.role
          ? wholeQuantity(order.adjustedAmount)
          : order.adjustedAmount;
    const length = order.stockLength ?? order.cutLength;
    if (length)
      order.purchasedLength = {
        unit: 'ft',
        value: order.purchasedAmount * length.value,
      };
    if (items.some((i) => i.packedCount !== undefined))
      order.packedCount = items.reduce(
        (n, i) => n + (i.packedCount ?? i.baseAmount),
        0,
      );
    if (items.some((i) => i.installedByAssignment))
      order.installedByAssignment = items.flatMap(
        (i) => i.installedByAssignment ?? [],
      );
    if (items.some((i) => i.cutLength?.value !== order.cutLength?.value))
      delete order.cutLength;
    for (const field of [
      'groupId',
      'assignmentId',
      'recipeId',
      'outputId',
    ] as const)
      if (items.some((i) => i[field] !== order[field])) order[field] = '';
    if (items.some((i) => i.modeling === 'estimate'))
      order.modeling = 'estimate';
    return checkOrderAmounts(order);
  });
}
