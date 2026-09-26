import type { CalculationOutput, CalculationResult, Project } from './types';
import { generateConstruction } from './construction';
import type { ConstructionResult } from './construction-types';

/** Adapts the one positioned-piece calculation into the ordinary quantity/export pipeline. */
export function constructionOutputs(
  project: Project,
  generated?: ConstructionResult,
): {
  outputs: CalculationOutput[];
  complete: boolean;
} {
  if (!project.construction) return { outputs: [], complete: true };
  const result =
    generated ?? generateConstruction(project, project.construction);
  const outputs: CalculationOutput[] = [];
  const pieces = new Map(result.pieces.map((piece) => [piece.id, piece]));
  for (const [index, purchase] of result.purchases.entries()) {
    const members = purchase.pieceIds
      .map((id) => pieces.get(id))
      .filter((piece) => piece !== undefined);
    const diagnostics = result.diagnostics
      .filter((d) => !d.wallId || members.some((p) => p.wallId === d.wallId))
      .map((d) => d.message);
    const stock = members.every((piece) => piece.stockLength !== undefined);
    const commonCut = members.every(
      (piece) =>
        Math.abs(piece.cutLength - (members[0]?.cutLength ?? 0)) < 1e-8,
    );
    outputs.push({
      groupId: 'Positioned construction',
      assignmentId: 'construction',
      recipeId: 'Positioned members',
      outputId: `members-${String(index)}`,
      materialId: purchase.materialId,
      name: 'Positioned members',
      unit: 'ea',
      role: 'member',
      sources: members.map((piece) => ({
        geometryId: piece.geometryId ?? '',
        pieceId: piece.id,
        pieceRole: piece.role,
        inputs: { cutLength_m: piece.cutLength },
        value: 1,
        cutLength: { value: piece.cutLength, unit: 'm' },
        ...(piece.stockLength === undefined
          ? {}
          : { stockLength: { value: piece.stockLength, unit: 'm' as const } }),
      })),
      ...(stock
        ? { stockLength: { value: purchase.stockLength, unit: 'm' as const } }
        : {}),
      ...(commonCut && members[0]
        ? { cutLength: { value: members[0].cutLength, unit: 'm' as const } }
        : {}),
      baseAmount: purchase.requiredCount,
      wastePercent: purchase.wastePercent,
      wasteAmount: purchase.adjustedCount - purchase.requiredCount,
      adjustedAmount: purchase.adjustedCount,
      packageCount: purchase.packageCount,
      purchasedAmount: purchase.purchasedCount,
      complete: diagnostics.length === 0,
      diagnostics,
    });
  }
  for (const [index, purchase] of (result.surfacePurchases ?? []).entries()) {
    const diagnostics = result.diagnostics
      .filter(
        (d) =>
          (purchase.wallId && d.wallId === purchase.wallId) ||
          (purchase.ceilingId && d.ceilingId === purchase.ceilingId),
      )
      .map((d) => d.message);
    const base = purchase.requiredArea / 0.09290304;
    outputs.push({
      groupId: 'Positioned construction',
      assignmentId: 'construction',
      recipeId: 'Construction finishes',
      outputId: `finish-${String(index)}`,
      materialId: purchase.materialId,
      name: `${purchase.finishId ?? purchase.ceilingId ?? 'Finish'} net area`,
      unit: 'ft2',
      sources: [
        { geometryId: purchase.geometryId ?? '', inputs: {}, value: base },
      ],
      baseAmount: base,
      wastePercent: purchase.wastePercent,
      wasteAmount: (base * purchase.wastePercent) / 100,
      adjustedAmount: base * (1 + purchase.wastePercent / 100),
      packageCount: purchase.packageCount,
      purchasedAmount: purchase.purchasedArea / 0.09290304,
      complete: diagnostics.length === 0,
      diagnostics,
    });
  }
  // A missing height may produce no members; keep that diagnostic visible in ordinary quantities.
  for (const [index, diagnostic] of result.diagnostics.entries()) {
    if (
      outputs.some((output) => output.diagnostics.includes(diagnostic.message))
    )
      continue;
    outputs.push({
      groupId: 'Positioned construction',
      assignmentId: 'construction',
      recipeId: 'Construction review',
      outputId: `diagnostic-${String(index)}`,
      materialId: 'Unresolved construction',
      name: diagnostic.message,
      unit: 'ea',
      sources: [
        {
          geometryId: diagnostic.geometryId ?? '',
          inputs: {},
          value: null,
          diagnostic: diagnostic.message,
        },
      ],
      baseAmount: 0,
      wastePercent: 0,
      wasteAmount: 0,
      adjustedAmount: 0,
      packageCount: null,
      purchasedAmount: 0,
      complete: false,
      diagnostics: [diagnostic.message],
    });
  }
  return { outputs, complete: result.complete };
}

export function quantityChanges(
  before: CalculationResult,
  after: CalculationResult,
) {
  const key = (total: CalculationResult['totals'][number]) =>
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
