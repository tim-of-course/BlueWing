import {
  emptyConstructionContext,
  resolveConstruction,
} from './applied-assemblies';
import type { CommandCall, Project, Takeoff } from './types';
import type { CommandDefinition } from './commands';
import { newId } from './geometry';
import type { WallCondition } from './construction-types';

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
/** Styling is independent of category/group colors and of quantity arithmetic. */
export function deductionGeometryIds(project: Project): string[] {
  return [
    ...new Set(
      Object.values(project.assignments)
        .filter((assignment) => assignment.direction === 'deduct')
        .flatMap(
          (assignment) => project.groups[assignment.groupId]?.geometryIds ?? [],
        ),
    ),
  ];
}
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
  project.sheets = view.sheets;
  if (takeoff.kind === 'main') {
    if (view.construction) project.construction = view.construction;
    else delete project.construction;
    if (view.review) project.review = view.review;
    else delete project.review;
  } else {
    if (view.construction) takeoff.construction = view.construction;
    else delete takeoff.construction;
    if (view.review) takeoff.review = view.review;
    else delete takeoff.review;
  }
}
const str = { type: 'string' as const };
type TakeoffExample = [
  name: string,
  description: string,
  properties: NonNullable<CommandDefinition['schema']['properties']>,
  required: string[],
  mutates: boolean,
  payload: object,
];
const definitions: TakeoffExample[] = [
  [
    'takeoff.list',
    'List takeoff IDs, names and kinds in this project.',
    {},
    [],
    false,
    {},
  ],
  [
    'takeoff.inspect',
    'Read the selected takeoff’s records. Set envelope takeoffId to inspect a different takeoff.',
    {},
    [],
    false,
    {},
  ],
  [
    'takeoff.create',
    'Create an empty phase or change order. New change orders reference Main.',
    {
      id: str,
      name: str,
      kind: { type: 'string', enum: ['phase', 'change-order'] },
    },
    ['name', 'kind'],
    true,
    { id: 'co-id', name: 'Wall replacement', kind: 'change-order' },
  ],
  [
    'takeoff.rename',
    'Rename a takeoff, including Main.',
    { id: str, name: str },
    ['id', 'name'],
    true,
    { id: 'co-id', name: 'CO 01 - Wall replacement' },
  ],
  [
    'takeoff.delete',
    'Delete a phase or change order and all its owned work. Main and shared sheets are retained.',
    { id: str },
    ['id'],
    true,
    { id: 'co-id' },
  ],
  [
    'takeoff.copyItems',
    'Copy independent drawing items and their related groups, assignments and construction into the destination takeoff. For this deduction example set envelope takeoffId to "co-id".',
    {
      sourceTakeoffId: {
        ...str,
        description: 'Takeoff to copy from. Must differ from the destination.',
      },
      geometryIds: {
        type: 'array',
        items: str,
        minItems: 1,
        description: 'IDs of source traces or markers to copy.',
      },
      direction: {
        type: 'string',
        enum: ['add', 'deduct'],
        description:
          'Contribution of copied assignments. Default add. Deduct requires a change-order destination.',
      },
    },
    ['sourceTakeoffId', 'geometryIds'],
    true,
    {
      sourceTakeoffId: 'main',
      geometryIds: ['original-wall-id'],
      direction: 'deduct',
    },
  ],
];
export const takeoffCommands: CommandDefinition[] = definitions.map(
  ([name, description, properties, required, mutates, payload]) => ({
    name,
    description,
    schema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    mutates,
    examples: [{ name, payload }],
  }),
);

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
  const copyRecord = <T extends { id: string }>(record: T): T => ({
    ...structuredClone(record),
    id: remap(record.id),
  });
  for (const id of selected) {
    const geometry = source.geometries[id];
    if (!geometry) throw new Error(`Geometry not in source takeoff: ${id}`);
    target.geometries[remap(id)] = copyRecord(geometry);
  }
  const groups = Object.values(source.groups).filter((g) =>
    g.geometryIds.some((id) => selected.has(id)),
  );
  const assignments = Object.values(source.assignments).filter((a) =>
    groups.some((g) => g.id === a.groupId),
  );
  const { walls } = resolveConstruction(source);
  const openings = Object.values(source.construction?.openings ?? {}).filter(
    (o) => selected.has(required(walls[o.wallId]).geometryId),
  );
  const headers = Object.values(source.construction?.headers ?? {}).filter(
    (h) => openings.some((o) => o.headerId === h.id),
  );
  const sheets = new Set(
    [...selected].map((id) => required(source.geometries[id]).sheetId),
  );
  const placements = Object.values(
    source.construction?.placements ?? {},
  ).filter((p) => sheets.has(p.sheetId));
  const context = () => (target.construction ??= emptyConstructionContext());
  const reusedContextIds: Record<string, string> = {};
  const remapSettings = (settings?: {
    levelId?: string | null;
    conditions?: WallCondition[];
  }) => {
    if (settings?.levelId) {
      const level = required(source.construction?.levels[settings.levelId]);
      const levels = context().levels;
      const existing = Object.values(before.construction?.levels ?? {}).find(
        (item) =>
          item.name === level.name && item.elevation === level.elevation,
      );
      const copy = existing ?? copyRecord(level);
      levels[copy.id] = copy;
      if (existing) reusedContextIds[level.id] = existing.id;
      settings.levelId = copy.id;
    }
    for (const condition of settings?.conditions ?? [])
      if (condition.ownerWallId)
        condition.ownerWallId = remap(condition.ownerWallId);
  };
  for (const group of groups) {
    const copy = copyRecord(group);
    copy.geometryIds = group.geometryIds
      .filter((id) => selected.has(id))
      .map(remap);
    target.groups[copy.id] = copy;
  }
  for (const a of assignments) {
    const copy = copyRecord(a);
    copy.groupId = remap(a.groupId);
    copy.recipeId = remap(a.recipeId);
    copy.direction = direction;
    remapSettings(copy.wallOverrides);
    remapSettings(copy.ceilingOverrides);
    remapSettings(copy.materialOverrides);
    if (copy.geometryInputs)
      copy.geometryInputs = Object.fromEntries(
        Object.entries(copy.geometryInputs)
          .filter(([id]) => selected.has(id))
          .map(([id, inputs]) => [remap(id), inputs]),
      );
    copy.geometryDetails = {};
    for (const id of required(source.groups[a.groupId]).geometryIds) {
      if (!selected.has(id)) continue;
      const detail = structuredClone(a.geometryDetails?.[id] ?? {});
      detail.id = remap(detail.id ?? `${a.id}/${id}`);
      remapSettings(detail.wall);
      remapSettings(detail.ceiling);
      remapSettings(detail.material);
      copy.geometryDetails[remap(id)] = detail;
    }
    target.assignments[copy.id] = copy;
    target.recipes[copy.recipeId] ??= copyRecord(
      required(source.recipes[a.recipeId]),
    );
  }
  for (const header of headers)
    context().headers[remap(header.id)] = copyRecord(header);
  for (const opening of openings) {
    const copy = copyRecord(opening);
    copy.wallId = remap(opening.wallId);
    if (opening.headerId) copy.headerId = remap(opening.headerId);
    context().openings[copy.id] = copy;
  }
  for (const placement of placements) {
    const records = context().placements;
    const existing = Object.values(records).find(
      (p) => p.sheetId === placement.sheetId,
    );
    if (existing) {
      if (
        JSON.stringify({ ...placement, id: existing.id }) !==
        JSON.stringify(existing)
      )
        throw new Error('Conflicting construction placement');
      reusedContextIds[placement.id] = existing.id;
    } else records[remap(placement.id)] = copyRecord(placement);
  }
  Object.assign(ids, reusedContextIds);
  mergeTakeoff(project, target, before);
  (destination.copies ??= []).push({
    sourceTakeoffId: required(source.takeoffId),
    sourceRevision: project.revision,
    ids,
  });
  return { ids, takeoffId: destination.id };
}
