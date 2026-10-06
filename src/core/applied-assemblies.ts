import type {
  Assignment,
  Project,
  Recipe,
  WallOverrides,
  CeilingOverrides,
} from './types';
import type {
  ConstructionContext,
  ConstructionData,
  ConstructionSource,
  Wall,
  Ceiling,
} from './construction-types';

export const emptyConstructionContext = (): ConstructionContext => ({
  openings: {},
  headers: {},
  levels: {},
  placements: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Arrays are authored collections; objects inherit individual fields. Null clears an optional default. */
export function mergeMaterialSettings<T>(base: T, override: unknown): T {
  if (!isRecord(base) || !isRecord(override))
    return structuredClone(override ?? base) as T;
  const result: Record<string, unknown> = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (value === null) Reflect.deleteProperty(result, key);
    else
      result[key] =
        isRecord(value) && isRecord(result[key])
          ? mergeMaterialSettings(result[key], value)
          : structuredClone(value);
  }
  return result as T;
}

function difference(base: unknown, value: unknown): Record<string, unknown> {
  const a = isRecord(base) ? base : {};
  const b = isRecord(value) ? value : {};
  const result: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[key]) === JSON.stringify(b[key])) continue;
    result[key] = !(key in b)
      ? null
      : isRecord(a[key]) && isRecord(b[key])
        ? difference(a[key], b[key])
        : structuredClone(b[key]);
  }
  return result;
}

function updateOverrides(
  previous: unknown,
  changed: Record<string, unknown>,
): Record<string, unknown> {
  const next = isRecord(previous) ? structuredClone(previous) : {};
  for (const [key, value] of Object.entries(changed))
    next[key] = isRecord(value)
      ? updateOverrides(next[key], value)
      : structuredClone(value);
  return next;
}

export function materialSettings(
  value: Wall | Ceiling,
): Record<string, unknown> {
  const result = structuredClone(value) as unknown as Record<string, unknown>;
  for (const key of [
    'id',
    'geometryId',
    'assignmentId',
    'recipeId',
    'groupId',
    'componentId',
    'wallId',
    'ceilingId',
    'openingId',
    'finishId',
  ])
    Reflect.deleteProperty(result, key);
  return result;
}

export function resolveConstruction(project: Project): ConstructionData {
  const result: ConstructionData = {
    ...structuredClone(project.construction ?? emptyConstructionContext()),
    walls: {},
    ceilings: {},
    materials: {},
  };
  for (const assignment of Object.values(project.assignments)) {
    const recipe = project.recipes[assignment.recipeId];
    const group = project.groups[assignment.groupId];
    if (!recipe || !group) continue;
    const wallSettings = recipe.wallTemplate
      ? mergeMaterialSettings(recipe.wallTemplate, assignment.wallOverrides)
      : undefined;
    const ceilingSettings = recipe.ceilingTemplate
      ? mergeMaterialSettings(
          recipe.ceilingTemplate,
          assignment.ceilingOverrides,
        )
      : undefined;
    const materialSettings = recipe.materialTemplate
      ? mergeMaterialSettings(
          recipe.materialTemplate,
          assignment.materialOverrides,
        )
      : undefined;
    for (const geometryId of group.geometryIds) {
      const geometry = project.geometries[geometryId];
      if (!geometry || !recipe.geometryKinds.includes(geometry.kind)) continue;
      const detail = assignment.geometryDetails?.[geometryId];
      const id = detail?.id ?? `${assignment.id}/${geometryId}`;
      const source: ConstructionSource = {
        assignmentId: assignment.id,
        recipeId: recipe.id,
        groupId: group.id,
        geometryId,
      };
      if (wallSettings) {
        if (result.walls[id])
          throw new Error(`Duplicate applied wall id: ${id}`);
        result.walls[id] = {
          ...mergeMaterialSettings(wallSettings, detail?.wall),
          ...source,
          id,
          geometryId,
        };
      }
      if (ceilingSettings) {
        if (result.ceilings[id])
          throw new Error(`Duplicate applied ceiling id: ${id}`);
        result.ceilings[id] = {
          ...mergeMaterialSettings(ceilingSettings, detail?.ceiling),
          ...source,
          id,
          geometryId,
        };
      }
      if (materialSettings) {
        const settings = mergeMaterialSettings(
          materialSettings,
          detail?.material,
        ) as typeof recipe.materialTemplate & { levelId?: string };
        const { levelId, ...template } = settings;
        const materials = (result.materials ??= {});
        if (materials[id])
          throw new Error(`Duplicate applied material id: ${id}`);
        materials[id] = {
          ...source,
          id,
          geometryId,
          ...(levelId === undefined ? {} : { levelId }),
          template,
        };
      }
    }
  }
  return result;
}

/** The structured editor authors the same assembly applications as group assignment. */
export function putAppliedMaterial(
  project: Project,
  kind: 'wall' | 'ceiling',
  value: Wall | Ceiling,
): void {
  const resolved = resolveConstruction(project);
  const previous =
    kind === 'wall' ? resolved.walls[value.id] : resolved.ceilings[value.id];
  if (
    previous?.geometryId !== undefined &&
    previous.geometryId !== value.geometryId
  )
    throw new Error(
      'An applied material cannot move to another trace; create a new application.',
    );
  if (previous?.assignmentId) {
    const assignment = present(project.assignments[previous.assignmentId]);
    const details = (assignment.geometryDetails ??= {});
    details[value.geometryId] = {
      ...details[value.geometryId],
      id: value.id,
      [kind]: updateOverrides(
        details[value.geometryId]?.[kind],
        difference(materialSettings(previous), materialSettings(value)),
      ),
    };
    return;
  }
  const recipeId = crypto.randomUUID(),
    groupId = crypto.randomUUID(),
    assignmentId = crypto.randomUUID();
  const settings = materialSettings(value);
  const local: Record<string, unknown> = {};
  for (const key of ['levelId', 'topProfile', 'conditions']) {
    if (key in settings) {
      local[key] = settings[key];
      Reflect.deleteProperty(settings, key);
    }
  }
  project.recipes[recipeId] = {
    id: recipeId,
    name: `${project.geometries[value.geometryId]?.name ?? kind} ${kind} assembly`,
    geometryKinds: [kind === 'wall' ? 'path' : 'area'],
    inputs: [],
    outputs: [],
    ...(kind === 'wall'
      ? { wallTemplate: settings as unknown as Recipe['wallTemplate'] }
      : { ceilingTemplate: settings as unknown as Recipe['ceilingTemplate'] }),
  } as Recipe;
  project.groups[groupId] = {
    id: groupId,
    name: project.geometries[value.geometryId]?.name ?? kind,
    geometryIds: [value.geometryId],
  };
  project.assignments[assignmentId] = {
    id: assignmentId,
    groupId,
    recipeId,
    inputs: {},
    allowances: {},
    geometryDetails: { [value.geometryId]: { id: value.id, [kind]: local } },
  };
}

export function applyMaterialAssembly(
  project: Project,
  kind: 'wall' | 'ceiling',
  assemblyId: string,
  geometryId: string,
  id: string,
  height?: number,
): void {
  const recipe = project.recipes[assemblyId];
  if (
    !recipe ||
    !(kind === 'wall' ? recipe.wallTemplate : recipe.ceilingTemplate)
  )
    throw new Error(`${kind} assembly not found`);
  const previous =
    kind === 'wall'
      ? resolveConstruction(project).walls[id]
      : resolveConstruction(project).ceilings[id];
  const local: WallOverrides | CeilingOverrides = previous
    ? materialSettings(previous)
    : {};
  const keep = Object.fromEntries(
    Object.entries(local).filter(([key]) =>
      ['levelId', 'topProfile', 'conditions'].includes(key),
    ),
  );
  if (height !== undefined) {
    keep.height = height;
    delete keep.topProfile;
  }
  if (previous) deleteAppliedMaterial(project, kind, id, false);
  const groupId = crypto.randomUUID(),
    assignmentId = crypto.randomUUID();
  project.groups[groupId] = {
    id: groupId,
    name: `${project.geometries[geometryId]?.name ?? kind} · ${recipe.name}`,
    geometryIds: [geometryId],
  };
  project.assignments[assignmentId] = {
    id: assignmentId,
    groupId,
    recipeId: assemblyId,
    inputs: {},
    allowances: {},
    geometryDetails: { [geometryId]: { id, [kind]: keep } },
  };
}

export function deleteAppliedMaterial(
  project: Project,
  kind: 'wall' | 'ceiling',
  id: string,
  deleteOpenings = true,
): void {
  const data = resolveConstruction(project);
  const item = kind === 'wall' ? data.walls[id] : data.ceilings[id];
  if (!item?.assignmentId) throw new Error(`${kind} not found`);
  if (
    deleteOpenings &&
    kind === 'wall' &&
    Object.values(data.walls).some(
      (w) => w.id !== id && w.conditions?.some((c) => c.ownerWallId === id),
    )
  )
    throw new Error(
      'Reassign shared member ownership before deleting this wall',
    );
  const assignment = present(project.assignments[item.assignmentId]);
  const members = present(
    project.groups[assignment.groupId],
  ).geometryIds.filter((g) => g !== item.geometryId);
  if (!members.length)
    Reflect.deleteProperty(project.assignments, assignment.id);
  else {
    // Other assignments can reuse the original group without losing this trace.
    const groupId = crypto.randomUUID();
    project.groups[groupId] = {
      ...present(project.groups[assignment.groupId]),
      id: groupId,
      geometryIds: members,
    };
    assignment.groupId = groupId;
    delete assignment.geometryDetails?.[item.geometryId];
    delete assignment.geometryInputs?.[item.geometryId];
  }
  if (kind === 'wall' && deleteOpenings)
    for (const opening of Object.values(project.construction?.openings ?? {}))
      if (opening.wallId === id)
        Reflect.deleteProperty(
          present(project.construction).openings,
          opening.id,
        );
}

export function resetAppliedMaterial(
  project: Project,
  kind: 'wall' | 'ceiling',
  id: string,
): void {
  const data = resolveConstruction(project);
  const item = kind === 'wall' ? data.walls[id] : data.ceilings[id];
  if (!item?.assignmentId) throw new Error(`${kind} not found`);
  const assignment: Assignment = present(
    project.assignments[item.assignmentId],
  );
  const detail = assignment.geometryDetails?.[item.geometryId];
  if (detail) Reflect.deleteProperty(detail, kind);
}

/** A copied group keeps its live definitions but owns distinct locations and openings. */
export function copyApplicationDetails(
  project: Project,
  original: Assignment,
  copy: Assignment,
): void {
  const recipe = project.recipes[copy.recipeId];
  if (
    !recipe?.wallTemplate &&
    !recipe?.ceilingTemplate &&
    !recipe?.materialTemplate
  )
    return;
  const ids = new Map<string, string>();
  for (const geometryId of project.groups[copy.groupId]?.geometryIds ?? []) {
    const oldId =
      original.geometryDetails?.[geometryId]?.id ??
      `${original.id}/${geometryId}`;
    const newId = `${copy.id}/${geometryId}`;
    ids.set(oldId, newId);
    (copy.geometryDetails ??= {})[geometryId] = {
      ...copy.geometryDetails[geometryId],
      id: newId,
    };
  }
  for (const settings of [
    copy.wallOverrides,
    ...Object.values(copy.geometryDetails ?? {}).map((detail) => detail.wall),
  ])
    for (const condition of settings?.conditions ?? [])
      if (condition.ownerWallId) {
        const owner = ids.get(condition.ownerWallId);
        if (owner) condition.ownerWallId = owner;
      }
  for (const opening of Object.values(project.construction?.openings ?? {})) {
    const wallId = ids.get(opening.wallId);
    if (!wallId) continue;
    const context = (project.construction ??= emptyConstructionContext());
    const duplicate = {
      ...structuredClone(opening),
      id: crypto.randomUUID(),
      wallId,
    };
    context.openings[duplicate.id] = duplicate;
  }
}

function present<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('Expected calculated material source');
  return value;
}
