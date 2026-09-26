import type { CommandDefinition, PayloadSchema } from './commands';
import type { CommandCall, Project } from './types';
import {
  emptyConstruction,
  generateConstruction,
  validateConstruction,
} from './construction';
import type { ConstructionData } from './construction-types';
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
    deduction: nonnegative,
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
      quantityMode: { type: 'string', enum: ['reference', 'included'] },
      materialId: text,
      layers: positive,
    },
    ['id', 'geometryId', 'elevation', 'materialId', 'layers'],
  ),
} satisfies Record<keyof ConstructionData, PayloadSchema>;
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
    Object.entries(constructionSchemas).map(([key, schema]) => [
      key,
      recordOf(schema),
    ]),
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
const kinds: Record<string, keyof ConstructionData> = {
  wall: 'walls',
  opening: 'openings',
  header: 'headers',
  level: 'levels',
  placement: 'placements',
  ceiling: 'ceilings',
};
export const detailedCommands: CommandDefinition[] = [
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
  if (project.construction) validateConstruction(project, project.construction);
  if (project.review) validateReview(project, project.review);
}

export function executeDetailed(project: Project, call: CommandCall): unknown {
  const payload = (call.payload ?? {}) as Record<string, unknown>;
  const id = payload.id as string;
  const [kind, action] = call.name.split('.');
  const collection = kinds[kind ?? ''];
  if (collection) {
    const data = (project.construction ??= emptyConstruction());
    const records = data[collection] as Record<string, unknown>;
    if (action === 'put') records[id] = structuredClone(payload);
    else {
      if (!records[id]) throw new Error(`${kind ?? 'Record'} not found`);
      if (
        collection === 'levels' &&
        [...Object.values(data.walls), ...Object.values(data.ceilings)].some(
          (item) => item.levelId === id,
        )
      )
        throw new Error('Remove level assignments before deleting the level');
      if (
        collection === 'headers' &&
        Object.values(data.openings).some((item) => item.headerId === id)
      )
        throw new Error('Remove header assignments before deleting the detail');
      if (collection === 'walls') {
        for (const opening of Object.values(data.openings))
          if (opening.wallId === id)
            Reflect.deleteProperty(data.openings, opening.id);
        for (const wall of Object.values(data.walls))
          if (
            wall.conditions?.some((condition) => condition.ownerWallId === id)
          )
            throw new Error(
              'Reassign shared member ownership before deleting this wall',
            );
      }
      Reflect.deleteProperty(records, id);
    }
    return records[id] ?? { deleted: id };
  }
  switch (call.name) {
    case 'construction.inspect':
      return generateConstruction(
        project,
        project.construction ?? emptyConstruction(),
      );
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
    for (const [id, wall] of Object.entries(data.walls))
      if (!project.geometries[wall.geometryId])
        Reflect.deleteProperty(data.walls, id);
    for (const [id, opening] of Object.entries(data.openings))
      if (!data.walls[opening.wallId])
        Reflect.deleteProperty(data.openings, id);
    for (const [id, ceiling] of Object.entries(data.ceilings))
      if (!project.geometries[ceiling.geometryId])
        Reflect.deleteProperty(data.ceilings, id);
    for (const [id, placement] of Object.entries(data.placements))
      if (!project.sheets[placement.sheetId])
        Reflect.deleteProperty(data.placements, id);
    for (const wall of Object.values(data.walls))
      if (wall.conditions)
        wall.conditions = wall.conditions.filter(
          (condition) =>
            !condition.ownerWallId || data.walls[condition.ownerWallId],
        );
  }
  pruneReview(project);
}

export function copyDetailedGeometry(
  project: Project,
  sourceId: string,
  newGeometryId: string,
): void {
  const data = project.construction;
  if (!data) return;
  for (const source of Object.values(data.walls).filter(
    (wall) => wall.geometryId === sourceId,
  )) {
    const wall = structuredClone(source);
    wall.id = crypto.randomUUID();
    wall.geometryId = newGeometryId;
    if (wall.conditions)
      wall.conditions = wall.conditions.map((condition) => {
        const copy = { ...condition };
        delete copy.ownerWallId;
        return copy;
      });
    data.walls[wall.id] = wall;
    for (const opening of Object.values(data.openings).filter(
      (opening) => opening.wallId === source.id,
    )) {
      const copy = {
        ...structuredClone(opening),
        id: crypto.randomUUID(),
        wallId: wall.id,
      };
      data.openings[copy.id] = copy;
    }
  }
  for (const ceiling of Object.values(data.ceilings).filter(
    (ceiling) => ceiling.geometryId === sourceId,
  )) {
    const copy = {
      ...structuredClone(ceiling),
      id: crypto.randomUUID(),
      geometryId: newGeometryId,
    };
    data.ceilings[copy.id] = copy;
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
  const result = generateConstruction(
    project,
    project.construction ?? emptyConstruction(),
  );
  if (format === 'json')
    return JSON.stringify(
      { projectId: project.id, revision: project.revision, ...result },
      null,
      2,
    );
  if (schedule === 'materials') {
    const areas = new Map<string, number>();
    for (const surface of result.surfaces)
      areas.set(
        surface.materialId,
        (areas.get(surface.materialId) ?? 0) + surface.area,
      );
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
      ...[...areas].map(([material, area]) => [
        material,
        'm2',
        '',
        area,
        area,
        '',
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
