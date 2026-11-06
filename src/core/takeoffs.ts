import { resolveConstruction } from './applied-assemblies';
import type { CommandCall, Project, Takeoff } from './types';
import type { CommandDefinition } from './commands';
import { newId } from './geometry';

export const ownedCollections = [
  'geometries',
  'groups',
  'recipes',
  'assignments',
] as const;
export function required<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('Required takeoff record is missing');
  return value;
}
export const mainId = (project: Project) =>
  required(Object.values(project.takeoffs).find((t) => t.kind === 'main')).id;
export const takeoffContext = (project: Project) =>
  requireTakeoff(project, project.takeoffId ?? mainId(project));
export function requireTakeoff(project: Project, id: string): Takeoff {
  const entry = Object.hasOwn(project.takeoffs, id) && project.takeoffs[id];
  if (!entry) throw new Error(`Unknown takeoff ${id}`);
  return entry;
}
export function owner(
  project: Project,
  collection: string,
  id: string,
): string {
  return (
    Object.values(project.takeoffs).find((t) =>
      t.owned[collection]?.includes(id),
    )?.id ?? mainId(project)
  );
}
/** Plain-data view, shared by UI, CLI, calculations and renderers. Source sheets stay shared. */
export function takeoffProject(
  project: Project,
  id = project.takeoffId ?? mainId(project),
): Project {
  const takeoff = requireTakeoff(project, id);
  if (project.takeoffId === id) return project;
  const view = {
    ...project,
    takeoffId: id,
    sheets: Object.fromEntries(
      Object.entries(project.sheets).map(([key, sheet]) => {
        if (takeoff.kind === 'main') return [key, sheet];
        const source = { ...sheet };
        delete source.calibration;
        const calibration = takeoff.calibrations[key];
        return [key, { ...source, ...(calibration ? { calibration } : {}) }];
      }),
    ),
  };
  for (const collection of ownedCollections)
    Object.assign(view, {
      [collection]: Object.fromEntries(
        Object.entries(project[collection]).filter(
          ([key]) => owner(project, collection, key) === id,
        ),
      ),
    });
  if (takeoff.kind !== 'main') {
    delete view.construction;
    delete view.review;
    if (takeoff.construction)
      view.construction = structuredClone(takeoff.construction);
    if (takeoff.review) view.review = structuredClone(takeoff.review);
  }
  return view;
}
export function mergeTakeoff(
  project: Project,
  view: Project,
  before: Project,
): void {
  const id = required(view.takeoffId);
  const takeoff = requireTakeoff(project, id);
  for (const collection of ownedCollections) {
    for (const key of Object.keys(before[collection]))
      if (!view[collection][key])
        Reflect.deleteProperty(project[collection], key);
    for (const [key, value] of Object.entries(
      view[collection] as Record<string, object>,
    )) {
      if (project[collection][key] && owner(project, collection, key) !== id)
        throw new Error('Entity belongs to another takeoff');
      Object.assign(project[collection], { [key]: value });
    }
    takeoff.owned[collection] = Object.keys(view[collection]);
  }
  if (takeoff.kind === 'main') {
    project.sheets = view.sheets;
    if (view.construction) project.construction = view.construction;
    else delete project.construction;
    if (view.review) project.review = view.review;
    else delete project.review;
  } else {
    takeoff.calibrations = Object.fromEntries(
      Object.values(view.sheets).flatMap((sheet) =>
        sheet.calibration ? [[sheet.id, sheet.calibration]] : [],
      ),
    );
    if (view.construction) takeoff.construction = view.construction;
    else delete takeoff.construction;
    if (view.review) takeoff.review = view.review;
    else delete takeoff.review;
  }
}
const str = { type: 'string' as const };
export const takeoffCommands: CommandDefinition[] = [
  ['takeoff.list', {}, [], false],
  ['takeoff.inspect', {}, [], false],
  [
    'takeoff.create',
    {
      id: str,
      name: str,
      kind: { type: 'string', enum: ['phase', 'change-order'] },
    },
    ['name', 'kind'],
    true,
  ],
  ['takeoff.rename', { id: str, name: str }, ['id', 'name'], true],
  ['takeoff.delete', { id: str }, ['id'], true],
  [
    'takeoff.copyItems',
    {
      sourceTakeoffId: str,
      geometryIds: { type: 'array', items: str, minItems: 1 },
      direction: { type: 'string', enum: ['add', 'deduct'] },
    },
    ['sourceTakeoffId', 'geometryIds'],
    true,
  ],
].map(([name, properties, required, mutates]) => ({
  name,
  description:
    'Manage independent named takeoffs. copyItems targets the envelope takeoffId.',
  schema: { type: 'object', properties, required, additionalProperties: false },
  mutates,
  examples: [],
})) as CommandDefinition[];

export function manageTakeoff(project: Project, call: CommandCall): unknown {
  const p = (call.payload ?? {}) as Record<string, unknown>;
  if (call.name === 'takeoff.list')
    return Object.values(project.takeoffs).map(
      ({ id, name, kind, mainTakeoffId }) => ({
        id,
        name,
        kind,
        ...(mainTakeoffId ? { mainTakeoffId } : {}),
      }),
    );
  if (call.name === 'takeoff.create') {
    const id = (p.id as string | undefined) ?? newId();
    if (
      !id ||
      ['__proto__', 'constructor', 'prototype'].includes(id) ||
      Object.hasOwn(project.takeoffs, id)
    )
      throw new Error('Invalid or duplicate takeoff ID');
    if (!(p.name as string).trim()) throw new Error('Takeoff name is required');
    return (project.takeoffs[id] = {
      id,
      name: (p.name as string).trim(),
      kind: p.kind as Takeoff['kind'],
      ...(p.kind === 'change-order' ? { mainTakeoffId: mainId(project) } : {}),
      owned: {},
      calibrations: {},
    });
  }
  const destination = requireTakeoff(
    project,
    call.name === 'takeoff.copyItems'
      ? required(call.takeoffId)
      : (p.id as string),
  );
  if (call.name === 'takeoff.rename') {
    if (!(p.name as string).trim()) throw new Error('Takeoff name is required');
    destination.name = (p.name as string).trim();
    return destination;
  }
  if (call.name === 'takeoff.delete') {
    if (destination.kind === 'main') throw new Error('Main cannot be deleted');
    for (const collection of ownedCollections)
      for (const id of destination.owned[collection] ?? [])
        Reflect.deleteProperty(project[collection], id);
    Reflect.deleteProperty(project.takeoffs, destination.id);
    return null;
  }
  const source = takeoffProject(project, p.sourceTakeoffId as string);
  if (source.takeoffId === destination.id)
    throw new Error('Copy requires a different destination takeoff');
  const target = takeoffProject(project, destination.id);
  const before = structuredClone(target);
  const direction = (p.direction ?? 'add') as 'add' | 'deduct';
  if (direction === 'deduct' && destination.kind !== 'change-order')
    throw new Error('Only change orders can deduct');
  const selected = new Set(p.geometryIds as string[]);
  const ids: Record<string, string> = {};
  const remap = (id: string) => (ids[id] ??= newId());
  for (const id of selected) {
    const geometry = source.geometries[id];
    if (!geometry) throw new Error(`Geometry not in source takeoff: ${id}`);
    const calibration = source.sheets[geometry.sheetId]?.calibration;
    const existing = target.sheets[geometry.sheetId]?.calibration;
    if (
      existing &&
      calibration &&
      existing.metresPerUnit !== calibration.metresPerUnit
    )
      throw new Error('Conflicting sheet calibration');
    if (!existing && calibration)
      target.sheets[geometry.sheetId] = {
        ...required(target.sheets[geometry.sheetId]),
        calibration: structuredClone(calibration),
      };
    target.geometries[remap(id)] = {
      ...structuredClone(geometry),
      id: remap(id),
    };
  }
  // Remap every referenced ID in applied definitions/context, while preserving material identities.
  const groups = Object.values(source.groups).filter((g) =>
    g.geometryIds.some((id) => selected.has(id)),
  );
  const assignments = Object.values(source.assignments).filter((a) =>
    groups.some((g) => g.id === a.groupId),
  );
  for (const g of groups) remap(g.id);
  for (const a of assignments) {
    remap(a.id);
    remap(a.recipeId);
  }
  const resolved = resolveConstruction(source);
  const applied = [
    ...Object.values(resolved.walls),
    ...Object.values(resolved.ceilings),
    ...Object.values(resolved.materials ?? {}),
  ].filter(
    (item) =>
      selected.has(item.geometryId) &&
      assignments.some((a) => a.id === item.assignmentId),
  );
  for (const item of applied) remap(item.id);
  const openings = Object.values(source.construction?.openings ?? {}).filter(
    (o) => applied.some((item) => item.id === o.wallId),
  );
  const headers = Object.values(source.construction?.headers ?? {}).filter(
    (h) => openings.some((o) => o.headerId === h.id),
  );
  const levels = Object.values(source.construction?.levels ?? {});
  const sheets = new Set(
    [...selected].map((id) => required(source.geometries[id]).sheetId),
  );
  const placements = Object.values(
    source.construction?.placements ?? {},
  ).filter((p) => sheets.has(p.sheetId));
  for (const item of [...openings, ...headers, ...levels, ...placements])
    remap(item.id);
  for (const a of assignments)
    for (const id of selected)
      if (required(source.groups[a.groupId]).geometryIds.includes(id)) {
        const oldId = a.geometryDetails?.[id]?.id ?? `${a.id}/${id}`;
        remap(oldId);
      }
  const rewrite = <T>(value: T, reference = false, keys = false): T => {
    if (typeof value === 'string')
      return (reference ? (ids[value] ?? value) : value) as T;
    if (Array.isArray(value))
      return (value as unknown[]).map((item) => rewrite(item, reference)) as T;
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          keys ? (ids[key] ?? key) : key,
          key === 'materialId'
            ? item
            : rewrite(
                item,
                key === 'id' || key.endsWith('Id') || key === 'geometryIds',
                key === 'geometryInputs' || key === 'geometryDetails',
              ),
        ]),
      ) as T;
    return value;
  };
  for (const group of groups)
    target.groups[remap(group.id)] = rewrite({
      ...structuredClone(group),
      geometryIds: group.geometryIds.filter((id) => selected.has(id)),
    });
  for (const a of assignments) {
    const copy = structuredClone(a);
    copy.geometryDetails ??= {};
    for (const id of selected)
      if (required(source.groups[a.groupId]).geometryIds.includes(id))
        copy.geometryDetails[id] = {
          ...copy.geometryDetails[id],
          id: a.geometryDetails?.[id]?.id ?? `${a.id}/${id}`,
        };
    for (const key of ['geometryInputs', 'geometryDetails'] as const)
      if (copy[key])
        copy[key] = Object.fromEntries(
          Object.entries(copy[key]).filter(([id]) => selected.has(id)),
        );
    target.assignments[remap(a.id)] = { ...rewrite(copy), direction };
    target.recipes[remap(a.recipeId)] = rewrite(
      structuredClone(required(source.recipes[a.recipeId])),
    );
  }
  if (openings.length || levels.length || placements.length || headers.length) {
    target.construction ??= {
      openings: {},
      headers: {},
      levels: {},
      placements: {},
    };
    for (const [collection, items] of [
      ['openings', openings],
      ['headers', headers],
      ['levels', levels],
      ['placements', placements],
    ] as const)
      for (const item of items)
        Object.assign(target.construction[collection], {
          [remap(item.id)]: rewrite(structuredClone(item)),
        });
  }
  mergeTakeoff(project, target, before);
  (destination.copies ??= []).push({
    sourceTakeoffId: required(source.takeoffId),
    sourceRevision: project.revision,
    ids,
  });
  return { ids, takeoffId: destination.id };
}
