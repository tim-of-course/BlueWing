import type { CommandDefinition, PayloadSchema } from './commands';
import type { CommandCall, Project } from './types';
import type {
  CalculationSnapshot,
  ConstructionSnapshot,
} from './calculation-state';
import { sheetPointToWorld, validateConstruction } from './construction';
import { newId } from './geometry';
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
  description: 'Feet along the path from its first point.',
};
const wallHeight = {
  ...positive,
  description: 'Feet above wall base.',
};
const layers = { ...positive, description: 'Number of material layers.' };
const thickness = { ...positive, description: 'Feet per layer.' };
const wastePercent = {
  ...nonnegative,
  description: 'Waste added before package rounding (10 means 10%).',
};
const surfacePackage = {
  ...positive,
  description: 'Square feet covered per package.',
};
const rotation = {
  ...number,
  description: 'Section rotation about the member axis in radians.',
};
const vector = object({ x: number, y: number, z: number });
const offsets = array(
  object(
    {
      along: { ...number, description: 'Longitudinal offset in feet.' },
      face: { ...number, description: 'Offset along wall normal in feet.' },
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
        'Section width in feet, along wall for verticals, across wall for horizontals.',
    },
    depth: {
      ...positive,
      description:
        'Section depth in feet, across wall for verticals, vertical for horizontals.',
    },
    stockLength: {
      ...positive,
      description: 'Length of one purchased stock piece in feet.',
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
      description: 'Gap from stud face to finish in feet, positive outward.',
    },
    thickness,
    startHeight: {
      ...nonnegative,
      description: 'Finish bottom in feet above the wall base. Defaults to 0.',
    },
    height: {
      ...positive,
      description:
        'Finish top in feet above the wall base, clipped to the wall top. Omit to follow the wall top.',
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
          'Wall base in feet above placement Z plus level elevation.',
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
        description: 'On-centre stud spacing in feet.',
      },
      studOffset: {
        ...nonnegative,
        description: 'Feet along the path to the first regular stud station.',
      },
      stud: member,
      track: member,
      kickers: object(
        {
          enabled: { type: 'boolean' },
          spacing: {
            ...positive,
            description: 'On-centre kicker spacing along the wall in feet.',
          },
          cutLength: {
            ...positive,
            description:
              'Length of one diagonal kicker in feet. Required when enabled.',
          },
          member,
        },
        ['enabled', 'spacing', 'member'],
      ),
      bottomAllowance: {
        ...nonnegative,
        description:
          'Raise stud and jamb bottoms above wall base by this many feet.',
      },
      topAllowance: {
        ...nonnegative,
        description: 'Deduct from local stud and jamb top height in feet.',
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
            description: 'Backing centreline above wall base in feet.',
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
          'Feet along the wall path from its first point to the leading rough opening edge.',
      },
      width: {
        ...positive,
        description: 'Rough opening width along the wall in feet.',
      },
      sill: {
        ...nonnegative,
        description:
          'Rough sill above wall base in feet. Zero for a door at the base.',
      },
      height: {
        ...positive,
        description: 'Feet from rough sill to rough head.',
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
                description: 'Feet past the leading rough edge.',
              },
              endExtension: {
                ...nonnegative,
                description: 'Feet past the trailing rough edge.',
              },
              verticalOffset: {
                ...number,
                description: 'Member centreline in feet above the rough head.',
              },
              faceOffset: {
                ...number,
                description: 'Centreline offset along wall normal in feet.',
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
      description: 'Vertical datum in feet above sheet placement Z.',
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
      description: 'World position of pageOrigin in feet. Z points up.',
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
          'Finished underside in feet above placement Z plus level elevation.',
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
              'World XY feet at the intersection of a main and a 4 ft cross-tee row.',
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
  width: 3.625 / 12,
  depth: 1.25 / 12,
  stockLength: 10,
};
const putExamples = {
  walls: {
    id: 'wall-1',
    geometryId: 'original-wall-id',
    baseElevation: 0,
    height: 10,
    studSpacing: 16 / 12,
    stud: {
      materialId: 'stud-3-5-8',
      width: 1.625 / 12,
      depth: 3.625 / 12,
      stockLength: 10,
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
        startExtension: 3 / 12,
        endExtension: 3 / 12,
        verticalOffset: 0.625 / 12,
        faceOffset: 0,
      },
    ],
  },
  openings: {
    id: 'opening-1',
    wallId: 'wall-1',
    distance: 2,
    width: 3,
    sill: 0,
    height: 7,
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
    elevation: 9,
    materialId: 'gypsum-5-8',
    layers: 1,
    thickness: 0.625 / 12,
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
      height: 10,
    },
  ),
  definition(
    'ceiling.fromAssembly',
    'Apply a project ceiling template to one area in a new group and assignment. It inherits grid origin in world XY feet and main direction in radians from world +X.',
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
        : `Replace the ${kind} record. Omitted optional fields are cleared.${kind === 'opening' ? ' Enter each opening once for framing and opening waste. Wall finishes and insulation are installed net and ordered gross through openings with zero default waste percent.' : ''}`,
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

/** A moved room keeps its grid in the same position relative to its boundary. */
function copyWorldOffset(project: Project, sourceId: string, copyId: string) {
  const geometry = project.geometries[sourceId];
  const first = geometry?.points[0];
  const copied = project.geometries[copyId]?.points[0];
  if (!geometry || !first || !copied || geometry.kind !== 'area') return;
  const scale = project.sheets[geometry.sheetId]?.calibration?.feetPerUnit;
  if (!scale || (copied.x === first.x && copied.y === first.y)) return;
  const placement = Object.values(project.construction?.placements ?? {}).find(
    (item) => item.sheetId === geometry.sheetId,
  );
  const from = sheetPointToWorld(first, scale, placement);
  const to = sheetPointToWorld(copied, scale, placement);
  return { x: to.x - from.x, y: to.y - from.y };
}

export function copyDetailedGeometry(
  project: Project,
  sourceId: string,
  newGeometryId: string,
) {
  const resolved = resolveConstruction(project);
  const groupIds = new Set<string>();
  for (const group of Object.values(project.groups)) {
    if (!group.geometryIds.includes(sourceId)) continue;
    group.geometryIds.push(newGeometryId);
    groupIds.add(group.id);
  }

  // Membership supplies the application ID unless an authored ID already uses it.
  function applicationId(assignmentId: string | undefined) {
    const id = `${assignmentId ?? ''}/${newGeometryId}`;
    return resolved.walls[id] ||
      resolved.ceilings[id] ||
      resolved.materials?.[id]
      ? newId()
      : id;
  }

  // Shared junctions refer to a condition by both its owner wall and local ID.
  const walls = new Map(
    Object.values(resolved.walls)
      .filter((wall) => wall.geometryId === sourceId)
      .map((wall) => [
        wall.id,
        {
          id: applicationId(wall.assignmentId),
          conditions: new Map(
            (wall.conditions ?? [])
              .filter((c) => !c.ownerWallId || c.ownerWallId === wall.id)
              .map((c) => [c.id, newId()]),
          ),
        },
      ]),
  );
  const offset = copyWorldOffset(project, sourceId, newGeometryId);
  const assignmentIds: string[] = [];
  const applicationIds: string[] = [];
  const openingIds: string[] = [];
  const conditionIds = new Set<string>();
  const geometry = project.geometries[newGeometryId];
  for (const assignment of Object.values(project.assignments)) {
    const recipe = project.recipes[assignment.recipeId];
    if (!recipe || !groupIds.has(assignment.groupId)) continue;
    const inputs = assignment.geometryInputs?.[sourceId];
    if (inputs)
      (assignment.geometryInputs ??= {})[newGeometryId] =
        structuredClone(inputs);

    const compatible = geometry && recipe.geometryKinds.includes(geometry.kind);
    if (compatible) assignmentIds.push(assignment.id);
    const sourceDetail = assignment.geometryDetails?.[sourceId];
    const modeled =
      compatible &&
      (recipe.wallTemplate ||
        recipe.ceilingTemplate ||
        recipe.materialTemplate);
    if (!modeled && !sourceDetail) continue;
    const detail = structuredClone(sourceDetail ?? {});
    const originalId = detail.id ?? `${assignment.id}/${sourceId}`;
    const wall =
      modeled && recipe.wallTemplate ? resolved.walls[originalId] : undefined;
    const copy = wall && walls.get(wall.id);
    const id = copy?.id ?? applicationId(assignment.id);
    if (sourceDetail?.id || id !== `${assignment.id}/${newGeometryId}`)
      detail.id = id;
    if (modeled) applicationIds.push(id);

    if (wall?.conditions?.length) {
      // A junction whose members belong to a wall on another trace stays
      // behind: the copy stands free there and frames that station itself.
      (detail.wall ??= {}).conditions = wall.conditions.flatMap((source) => {
        const owner = walls.get(source.ownerWallId ?? wall.id);
        if (!owner) return [];
        const condition = structuredClone(source);
        condition.id = owner.conditions.get(source.id) ?? newId();
        if (source.ownerWallId) condition.ownerWallId = owner.id;
        conditionIds.add(condition.id);
        return [condition];
      });
    }
    for (const opening of detail.material?.openings ?? []) {
      opening.id = newId();
      openingIds.push(opening.id);
    }
    if (offset && modeled) {
      const grid =
        recipe.ceilingTemplate && resolved.ceilings[originalId]?.grid;
      if (grid)
        ((detail.ceiling ??= {}).grid ??= {}).origin = {
          x: grid.origin.x + offset.x,
          y: grid.origin.y + offset.y,
        };
      const origin =
        recipe.materialTemplate &&
        resolved.materials?.[originalId]?.template.origin;
      if (origin)
        (detail.material ??= {}).origin = {
          x: origin.x + offset.x,
          y: origin.y + offset.y,
        };
    }
    if (sourceDetail || Object.keys(detail).length)
      (assignment.geometryDetails ??= {})[newGeometryId] = detail;
  }

  const copied = copyWallOpenings(project.construction, walls);
  return {
    groupIds: [...groupIds],
    assignmentIds,
    applicationIds,
    openingIds: [...openingIds, ...copied.openingIds],
    headerIds: copied.headerIds,
    conditionIds: [...conditionIds],
  };
}

function copyWallOpenings(
  context: Project['construction'],
  walls: ReadonlyMap<string, { id: string }>,
) {
  const headers = new Map<string, string>();
  const openingIds: string[] = [];
  if (context) {
    for (const original of Object.values(context.openings)) {
      const wall = walls.get(original.wallId);
      if (!wall) continue;
      const opening = {
        ...structuredClone(original),
        id: newId(),
        wallId: wall.id,
      };
      const header = original.headerId && context.headers[original.headerId];
      if (header) {
        // Openings that shared a header on the source share one independent copy.
        const id = headers.get(header.id) ?? newId();
        context.headers[id] ??= { ...structuredClone(header), id };
        headers.set(header.id, id);
        opening.headerId = id;
      }
      context.openings[opening.id] = opening;
      openingIds.push(opening.id);
    }
  }
  return { openingIds, headerIds: [...headers.values()] };
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
        'stockLength_ft',
        'required',
        'purchased',
        'packages',
        'complete',
        'packedSticks',
        'category',
        'wastePercent',
        'adjustedAmount',
        'purchasedLength_ft',
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
        p.packedCount,
        p.category ?? project.recipes[p.recipeId ?? '']?.category,
        p.wastePercent,
        p.adjustedCount,
        p.purchasedLength,
      ]),
      ...(result.surfacePurchases ?? []).map((purchase) => [
        takeoff?.id,
        purchase.direction ?? 'add',
        purchase.materialId,
        'ft2',
        '',
        purchase.requiredArea,
        purchase.purchasedArea,
        purchase.packageCount,
        result.complete,
        '',
        project.recipes[purchase.recipeId ?? '']?.category,
        purchase.wastePercent,
        purchase.requiredArea * (1 + purchase.wastePercent / 100),
        '',
      ]),
    ]);
  }
  // Installed cut rows carry no purchase amounts. Append each stock order
  // once, under the same units and material columns in either cut schedule.
  const cutScheduleCsv = (
    columns: string[],
    installed: Parameters<typeof csv>[0],
  ) => {
    const orderColumns = [
      'recordType',
      'packedCount',
      'wastePercent',
      'adjustedCount',
      'packageCount',
      'purchasedCount',
      'purchasedLength_ft',
      'quantityKey',
    ];
    const orders = result.purchases.filter(
      (purchase) => purchase.packedCount !== undefined,
    );
    return csv([
      [...columns, ...orderColumns],
      ...installed.map((row) => [
        ...row,
        'installed',
        ...orderColumns.slice(1).map(() => ''),
      ]),
      ...orders.map((purchase) => {
        const values: Record<string, string | number | boolean | undefined> = {
          takeoffId: takeoff?.id,
          direction: purchase.direction ?? 'add',
          material: purchase.materialId,
          category: purchase.category,
          stockLength_ft: purchase.stockLength,
          complete: result.complete,
        };
        return [
          ...columns.map((key) => values[key]),
          'stock-purchase',
          purchase.packedCount,
          purchase.wastePercent,
          purchase.adjustedCount,
          purchase.packageCount,
          purchase.purchasedCount,
          purchase.purchasedLength,
          purchase.quantityKey,
        ];
      }),
    ]);
  };
  if (schedule === 'lengths') {
    const groups = new Map<
      string,
      {
        material: string;
        category: string;
        role: string;
        length: number;
        stock?: number | undefined;
        count: number;
        direction: string;
      }
    >();
    for (const piece of result.pieces) {
      const category = project.recipes[piece.recipeId ?? '']?.category ?? '';
      const key = JSON.stringify([
        piece.direction,
        category,
        piece.materialId,
        piece.role,
        Math.round(piece.cutLength / 3.28e-8),
        piece.stockLength,
      ]);
      const group = groups.get(key) ?? {
        material: piece.materialId,
        category,
        role: piece.role,
        length: piece.cutLength,
        stock: piece.stockLength,
        count: 0,
        direction: piece.direction ?? 'add',
      };
      group.count++;
      groups.set(key, group);
    }
    return cutScheduleCsv(
      [
        'takeoffId',
        'direction',
        'material',
        'category',
        'role',
        'cutLength_ft',
        'stockLength_ft',
        'count',
        'complete',
      ],
      [...groups.values()].map((g) => [
        takeoff?.id,
        g.direction,
        g.material,
        g.category,
        g.role,
        g.length,
        g.stock,
        g.count,
        result.complete,
      ]),
    );
  }
  return cutScheduleCsv(
    [
      'takeoffId',
      'direction',
      'pieceId',
      'material',
      'category',
      'role',
      'wallId',
      'geometryId',
      'openingId',
      'cutLength_ft',
      'stockLength_ft',
      'startX_ft',
      'startY_ft',
      'startZ_ft',
      'endX_ft',
      'endY_ft',
      'endZ_ft',
      'complete',
    ],
    result.pieces.map((p) => [
      takeoff?.id,
      p.direction ?? 'add',
      p.id,
      p.materialId,
      project.recipes[p.recipeId ?? '']?.category ?? '',
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
  );
}
