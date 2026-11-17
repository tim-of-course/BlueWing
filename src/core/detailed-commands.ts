import type { CommandDefinition, PayloadSchema } from './commands';
import type { CommandCall, Project } from './types';
import type {
  CalculationSnapshot,
  ConstructionSnapshot,
} from './calculation-state';
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
  categoryName,
  matchesCategories,
  filterConstructionCategories,
  type CategoryFilter,
} from './categories';
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
export const pagePoint = {
  ...point,
  description: 'Rotated page points from top left, x right and y down.',
};
const pathId = {
  ...text,
  description: 'ID of a path geometry in this takeoff.',
};
const areaId = {
  ...text,
  description: 'ID of an area geometry in this takeoff.',
};
const station = {
  ...nonnegative,
  description: 'Metres along the path from its first point.',
};
const wallHeight = {
  ...positive,
  description: 'Metres above wall base (3.048 = 10 ft).',
};
const layers = { ...positive, description: 'Number of material layers.' };
const thickness = { ...positive, description: 'Metres per layer.' };
const wastePercent = {
  ...nonnegative,
  description: 'Waste added before package rounding (10 means 10%).',
};
const surfacePackage = {
  ...positive,
  description: 'Square metres covered per package.',
};
const rotation = {
  ...number,
  description: 'Section rotation about the member axis in radians.',
};
const vector = object({ x: number, y: number, z: number });
const offsets = array(
  object(
    {
      along: { ...number, description: 'Longitudinal offset in metres.' },
      face: { ...number, description: 'Offset along wall normal in metres.' },
      rotation,
    },
    ['along', 'face'],
  ),
);
const member = object(
  {
    materialId: text,
    width: {
      ...positive,
      description:
        'Section width in metres, along wall for verticals, across wall for horizontals.',
    },
    depth: {
      ...positive,
      description:
        'Section depth in metres, across wall for verticals (0.092075 = 3-5/8 in), vertical for horizontals.',
    },
    stockLength: {
      ...positive,
      description: 'Length of one purchased stock piece in metres.',
    },
    wastePercent,
    packageSize: {
      ...positive,
      description: 'Whole stock pieces per package.',
    },
  },
  ['materialId', 'width', 'depth'],
);
const finish = object(
  {
    id: text,
    materialId: text,
    face: {
      type: 'string',
      enum: ['front', 'back'],
      description: 'Front is left of the trace direction in world XY.',
    },
    layers,
    offset: {
      ...number,
      description: 'Gap from stud face to finish in metres, positive outward.',
    },
    thickness,
    height: {
      ...positive,
      description:
        'Metres above wall base, clipped to wall top. Omit for full height.',
    },
    wastePercent,
    packageSize: surfacePackage,
  },
  ['id', 'materialId', 'face', 'layers'],
);
export const constructionSchemas = {
  walls: object(
    {
      id: text,
      geometryId: pathId,
      levelId: text,
      baseElevation: {
        ...number,
        description:
          'Wall base in metres above placement Z plus level elevation.',
      },
      height: wallHeight,
      topProfile: object({
        mode: { type: 'string', enum: ['linear', 'step'] },
        points: {
          ...array(object({ distance: station, height: wallHeight })),
          description:
            'Profile stations in increasing order, starting at zero.',
        },
      }),
      studSpacing: {
        ...positive,
        description: 'On-centre stud spacing in metres (0.4064 = 16 in).',
      },
      studOffset: {
        ...nonnegative,
        description: 'Metres along the path to the first regular stud station.',
      },
      stud: member,
      track: member,
      bottomAllowance: {
        ...nonnegative,
        description:
          'Raise stud and jamb bottoms above wall base by this many metres.',
      },
      topAllowance: {
        ...nonnegative,
        description: 'Deduct from local stud and jamb top height in metres.',
      },
      conditions: array(
        object(
          {
            id: text,
            distance: station,
            kind: { type: 'string', enum: ['end', 'corner', 'junction'] },
            count: {
              ...nonnegative,
              description:
                'Number of members replacing the regular stud at this station.',
            },
            ownerWallId: {
              ...text,
              description:
                'Wall that generates members for this shared condition.',
            },
            memberOffsets: {
              ...offsets,
              description:
                'Centre positions relative to the station, one per member.',
            },
          },
          ['id', 'distance', 'kind', 'count'],
        ),
      ),
      finishes: array(finish),
      backing: array(
        object({
          id: text,
          height: {
            ...nonnegative,
            description: 'Backing centreline above wall base in metres.',
          },
          member,
        }),
      ),
    },
    ['id', 'geometryId', 'baseElevation', 'studSpacing', 'stud', 'track'],
  ),
  openings: object(
    {
      id: text,
      wallId: {
        ...text,
        description: 'Applied wall ID from construction.inspect.',
      },
      distance: {
        ...nonnegative,
        description:
          'Metres along the wall path from its first point to the leading rough opening edge.',
      },
      width: {
        ...positive,
        description: 'Rough opening width along the wall in metres.',
      },
      sill: {
        ...nonnegative,
        description:
          'Rough sill above wall base in metres. Zero for a door at the base.',
      },
      height: {
        ...positive,
        description: 'Metres from rough sill to rough head.',
      },
      jambCount: {
        ...nonnegative,
        description: 'Number of jamb members on each side.',
      },
      jambOffsets: {
        ...offsets,
        description:
          'One entry per jamb on one side, reused on both sides. From nominal centres just outside each rough edge, positive along moves away from the opening.',
      },
      jamb: {
        ...member,
        description: 'Jamb section. Defaults to the wall stud.',
      },
      sillMember: {
        ...member,
        description: 'Sill section for a raised opening.',
      },
      headerId: {
        ...text,
        description: 'ID of a header detail in this takeoff.',
      },
    },
    ['id', 'wallId', 'distance', 'width', 'sill', 'height', 'jambCount'],
  ),
  headers: object(
    {
      id: text,
      name: text,
      reference: text,
      components: {
        description: 'One or more positioned members spanning the rough head.',
        ...array(
          object(
            {
              id: text,
              role: text,
              member,
              startExtension: {
                ...nonnegative,
                description: 'Metres past the leading rough edge.',
              },
              endExtension: {
                ...nonnegative,
                description: 'Metres past the trailing rough edge.',
              },
              verticalOffset: {
                ...number,
                description:
                  'Member centreline in metres above the rough head.',
              },
              faceOffset: {
                ...number,
                description: 'Centreline offset along wall normal in metres.',
              },
              sectionRotation: rotation,
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
    },
    ['id', 'name', 'components'],
  ),
  levels: object({
    id: text,
    name: text,
    elevation: {
      ...number,
      description: 'Vertical datum in metres above sheet placement Z.',
    },
  }),
  placements: object({
    id: text,
    sheetId: text,
    pageOrigin: {
      ...point,
      description:
        'Page coordinates of the point placed at worldOffset, from top left (x right, y down).',
    },
    worldOffset: {
      ...vector,
      description: 'World position of pageOrigin in metres. Z points up.',
    },
    rotation: {
      ...number,
      description:
        'Rotation of the calibrated sheet about world +Z in radians.',
    },
  }),
  ceilings: object(
    {
      id: text,
      geometryId: areaId,
      levelId: text,
      elevation: {
        ...number,
        description:
          'Finished underside in metres above placement Z plus level elevation.',
      },
      thickness,
      wastePercent,
      packageSize: surfacePackage,
      grid: object(
        {
          system: { type: 'string', enum: ['2x2', '2x4'] },
          origin: {
            ...point,
            description:
              'World XY metres at the intersection of a main and a 4 ft cross-tee row.',
          },
          rotation: {
            ...number,
            description: 'Main runner direction in radians from world +X.',
          },
          main: { ...member, description: 'Main runner. Supply stockLength.' },
          crossTee4: { ...member, description: '4 ft cross tee.' },
          crossTee2: {
            ...member,
            description: '2 ft cross tee required for 2x2.',
          },
          wallAngle: {
            ...member,
            description: 'Perimeter angle. Supply stockLength.',
          },
        },
        ['system', 'origin', 'rotation', 'main', 'crossTee4', 'wallAngle'],
      ),
      materialId: text,
      layers,
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
  bounds: {
    description:
      'Crop in page points. x and y locate its top-left corner on the sheet.',
    ...object({
      x: nonnegative,
      y: nonnegative,
      width: positive,
      height: positive,
    }),
  },
  sources: {
    ...array(sourceSchema),
    description: 'Existing records linked as review evidence.',
  },
  geometryIds: {
    ...array(text),
    description: 'Geometry to highlight on this sheet.',
  },
  annotations: array(
    object({
      points: array(pagePoint),
      label: text,
      color: { ...text, description: 'Six-digit hex color, e.g. #f59e0b.' },
    }),
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

const trackExample = {
  materialId: 'track-3-5-8',
  width: 0.092075,
  depth: 0.03175,
  stockLength: 3.048,
};
const putExamples = {
  walls: {
    id: 'wall-1',
    geometryId: 'original-wall-id',
    baseElevation: 0,
    height: 3.048,
    studSpacing: 0.4064,
    stud: {
      materialId: 'stud-3-5-8',
      width: 0.041275,
      depth: 0.092075,
      stockLength: 3.048,
    },
    track: trackExample,
  },
  headers: {
    id: 'header-1',
    name: 'Door head track',
    components: [
      {
        id: 'head-track',
        role: 'head track',
        member: trackExample,
        startExtension: 0.0762,
        endExtension: 0.0762,
        verticalOffset: 0.015875,
        faceOffset: 0,
      },
    ],
  },
  openings: {
    id: 'opening-1',
    wallId: 'wall-1',
    distance: 0.6096,
    width: 0.9144,
    sill: 0,
    height: 2.1336,
    jambCount: 1,
    headerId: 'header-1',
  },
  levels: { id: 'level-1', name: 'Ground floor', elevation: 0 },
  placements: {
    id: 'placement-1',
    sheetId: 'sheet-1',
    pageOrigin: { x: 72, y: 144 },
    worldOffset: { x: 0, y: 0, z: 0 },
    rotation: 0,
  },
  ceilings: {
    id: 'ceiling-1',
    geometryId: 'room-1',
    elevation: 2.7432,
    materialId: 'gypsum-5-8',
    layers: 1,
    thickness: 0.015875,
  },
} satisfies {
  [
    K in Exclude<keyof ConstructionData, 'materials'>
  ]: ConstructionData[K][string];
};

const definition = (
  name: string,
  description: string,
  schema: PayloadSchema,
  mutates: boolean,
  payload: object,
): CommandDefinition => ({
  name,
  description,
  schema,
  mutates,
  examples: [{ name, payload }],
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
    { assemblyId: 'steel-box-header', id: 'header-1' },
  ),
  definition(
    'wall.fromAssembly',
    'Apply a project wall template to one path in a new group and assignment. It inherits later template edits.',
    object(
      {
        assemblyId: {
          ...text,
          description: 'Project assembly with a wallTemplate.',
        },
        geometryId: pathId,
        id: { ...text, description: 'Applied wall ID used by openings.' },
        height: wallHeight,
      },
      ['assemblyId', 'geometryId', 'id'],
    ),
    true,
    {
      assemblyId: 'steel-wall',
      geometryId: 'original-wall-id',
      id: 'wall-1',
      height: 3.048,
    },
  ),
  definition(
    'ceiling.fromAssembly',
    'Apply a project ceiling template to one area in a new group and assignment. It inherits grid origin in world XY metres and main direction in radians from world +X.',
    object({
      assemblyId: {
        ...text,
        description: 'Project assembly with a ceilingTemplate.',
      },
      geometryId: areaId,
      id: { ...text, description: 'Applied ceiling ID.' },
    }),
    true,
    { assemblyId: 'ceiling-grid-2x4', geometryId: 'room-1', id: 'ceiling-1' },
  ),
  ...(['wall', 'ceiling'] as const).map((kind) =>
    definition(
      `${kind}.reset`,
      'Clear local material overrides and inherit the applied assembly settings.',
      object({ id: text }),
      true,
      { id: `${kind}-1` },
    ),
  ),
  ...Object.entries(kinds).flatMap(([kind, collection]) => [
    definition(
      `${kind}.put`,
      kind === 'wall' || kind === 'ceiling'
        ? `Supply a complete resolved ${kind}. Creates an assembly and assignment for a new item, or saves local differences for an existing item.`
        : `Replace the ${kind} record. Omitted optional fields are cleared.${kind === 'opening' ? ' The opening also deducts from every modeled finish and insulation surface on the same trace.' : ''}`,
      constructionSchemas[collection],
      true,
      putExamples[collection],
    ),
    definition(
      `${kind}.delete`,
      kind === 'header' || kind === 'level'
        ? `Delete an unused ${kind}. Refuses while referenced.`
        : `Delete a ${kind} in one undo step.`,
      object({ id: text }),
      true,
      { id: `${kind}-1` },
    ),
  ]),
  definition(
    'construction.inspect',
    'Derive positioned pieces, finish surfaces, purchasing quantities and unresolved inputs.',
    object(
      {
        categories: {
          type: 'array',
          items: { type: 'string', nullable: true },
        },
      },
      [],
    ),
    false,
    {},
  ),
  definition(
    'construction.export',
    'Return a CSV schedule or the complete construction model as JSON.',
    object(
      {
        format: { type: 'string', enum: ['csv', 'json'] },
        schedule: {
          type: 'string',
          enum: ['pieces', 'lengths', 'materials'],
          description: 'Only affects CSV. Defaults to individual pieces.',
        },
      },
      ['format'],
    ),
    false,
    { format: 'csv', schedule: 'pieces' },
  ),
  definition(
    'snippet.put',
    'Replace a saved plan region, its highlights, annotations and source references.',
    snippet,
    true,
    {
      id: 'snippet-1',
      name: 'Wall detail',
      sheetId: 'sheet-1',
      bounds: { x: 0, y: 0, width: 144, height: 72 },
      sources: [{ kind: 'geometry', id: 'original-wall-id' }],
      geometryIds: ['original-wall-id'],
      annotations: [],
      note: 'Check partition detail.',
    },
  ),
  definition(
    'snippet.delete',
    'Delete a saved plan snippet.',
    object({ id: text }),
    true,
    { id: 'snippet-1' },
  ),
  definition(
    'review.mark',
    'Set source review status. Reviewing records its current dependencies.',
    mark,
    true,
    {
      id: 'review-1',
      target: { kind: 'geometry', id: 'original-wall-id' },
      status: 'question',
      note: 'Confirm partition detail.',
    },
  ),
  definition(
    'review.inspect',
    'List reviewed, changed, unresolved and unreviewed sources.',
    object({}),
    false,
    {},
  ),
];

export function validateDetailed(project: Project): void {
  validateConstruction(project, resolveConstruction(project));
  if (project.review) validateReview(project, project.review);
}

export function executeDetailed(
  project: Project,
  call: CommandCall,
  calculation: () => CalculationSnapshot = () => calculateProject(project),
): unknown {
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
    case 'construction.inspect': {
      const categories = payload.categories as CategoryFilter;
      const applications = resolveConstruction(project);
      const include = (source: { recipeId?: string }) =>
        matchesCategories(
          categoryName(project.recipes[source.recipeId ?? '']?.category),
          categories,
        );
      return {
        projectId: project.id,
        revision: project.revision,
        takeoff: project.takeoffs[project.takeoffId ?? 'main'],
        ...filterConstructionCategories(
          project,
          calculation().model,
          categories,
        ),
        categories,
        applications: {
          ...applications,
          walls: Object.fromEntries(
            Object.entries(applications.walls).filter(([, item]) =>
              include(item),
            ),
          ),
          ceilings: Object.fromEntries(
            Object.entries(applications.ceilings).filter(([, item]) =>
              include(item),
            ),
          ),
          materials: Object.fromEntries(
            Object.entries(applications.materials ?? {}).filter(([, item]) =>
              include(item),
            ),
          ),
        },
      };
    }
    case 'construction.export':
      return exportConstruction(
        project,
        payload.format as 'csv' | 'json',
        payload.schedule as 'pieces' | 'lengths' | 'materials' | undefined,
        calculation().model,
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
  result: ConstructionSnapshot = calculateProject(project).model,
): string {
  const takeoff = project.takeoffs[project.takeoffId ?? 'main'];
  if (format === 'json')
    return JSON.stringify(
      { projectId: project.id, revision: project.revision, takeoff, ...result },
      null,
      2,
    );
  if (schedule === 'materials') {
    return csv([
      [
        'takeoffId',
        'direction',
        'material',
        'unit',
        'stockLength_m',
        'required',
        'purchased',
        'packages',
        'complete',
      ],
      ...result.purchases.map((p) => [
        takeoff?.id,
        p.direction ?? 'add',
        p.materialId,
        'ea',
        p.stockLength,
        p.requiredCount,
        p.purchasedCount,
        p.packageCount,
        result.complete,
      ]),
      ...(result.surfacePurchases ?? []).map((purchase) => [
        takeoff?.id,
        purchase.direction ?? 'add',
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
        direction: string;
      }
    >();
    for (const piece of result.pieces) {
      const key = JSON.stringify([
        piece.direction,
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
        direction: piece.direction ?? 'add',
      };
      group.count++;
      groups.set(key, group);
    }
    return csv([
      [
        'takeoffId',
        'direction',
        'material',
        'role',
        'cutLength_m',
        'stockLength_m',
        'count',
        'complete',
      ],
      ...[...groups.values()].map((g) => [
        takeoff?.id,
        g.direction,
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
      'takeoffId',
      'direction',
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
      takeoff?.id,
      p.direction ?? 'add',
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
