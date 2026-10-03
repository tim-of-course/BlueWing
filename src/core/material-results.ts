import type { CalculationOutput, Project } from './types';
import type {
  ConstructionResult,
  ConstructionSource,
  ConstructionSurface,
  ConstructionDiagnostic,
} from './construction-types';
import { purchaseAmount } from './purchasing';

export function surfaceArea(points: ConstructionSurface['points']): number {
  let x = 0,
    y = 0,
    z = 0;
  for (let i = 0; i < points.length; i++) {
    const a = present(points[i]),
      b = present(points[(i + 1) % points.length]);
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  return Math.hypot(x, y, z) / 2;
}

function provenance(source: ConstructionSource): ConstructionSource {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) =>
      [
        'assignmentId',
        'recipeId',
        'groupId',
        'componentId',
        'geometryId',
        'wallId',
        'ceilingId',
        'finishId',
      ].includes(key),
    ),
  );
}

/** The records consumed by the renderer are the sole installed quantity source. */
export function summarizeMaterials(result: ConstructionResult): void {
  result.purchases = [];
  result.surfacePurchases = [];
  const members = new Map<string, typeof result.pieces>();
  for (const piece of result.pieces) {
    piece.cutLength = Math.hypot(
      piece.end.x - piece.start.x,
      piece.end.y - piece.start.y,
      piece.end.z - piece.start.z,
    );
    const key = JSON.stringify([
      piece.assignmentId ?? piece.wallId ?? piece.ceilingId,
      piece.materialId,
      piece.stockLength ?? piece.cutLength,
      piece.wastePercent ?? 0,
      piece.packageSize ?? null,
    ]);
    const bucket = members.get(key) ?? [];
    bucket.push(piece);
    members.set(key, bucket);
  }
  for (const pieces of members.values()) {
    const first = present(pieces[0]);
    const amounts = purchaseAmount(
      pieces.length,
      {
        wastePercent: first.wastePercent ?? 0,
        ...(first.packageSize === undefined
          ? {}
          : { packageSize: first.packageSize }),
      },
      true,
    );
    result.purchases.push({
      ...provenance(first),
      role: pieces.every((p) => p.role === first.role) ? first.role : 'member',
      materialId: first.materialId,
      stockLength: first.stockLength ?? first.cutLength,
      requiredCount: pieces.length,
      wastePercent: amounts.wastePercent,
      adjustedCount: amounts.adjustedAmount,
      pieceIds: pieces.map((p) => p.id),
      purchasedCount: amounts.purchasedAmount,
      packageCount: amounts.packageCount,
    });
  }
  const surfaces = new Map<string, ConstructionSurface[]>();
  for (const surface of result.surfaces) {
    surface.geometricArea = surfaceArea(surface.points);
    surface.area = surface.geometricArea * surface.layers;
    const key = JSON.stringify([
      surface.assignmentId ?? surface.wallId ?? surface.ceilingId,
      surface.finishId ?? 'ceiling',
      surface.materialId,
      surface.wastePercent ?? 0,
      surface.packageSize ?? null,
    ]);
    const bucket = surfaces.get(key) ?? [];
    bucket.push(surface);
    surfaces.set(key, bucket);
  }
  for (const patches of surfaces.values()) {
    const first = present(patches[0]);
    const requiredArea = patches.reduce((sum, p) => sum + p.area, 0);
    const amounts = purchaseAmount(requiredArea, {
      wastePercent: first.wastePercent ?? 0,
      ...(first.packageSize === undefined
        ? {}
        : { packageSize: first.packageSize }),
    });
    result.surfacePurchases.push({
      ...provenance(first),
      materialId: first.materialId,
      surfaceIds: patches.map((p) => p.id),
      requiredArea,
      wastePercent: amounts.wastePercent,
      ...(first.packageSize === undefined
        ? {}
        : { packageSize: first.packageSize }),
      packageCount: amounts.packageCount,
      purchasedArea: amounts.purchasedAmount,
    });
  }
}

export function modeledOutputs(
  project: Project,
  result: ConstructionResult,
): CalculationOutput[] {
  const outputs: CalculationOutput[] = [];
  const identity = (source: ConstructionSource) => ({
    groupId: source.groupId ?? '',
    assignmentId: source.assignmentId ?? '',
    recipeId: source.recipeId ?? '',
  });
  const represented = new Set<ConstructionDiagnostic>();
  const messages = (sources: ConstructionSource[]) => {
    const matches = result.diagnostics.filter((d) => {
      if (d.wallId) return sources.some((source) => source.wallId === d.wallId);
      if (d.ceilingId)
        return sources.some((source) => source.ceilingId === d.ceilingId);
      if (d.assignmentId)
        return sources.some((source) => source.assignmentId === d.assignmentId);
      if (d.geometryId)
        return sources.some((source) => source.geometryId === d.geometryId);
      return true;
    });
    for (const diagnostic of matches) represented.add(diagnostic);
    return matches.map((d) => d.message);
  };
  const pieces = new Map(result.pieces.map((p) => [p.id, p]));
  const surfaces = new Map(result.surfaces.map((s) => [s.id, s]));
  for (const [index, purchase] of result.purchases.entries()) {
    const members = purchase.pieceIds.map((id) => present(pieces.get(id)));
    const diagnostics = messages(members);
    const first = present(members[0]);
    const commonCut = members.every(
      (p) => Math.abs(p.cutLength - first.cutLength) < 1e-8,
    );
    outputs.push({
      ...identity(purchase),
      modeling: 'modeled',
      outputId: `members/${String(index)}`,
      materialId: purchase.materialId,
      name:
        project.recipes[purchase.recipeId ?? '']?.name ?? purchase.materialId,
      unit: 'ea',
      role: purchase.role,
      sources: members.map((piece) => ({
        geometryId: piece.geometryId ?? '',
        pieceId: piece.id,
        pieceRole: piece.role,
        inputs: {},
        value: 1,
        cutLength: { value: piece.cutLength, unit: 'm' },
        ...(piece.stockLength === undefined
          ? {}
          : { stockLength: { value: piece.stockLength, unit: 'm' as const } }),
      })),
      ...(first.stockLength === undefined
        ? {}
        : { stockLength: { value: first.stockLength, unit: 'm' as const } }),
      ...(commonCut
        ? { cutLength: { value: first.cutLength, unit: 'm' as const } }
        : {}),
      baseAmount: purchase.requiredCount,
      wastePercent: purchase.wastePercent,
      wasteAmount: purchase.adjustedCount - purchase.requiredCount,
      adjustedAmount: purchase.adjustedCount,
      packageCount: purchase.packageCount,
      purchasedAmount: purchase.purchasedCount,
      complete: !diagnostics.length,
      diagnostics,
    });
  }
  for (const [index, purchase] of (result.surfacePurchases ?? []).entries()) {
    const patches = purchase.surfaceIds.map((id) => present(surfaces.get(id)));
    const diagnostics = messages(patches);
    const base = purchase.requiredArea / 0.09290304;
    outputs.push({
      ...identity(purchase),
      modeling: 'modeled',
      outputId: `surface/${String(index)}`,
      materialId: purchase.materialId,
      name: `${purchase.finishId ?? 'Ceiling'} installed area`,
      unit: 'ft2',
      sources: patches.map((surface) => ({
        geometryId: surface.geometryId ?? '',
        surfaceId: surface.id,
        inputs: { layers: surface.layers },
        value: surface.area / 0.09290304,
      })),
      baseAmount: base,
      wastePercent: purchase.wastePercent,
      wasteAmount: (base * purchase.wastePercent) / 100,
      adjustedAmount: base * (1 + purchase.wastePercent / 100),
      packageCount: purchase.packageCount,
      purchasedAmount: purchase.purchasedArea / 0.09290304,
      complete: !diagnostics.length,
      diagnostics,
    });
  }
  for (const [index, diagnostic] of result.diagnostics.entries()) {
    if (represented.has(diagnostic)) continue;
    outputs.push({
      ...identity(diagnostic),
      modeling: 'unresolved',
      outputId: `unresolved/${String(index)}`,
      materialId: 'Unresolved materials',
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
  return outputs;
}

function present<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('Expected calculated material source');
  return value;
}
