import type { CalculationOutput, Project } from './types';
import type {
  ConstructionResult,
  ConstructionSource,
  ConstructionSurface,
  FaceRequirement,
  ConstructionDiagnostic,
} from './construction-types';
import { packedStickCount, purchaseAmount } from './purchasing';

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

function sharedSource(items: ConstructionSource[]) {
  const first = present(items[0]);
  const owner = provenance(first);
  for (const key of Object.keys(owner) as (keyof ConstructionSource)[])
    if (items.some((item) => item[key] !== first[key]))
      Reflect.deleteProperty(owner, key);
  return owner;
}

/** The records consumed by the renderer are the sole installed quantity source. */
export function summarizeMaterials(
  project: Project,
  result: ConstructionResult,
): void {
  result.purchases = [];
  result.surfacePurchases = [];
  const members = new Map<string, typeof result.pieces>();
  for (const piece of result.pieces) {
    piece.direction =
      project.assignments[piece.assignmentId ?? '']?.direction ?? 'add';
    piece.cutLength = Math.hypot(
      piece.end.x - piece.start.x,
      piece.end.y - piece.start.y,
      piece.end.z - piece.start.z,
    );
    const key = JSON.stringify([
      piece.stockLength === undefined ? 'cut' : 'stock',
      piece.direction,
      project.recipes[piece.recipeId ?? '']?.category ?? '',
      piece.materialId,
      piece.stockLength ?? piece.cutLength,
      piece.wastePercent ?? 0,
      piece.packageSize ?? null,
    ]);
    const bucket = members.get(key) ?? [];
    bucket.push(piece);
    members.set(key, bucket);
  }
  for (const [key, pieces] of members) {
    const first = present(pieces[0]);
    const packedCount =
      first.stockLength === undefined
        ? undefined
        : packedStickCount(
            pieces.map((piece) => piece.cutLength),
            first.stockLength,
          );
    const stockLength = first.stockLength ?? first.cutLength;
    const amounts = purchaseAmount(
      packedCount ?? pieces.length,
      {
        wastePercent: first.wastePercent ?? 0,
        ...(first.packageSize === undefined
          ? {}
          : { packageSize: first.packageSize }),
      },
      true,
    );
    const owner = sharedSource(pieces);
    result.purchases.push({
      quantityKey: JSON.stringify(['members', key]),
      ...owner,
      direction: first.direction ?? 'add',
      role: pieces.every((p) => p.role === first.role) ? first.role : 'member',
      materialId: first.materialId,
      stockLength,
      ...(packedCount === undefined
        ? {}
        : {
            packedCount,
            category: project.recipes[first.recipeId ?? '']?.category ?? '',
          }),
      purchasedLength: amounts.purchasedAmount * stockLength,
      ...(first.packageSize === undefined
        ? {}
        : { packageSize: first.packageSize }),
      requiredCount: pieces.length,
      wastePercent: amounts.wastePercent,
      adjustedCount: amounts.adjustedAmount,
      pieceIds: pieces.map((p) => p.id),
      purchasedCount: amounts.purchasedAmount,
      packageCount: amounts.packageCount,
    });
  }
  const surfaces = new Map(
    result.surfaces.map((surface) => [surface.id, surface]),
  );
  const faces = result.faceRequirements ?? [];
  const covered = new Set(faces.flatMap((face) => face.surfaceIds));
  const requirements = [...faces];
  for (const surface of result.surfaces) {
    surface.geometricArea = surfaceArea(surface.points);
    surface.area = surface.geometricArea * surface.layers;
    if (!covered.has(surface.id))
      requirements.push({
        ...surface,
        grossArea: surface.area,
        wastePercent: surface.wastePercent ?? 0,
        surfaceIds: [surface.id],
      });
  }
  const buckets = new Map<string, FaceRequirement[]>();
  for (const face of requirements) {
    const key = JSON.stringify([
      project.assignments[face.assignmentId ?? '']?.direction ?? 'add',
      project.recipes[face.recipeId ?? '']?.category ?? '',
      face.materialId,
      face.wastePercent,
      face.packageSize ?? null,
      face.orderDetail ?? null,
    ]);
    const bucket = buckets.get(key) ?? [];
    bucket.push(face);
    buckets.set(key, bucket);
  }
  for (const [key, faces] of buckets) {
    const first = present(faces[0]);
    const surfaceIds = faces.flatMap((f) => f.surfaceIds);
    const requiredArea = surfaceIds.reduce(
      (sum, id) => sum + present(surfaces.get(id)).area,
      0,
    );
    const grossArea = faces.reduce((sum, f) => sum + f.grossArea, 0);
    const orderArea = faces.reduce(
      (sum, f) => sum + (f.orderArea ?? f.grossArea),
      0,
    );
    const amounts = purchaseAmount(orderArea, {
      wastePercent: first.wastePercent,
      ...(first.packageSize === undefined
        ? {}
        : { packageSize: first.packageSize }),
    });
    const groups = new Map<string, number>();
    for (const face of faces) {
      const group = face.groupId ?? '';
      groups.set(
        group,
        (groups.get(group) ?? 0) +
          (face.orderArea ?? face.grossArea) * (1 + face.wastePercent / 100),
      );
    }
    result.surfacePurchases.push({
      quantityKey: JSON.stringify(['surface', key]),
      ...sharedSource(faces),
      category: project.recipes[first.recipeId ?? '']?.category ?? '',
      direction:
        project.assignments[first.assignmentId ?? '']?.direction ?? 'add',
      groupRequirements: [...groups].map(([groupId, amount]) => ({
        groupId,
        amount,
      })),
      materialId: first.materialId,
      surfaceIds,
      ...(faces.some((f) => f.finishId)
        ? { grossArea, openingArea: Math.max(0, grossArea - requiredArea) }
        : {}),
      requiredArea,
      ...(first.packageKind
        ? {
            orderArea,
            packageKind: first.packageKind,
            orderDetail: present(first.orderDetail),
          }
        : {}),
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
    if (!result.diagnostics.length) return [];
    const walls = new Set(sources.map((source) => source.wallId));
    const ceilings = new Set(sources.map((source) => source.ceilingId));
    const assignments = new Set(sources.map((source) => source.assignmentId));
    const geometries = new Set(sources.map((source) => source.geometryId));
    const matches = result.diagnostics.filter((d) => {
      if (d.wallId) return walls.has(d.wallId);
      if (d.ceilingId) return ceilings.has(d.ceilingId);
      if (d.assignmentId) return assignments.has(d.assignmentId);
      if (d.geometryId) return geometries.has(d.geometryId);
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
    const installed = new Map<
      string,
      NonNullable<CalculationOutput['installedByAssignment']>[number]
    >();
    if (purchase.packedCount !== undefined) {
      for (const piece of members) {
        const ids = identity(piece);
        const group = installed.get(ids.assignmentId) ?? {
          ...ids,
          pieceCount: 0,
          cutLength: { value: 0, unit: 'ft' as const },
        };
        group.pieceCount++;
        group.cutLength.value += piece.cutLength;
        installed.set(ids.assignmentId, group);
      }
    }
    const commonCut = members.every(
      (p) => Math.abs(p.cutLength - first.cutLength) < 3.28e-8,
    );
    outputs.push({
      ...identity(purchase),
      modeling: 'modeled',
      outputId: `members/${String(index)}`,
      direction: purchase.direction ?? 'add',
      category: project.recipes[first.recipeId ?? '']?.category ?? '',
      ...(purchase.packageSize === undefined
        ? {}
        : { packageSize: purchase.packageSize }),
      ...(purchase.packedCount === undefined
        ? {}
        : {
            packedCount: purchase.packedCount,
            category: purchase.category ?? '',
            ...(purchase.packageSize === undefined
              ? {}
              : { packageSize: purchase.packageSize }),
            installedByAssignment: [...installed.values()],
          }),
      purchasedLength: { value: purchase.purchasedLength, unit: 'ft' },
      ...(purchase.quantityKey ? { quantityKey: purchase.quantityKey } : {}),
      materialId: purchase.materialId,
      name:
        project.recipes[purchase.recipeId ?? '']?.name ?? purchase.materialId,
      unit: 'ea',
      role: purchase.role,
      sources: members.map((piece) => ({
        ...identity(piece),
        geometryId: piece.geometryId ?? '',
        pieceId: piece.id,
        pieceRole: piece.role,
        inputs: {},
        value: 1,
        cutLength: { value: piece.cutLength, unit: 'ft' },
        ...(piece.stockLength === undefined
          ? {}
          : { stockLength: { value: piece.stockLength, unit: 'ft' as const } }),
      })),
      ...(first.stockLength === undefined
        ? {}
        : { stockLength: { value: first.stockLength, unit: 'ft' as const } }),
      ...(commonCut
        ? { cutLength: { value: first.cutLength, unit: 'ft' as const } }
        : {}),
      baseAmount: purchase.requiredCount,
      wastePercent: purchase.wastePercent,
      wasteAmount:
        purchase.adjustedCount -
        (purchase.packedCount ?? purchase.requiredCount),
      adjustedAmount: purchase.adjustedCount,
      packageCount: purchase.packageCount,
      purchasedAmount: purchase.purchasedCount,
      complete: !diagnostics.length,
      diagnostics,
    });
  }
  for (const [index, purchase] of (result.surfacePurchases ?? []).entries()) {
    const patches = purchase.surfaceIds.map((id) => present(surfaces.get(id)));
    const diagnostics = messages([purchase, ...patches]);
    const base = purchase.requiredArea;
    outputs.push({
      ...identity(purchase),
      modeling: 'modeled',
      direction: purchase.direction ?? 'add',
      category: purchase.category ?? '',
      ...(purchase.groupRequirements
        ? { groupRequirements: purchase.groupRequirements }
        : {}),
      outputId: `surface/${String(index)}`,
      ...(purchase.quantityKey ? { quantityKey: purchase.quantityKey } : {}),
      materialId: purchase.materialId,
      name: purchase.orderDetail
        ? purchase.packageKind === 'bags'
          ? purchase.orderDetail
          : purchase.materialId.replaceAll(/[-_]/g, ' ') +
            ', ' +
            purchase.orderDetail
        : `${purchase.finishId ?? 'Ceiling'} installed area`,
      unit: 'ft2',
      sources: patches.map((surface) => ({
        ...identity(surface),
        geometryId: surface.geometryId ?? '',
        surfaceId: surface.id,
        inputs: { layers: surface.layers },
        value: surface.area,
      })),
      baseAmount: base,
      ...(purchase.orderArea === undefined
        ? {}
        : { orderArea: purchase.orderArea }),
      ...(purchase.orderDetail ? { orderDetail: purchase.orderDetail } : {}),
      ...(purchase.packageKind ? { packageKind: purchase.packageKind } : {}),
      ...(purchase.packageSize === undefined
        ? {}
        : { packageSize: purchase.packageSize }),
      ...(purchase.grossArea === undefined
        ? {}
        : {
            grossArea: purchase.grossArea,
            openingArea: purchase.openingArea ?? 0,
          }),
      wastePercent: purchase.wastePercent,
      wasteAmount:
        ((purchase.orderArea ?? purchase.grossArea ?? base) *
          purchase.wastePercent) /
        100,
      adjustedAmount:
        (purchase.orderArea ?? purchase.grossArea ?? base) *
        (1 + purchase.wastePercent / 100),
      packageCount: purchase.packageCount,
      purchasedAmount: purchase.purchasedArea,
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
