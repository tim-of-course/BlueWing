import type { CommandDefinition, PayloadSchema } from './commands';
import type { CommandCall, Project } from './types';
import { validateConstruction } from './construction';
import type { ConstructionData, Wall, Ceiling } from './construction-types';
import {
  applyMaterialAssembly,
  deleteAppliedMaterial,
  emptyConstructionContext,
  putAppliedMaterial,
  resetAppliedMaterial,
  resolveConstruction,
} from './applied-assemblies';
import { calculateProject } from './calculations';
import {
  emptyReview,
  inspectReview,
  pruneReview,
  reviewFingerprint,
  validateReview,
} from './review';
import type { ReviewMark } from './review';

const text: PayloadSchema = { type: 'string' };
const number: PayloadSchema = { type: 'number' };
const nonnegative: PayloadSchema = { type: 'number', minimum: 0 };
const positive: PayloadSchema = { type: 'number', minimum: Number.MIN_VALUE };
const object = (
  properties: Record<string, PayloadSchema>,
  required = Object.keys(properties),
): PayloadSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const array = (items: PayloadSchema): PayloadSchema => ({
  type: 'array',
  items,
});
const point = object({ x: number, y: number });
const vector = object({ x: number, y: number, z: number });
const offsets = array(
  object({ along: number, face: number, rotation: number }, ['along', 'face']),
);
const member = object(
  {
    materialId: text,
    width: positive,
    depth: positive,
    stockLength: positive,
    wastePercent: nonnegative,
    packageSize: positive,
  },
  ['materialId', 'width', 'depth'],
);
const finish = object(
  {
    id: text,
    materialId: text,
    face: { type: 'string', enum: ['front', 'back'] },
    layers: positive,
    offset: number,
    thickness: positive,
    height: positive,
    wastePercent: nonnegative,
    packageSize: positive,
  },
  ['id', 'materialId', 'face', 'layers'],
);
export const constructionSchemas = {
  walls: object(
    {
      id: text,
      geometryId: text,
      levelId: text,
      baseElevation: number,
      height: positive,
      topProfile: object({
        mode: { type: 'string', enum: ['linear', 'step'] },
        points: array(object({ distance: nonnegative, height: positive })),
      }),
      studSpacing: positive,
      studOffset: nonnegative,
      stud: member,
      track: member,
      bottomAllowance: nonnegative,
      topAllowance: nonnegative,
      conditions: array(
        object(
          {
            id: text,
            distance: nonnegative,
            kind: { type: 'string', enum: ['end', 'corner', 'junction'] },
            count: nonnegative,
            ownerWallId: text,
            memberOffsets: offsets,
          },
          ['id', 'distance', 'kind', 'count'],
        ),
      ),
      finishes: array(finish),
      backing: array(object({ id: text, height: nonnegative, member })),
    },
    ['id', 'geometryId', 'baseElevation', 'studSpacing', 'stud', 'track'],
  ),
  openings: object(
    {
      id: text,
      wallId: text,
      distance: nonnegative,
      width: positive,
      sill: nonnegative,
      height: positive,
      jambCount: nonnegative,
      jambOffsets: offsets,
      jamb: member,
      sillMember: member,
      headerId: text,
    },
    ['id', 'wallId', 'distance', 'width', 'sill', 'height', 'jambCount'],
  ),
  headers: object(
    {
      id: text,
      name: text,
      reference: text,
      components: array(
        object(
          {
            id: text,
            role: text,
            member,
            startExtension: nonnegative,
            endExtension: nonnegative,
            verticalOffset: number,
            faceOffset: number,
            sectionRotation: number,
          },
          [
            'id',
            'role',
            'member',
            'startExtension',
            'endExtension',
            'verticalOffset',
            'faceOffset',
          ],
        ),
      ),
    },
    ['id', 'name', 'components'],
  ),
  levels: object({ id: text, name: text, elevation: number }),
  placements: object({
    id: text,
    sheetId: text,
    pageOrigin: point,
    worldOffset: vector,
    rotation: number,
  }),
  ceilings: object(
    {
      id: text,
      geometryId: text,
      levelId: text,
      elevation: number,
      thickness: positive,
      wastePercent: nonnegative,
      packageSize: positive,
      grid: object(
        {
          system: { type: 'string', enum: ['2x2', '2x4'] },
          origin: point,
          rotation: number,
          main: member,
          crossTee4: member,
          crossTee2: member,
          wallAngle: member,
        },
        ['system', 'origin', 'rotation', 'main', 'crossTee4', 'wallAngle'],
      ),
      materialId: text,
      layers: positive,
    },
    ['id', 'geometryId', 'elevation', 'materialId', 'layers'],
  ),
} satisfies Record<Exclude<keyof ConstructionData, 'materials'>, PayloadSchema>;
const wallInstanceFields = new Set([
  'id',
  'geometryId',
  'levelId',
  'topProfile',
  'conditions',
]);
export const wallTemplateSchema: PayloadSchema = object(
  Object.fromEntries(
    Object.entries(constructionSchemas.walls.properties ?? {}).filter(
      ([key]) => !wallInstanceFields.has(key),
    ),
  ),
  (constructionSchemas.walls.required ?? []).filter(
    (key) => !wallInstanceFields.has(key),
  ),
);
export const ceilingTemplateSchema: PayloadSchema = object(
  Object.fromEntries(
    Object.entries(constructionSchemas.ceilings.properties ?? {}).filter(
      ([key]) => !['id', 'geometryId', 'levelId'].includes(key),
    ),
  ),
  (constructionSchemas.ceilings.required ?? []).filter(
    (key) => !['id', 'geometryId', 'levelId'].includes(key),
  ),
);
function overrides(schema: PayloadSchema): PayloadSchema {
  return {
    ...schema,
    required: [],
    properties: Object.fromEntries(
      Object.entries(schema.properties ?? {})
        .filter(([key]) => !['id', 'geometryId'].includes(key))
        .map(([key, value]) => [
          key,
          {
            ...(value.type === 'object' ? overrides(value) : value),
            ...(!schema.required?.includes(key) ? { nullable: true } : {}),
          },
        ]),
    ),
  };
}
export const wallOverrideSchema = overrides(constructionSchemas.walls);
export const ceilingOverrideSchema = overrides(constructionSchemas.ceilings);
export const sourceSchema = object({
  kind: {
    type: 'string',
    enum: ['geometry', 'wall', 'opening', 'assembly', 'header', 'ceiling'],
  },
  id: text,
});
const snippet = object({
  id: text,
  name: text,
  sheetId: text,
  bounds: object({
    x: nonnegative,
    y: nonnegative,
    width: positive,
    height: positive,
  }),
  sources: array(sourceSchema),
  geometryIds: array(text),
  annotations: array(
    object({ points: array(point), label: text, color: text }),
  ),
  note: text,
});
const mark = object({
  id: text,
  target: sourceSchema,
  status: { type: 'string', enum: ['needs-review', 'question', 'reviewed'] },
  note: text,
});
const recordOf = (schema: PayloadSchema): PayloadSchema => ({
  type: 'object',
  additionalProperties: schema,
});
export const constructionSchema = object(
  Object.fromEntries(
    Object.entries(constructionSchemas)
      .filter(([key]) => !['walls', 'ceilings'].includes(key))
      .map(([key, schema]) => [key, recordOf(schema)]),
  ),
);
export const reviewSchema = object({
  snippets: recordOf(snippet),
  marks: recordOf(
    object({ ...mark.properties, fingerprint: text }, mark.required),
  ),
});

function examplePayload(schema: PayloadSchema, key = ''): unknown {
  if (schema.enum) return schema.enum[0];
  if (schema.type === 'object')
    return Object.fromEntries(
      (schema.required ?? []).map((name) => [
        name,
        examplePayload(schema.properties?.[name] ?? {}, name),
      ]),
    );
  if (schema.type === 'array') return [];
  if (schema.type === 'number') return Math.max(1, schema.minimum ?? 0);
  if (schema.type === 'boolean') return false;
  return key === 'color' ? '#f59e0b' : key || 'example';
}
const definition = (
  name: string,
  description: string,
  schema: PayloadSchema,
  mutates: boolean,
  payload?: unknown,
): CommandDefinition => ({
  name,
  description,
  schema,
  mutates,
  examples: [{ name, payload: payload ?? examplePayload(schema) }],
});
const kinds: Record<string, Exclude<keyof ConstructionData, 'materials'>> = {
  wall: 'walls',
  opening: 'openings',
  header: 'headers',
  level: 'levels',
  placement: 'placements',
  ceiling: 'ceilings',
};
export const detailedCommands: CommandDefinition[] = [
  definition(
    'header.fromAssembly',
    'Copy a project member-run assembly into an independent header detail, then assign its id to an opening. Component offsets are relative to the rough opening head; the assembly path elevation is not copied. This does not add a separate material application.',
    object({ assemblyId: text, id: text, name: text }, ['assemblyId', 'id']),
    true,
  ),
  definition(
    'wall.fromAssembly',
    'Apply a live project wall assembly to a trace. Later definition edits update this wall; optional height is a local override. Lengths use metres.',
    object({ assemblyId: text, geometryId: text, id: text, height: positive }, [
      'assemblyId',
      'geometryId',
      'id',
    ]),
    true,
  ),
  definition(
    'ceiling.fromAssembly',
    'Apply a live project ceiling assembly to an area trace.',
    object({ assemblyId: text, geometryId: text, id: text }),
    true,
  ),
  ...(['wall', 'ceiling'] as const).map((kind) =>
    definition(
      `${kind}.reset`,
      'Clear local material overrides and inherit the applied assembly settings.',
      object({ id: text }),
      true,
    ),
  ),
  ...Object.entries(kinds).flatMap(([kind, collection]) => [
    definition(
      `${kind}.put`,
      `Add or replace a ${kind}. Physical lengths use metres; rotations use radians.`,
      constructionSchemas[collection],
      true,
    ),
    definition(
      `${kind}.delete`,
      `Delete a ${kind} and its dependent references in one Undo step.`,
      object({ id: text }),
      true,
      { id: `${kind}-1` },
    ),
  ]),
  definition(
    'construction.inspect',
    'Derive positioned pieces, finish surfaces, purchasing quantities and unresolved inputs.',
    object({}),
    false,
  ),
  definition(
    'construction.export',
    'Export individual positioned pieces or material/length summaries as CSV or JSON.',
    object(
      {
        format: { type: 'string', enum: ['csv', 'json'] },
        schedule: { type: 'string', enum: ['pieces', 'lengths', 'materials'] },
      },
      ['format'],
    ),
    false,
    { format: 'csv', schedule: 'pieces' },
  ),
  definition(
    'snippet.put',
    'Save a highlighted, annotated plan region with source references.',
    snippet,
    true,
  ),
  definition(
    'snippet.delete',
    'Delete a saved plan snippet.',
    object({ id: text }),
    true,
  ),
  definition(
    'review.mark',
    'Set source review status. Reviewing records its current dependencies.',
    mark,
    true,
  ),
  definition(
    'review.inspect',
    'List reviewed, changed, unresolved and unreviewed sources.',
    object({}),
    false,
  ),
];

export function validateDetailed(project: Project): void {
  validateConstruction(project, resolveConstruction(project));
  if (project.review) validateReview(project, project.review);
}

export function executeDetailed(project: Project, call: CommandCall): unknown {
  const payload = (call.payload ?? {}) as Record<string, unknown>;
  const id = payload.id as string;
  if (call.name === 'header.fromAssembly') {
    const assembly = project.recipes[payload.assemblyId as string];
    if (assembly?.materialTemplate?.kind !== 'path-members')
      throw new Error('A header detail needs a member-run assembly');
    const header = {
      id,
      name: (payload.name as string | undefined) ?? assembly.name,
      ...(assembly.reference ? { reference: assembly.reference } : {}),
      components: structuredClone(assembly.materialTemplate.components ?? []),
    };
    const context = (project.construction ??= emptyConstructionContext());
    context.headers[id] = header;
    return header;
  }
  if (
    call.name === 'wall.fromAssembly' ||
    call.name === 'ceiling.fromAssembly'
  ) {
    const kind = call.name === 'wall.fromAssembly' ? 'wall' : 'ceiling';
    applyMaterialAssembly(
      project,
      kind,
      payload.assemblyId as string,
      payload.geometryId as string,
      id,
      payload.height as number | undefined,
    );
    return (
      kind === 'wall'
        ? resolveConstruction(project).walls
        : resolveConstruction(project).ceilings
    )[id];
  }
  const [kind, action] = call.name.split('.');
  if (kind === 'wall' || kind === 'ceiling') {
    if (action === 'put')
      putAppliedMaterial(project, kind, payload as unknown as Wall | Ceiling);
    else if (action === 'reset') resetAppliedMaterial(project, kind, id);
    else deleteAppliedMaterial(project, kind, id);
    return (
      (kind === 'wall'
        ? resolveConstruction(project).walls
        : resolveConstruction(project).ceilings)[id] ?? { deleted: id }
    );
  }
  const collection = kinds[kind ?? ''];
  if (collection && collection !== 'walls' && collection !== 'ceilings') {
    const data = (project.construction ??= emptyConstructionContext());
    const records = data[collection] as Record<string, unknown>;
    if (action === 'put') records[id] = structuredClone(payload);
    else {
      if (!records[id]) throw new Error(`${kind ?? 'Record'} not found`);
      const resolved = resolveConstruction(project);
      if (
        collection === 'levels' &&
        [
          ...Object.values(resolved.walls),
          ...Object.values(resolved.ceilings),
          ...Object.values(resolved.materials ?? {}),
        ].some((item) => item.levelId === id)
      )
        throw new Error('Remove level assignments before deleting the level');
      if (
        collection === 'headers' &&
        Object.values(data.openings).some((item) => item.headerId === id)
      )
        throw new Error('Remove header assignments before deleting the detail');
      Reflect.deleteProperty(records, id);
    }
    return records[id] ?? { deleted: id };
  }
  switch (call.name) {
    case 'construction.inspect':
      return {
        ...calculateProject(project).model,
        applications: resolveConstruction(project),
      };
    case 'construction.export':
      return exportConstruction(
        project,
        payload.format as 'csv' | 'json',
        payload.schedule as 'pieces' | 'lengths' | 'materials' | undefined,
      );
    case 'snippet.put': {
      const review = (project.review ??= emptyReview());
      review.snippets[id] = structuredClone(
        payload,
      ) as unknown as (typeof review.snippets)[string];
      return review.snippets[id];
    }
    case 'snippet.delete': {
      if (!project.review?.snippets[id]) throw new Error('Snippet not found');
      Reflect.deleteProperty(project.review.snippets, id);
      return { deleted: id };
    }
    case 'review.mark': {
      const review = (project.review ??= emptyReview());
      const mark = structuredClone(payload) as unknown as ReviewMark;
      if (mark.status === 'reviewed')
        mark.fingerprint = reviewFingerprint(project, mark.target);
      review.marks[id] = mark;
      return mark;
    }
    case 'review.inspect':
      return inspectReview(project);
    default:
      throw new Error(`Unknown detailed command ${call.name}`);
  }
}

export function pruneDetailed(project: Project): void {
  const data = project.construction;
  if (data) {
    const resolved = resolveConstruction(project);
    for (const [id, opening] of Object.entries(data.openings))
      if (!resolved.walls[opening.wallId])
        Reflect.deleteProperty(data.openings, id);
    for (const [id, placement] of Object.entries(data.placements))
      if (!project.sheets[placement.sheetId])
        Reflect.deleteProperty(data.placements, id);
  }
  pruneReview(project);
}

export function copyDetailedGeometry(
  project: Project,
  sourceId: string,
  newGeometryId: string,
): void {
  const resolved = resolveConstruction(project);
  for (const assignment of Object.values(project.assignments)) {
    const group = project.groups[assignment.groupId];
    const recipe = project.recipes[assignment.recipeId];
    if (
      !group?.geometryIds.includes(sourceId) ||
      !(
        recipe?.wallTemplate ||
        recipe?.ceilingTemplate ||
        recipe?.materialTemplate
      )
    )
      continue;
    const id = crypto.randomUUID();
    const originalId =
      assignment.geometryDetails?.[sourceId]?.id ??
      `${assignment.id}/${sourceId}`;
    const sourceWall = resolved.walls[originalId];
    const groupId = crypto.randomUUID(),
      assignmentId = crypto.randomUUID();
    project.groups[groupId] = {
      id: groupId,
      name: `${group.name} copy`,
      geometryIds: [newGeometryId],
    };
    const details = structuredClone(
      assignment.geometryDetails?.[sourceId] ?? {},
    );
    details.id = id;
    if (sourceWall?.conditions)
      details.wall = {
        ...details.wall,
        conditions: sourceWall.conditions.map((condition) => {
          const copy = { ...condition };
          delete copy.ownerWallId;
          return copy;
        }),
      };
    project.assignments[assignmentId] = {
      ...structuredClone(assignment),
      id: assignmentId,
      groupId,
      geometryInputs: {
        [newGeometryId]: structuredClone(
          assignment.geometryInputs?.[sourceId] ?? {},
        ),
      },
      geometryDetails: { [newGeometryId]: details },
    };
    for (const opening of Object.values(project.construction?.openings ?? {})) {
      if (opening.wallId !== originalId) continue;
      const copy = {
        ...structuredClone(opening),
        id: crypto.randomUUID(),
        wallId: id,
      };
      const context = (project.construction ??= emptyConstructionContext());
      context.openings[copy.id] = copy;
    }
  }
}

function csv(rows: (string | number | boolean | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`)
        .join(','),
    )
    .join('\n');
}
export function exportConstruction(
  project: Project,
  format: 'csv' | 'json',
  schedule: 'pieces' | 'lengths' | 'materials' = 'pieces',
): string {
  const result = calculateProject(project).model;
  if (format === 'json')
    return JSON.stringify(
      { projectId: project.id, revision: project.revision, ...result },
      null,
      2,
    );
  if (schedule === 'materials') {
    return csv([
      [
        'material',
        'unit',
        'stockLength_m',
        'required',
        'purchased',
        'packages',
        'complete',
      ],
      ...result.purchases.map((p) => [
        p.materialId,
        'ea',
        p.stockLength,
        p.requiredCount,
        p.purchasedCount,
        p.packageCount,
        result.complete,
      ]),
      ...(result.surfacePurchases ?? []).map((purchase) => [
        purchase.materialId,
        'm2',
        '',
        purchase.requiredArea,
        purchase.purchasedArea,
        purchase.packageCount,
        result.complete,
      ]),
    ]);
  }
  if (schedule === 'lengths') {
    const groups = new Map<
      string,
      {
        material: string;
        role: string;
        length: number;
        stock?: number | undefined;
        count: number;
      }
    >();
    for (const piece of result.pieces) {
      const key = JSON.stringify([
        piece.materialId,
        piece.role,
        piece.cutLength.toFixed(8),
        piece.stockLength,
      ]);
      const group = groups.get(key) ?? {
        material: piece.materialId,
        role: piece.role,
        length: piece.cutLength,
        stock: piece.stockLength,
        count: 0,
      };
      group.count++;
      groups.set(key, group);
    }
    return csv([
      ['material', 'role', 'cutLength_m', 'stockLength_m', 'count', 'complete'],
      ...[...groups.values()].map((g) => [
        g.material,
        g.role,
        g.length,
        g.stock,
        g.count,
        result.complete,
      ]),
    ]);
  }
  return csv([
    [
      'pieceId',
      'material',
      'role',
      'wallId',
      'geometryId',
      'openingId',
      'cutLength_m',
      'stockLength_m',
      'startX_m',
      'startY_m',
      'startZ_m',
      'endX_m',
      'endY_m',
      'endZ_m',
      'complete',
    ],
    ...result.pieces.map((p) => [
      p.id,
      p.materialId,
      p.role,
      p.wallId,
      p.geometryId,
      p.openingId,
      p.cutLength,
      p.stockLength,
      p.start.x,
      p.start.y,
      p.start.z,
      p.end.x,
      p.end.y,
      p.end.z,
      result.complete,
    ]),
  ]);
}
