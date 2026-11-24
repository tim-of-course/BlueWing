import {
  takeoffCommands,
  manageTakeoff,
  takeoffProject,
  mergeTakeoff,
  mainId,
  ownedCollections,
} from './takeoffs';
import {
  companySizes,
  checkSizes,
  standardSizesSchema,
  type StandardSizes,
} from './standard-sizes';
import {
  annotationKinds,
  checkAnnotationColor,
  validateAnnotation,
  type SheetAnnotation,
} from './annotations';
import { searchNotes } from './notes';
import type {
  Assignment,
  CommandCall,
  Geometry,
  Group,
  Project,
  Recipe,
  Sheet,
} from './types';
import type { CalculationSnapshot } from './calculation-state';
import {
  matchSheetAlignment,
  type MatchSheetAlignmentPayload,
} from './alignment';
import type { Combined3dAlignment } from './types';
import { calibrationFromDistance, newId, validateGeometry } from './geometry';
import {
  calculateProject,
  inspectQuantities,
  exportQuantities,
  pieceSchedule,
  exportPieces,
} from './calculations';
import {
  calibrationFromRatio,
  type PaperScale,
  type ScaleDistance,
} from './scale';
import { assemblyOutputs, validateSystem } from './systems';
import { validateCategoryColor } from './categories';
import { validateWallTemplate, validateCeilingTemplate } from './wall-template';
import { validateFinishHeights } from './construction';
import {
  copyApplicationDetails,
  mergeMaterialSettings,
} from './applied-assemblies';
import {
  materialTemplateSchema,
  materialOverrideSchema,
  materialFieldsSchema,
  validateMaterialTemplate,
  materialGeometryKind,
} from './material-layout';
import {
  detailedCommands,
  pagePoint,
  wallTemplateSchema,
  ceilingTemplateSchema,
  wallOverrideSchema,
  ceilingOverrideSchema,
  constructionSchema,
  reviewSchema,
  executeDetailed,
  validateDetailed,
  pruneDetailed,
  copyDetailedGeometry,
} from './detailed-commands';

export interface PayloadSchema {
  description?: string;
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean';
  nullable?: boolean;
  properties?: Record<string, PayloadSchema>;
  required?: string[];
  items?: PayloadSchema;
  enum?: (string | number | boolean)[];
  additionalProperties?: boolean | PayloadSchema;
  minimum?: number;
  minItems?: number;
  maxItems?: number;
  anyOf?: PayloadSchema[];
}
export interface CommandDefinition {
  name: string;
  description: string;
  schema: PayloadSchema;
  examples: CommandCall[];
  mutates: boolean;
}
const string: PayloadSchema = { type: 'string' };
const number: PayloadSchema = { type: 'number' };
const value: PayloadSchema = { anyOf: [number, { type: 'boolean' }] };
const object = (
  properties: Record<string, PayloadSchema>,
  required = Object.keys(properties),
): PayloadSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const array = (items: PayloadSchema, description?: string): PayloadSchema => ({
  type: 'array',
  items,
  ...(description ? { description } : {}),
});
const positive: PayloadSchema = { type: 'number', minimum: Number.MIN_VALUE };
const point = object({ x: number, y: number });
const translation = {
  dx: { ...number, description: 'Page points right.' },
  dy: { ...number, description: 'Page points down.' },
};
const alignmentFields = {
  offset: {
    ...point,
    description: 'World XY translation in feet after rotation.',
  },
  rotation: {
    ...number,
    description: 'Radians about world +Z after sheet placement.',
  },
};
const combined3dAlignment = {
  ...object(alignmentFields),
  description: 'Presentation transform for combined multi-sheet 3D views.',
};
const lengthUnit: PayloadSchema = {
  type: 'string',
  enum: ['ft', 'in'],
};
const distance = object({ value: positive, unit: lengthUnit });
const unit: PayloadSchema = {
  type: 'string',
  enum: ['ft', 'in', 'ft2', 'ea', 'scalar'],
};
const wastePercent: PayloadSchema = {
  type: 'number',
  minimum: 0,
  description: 'Percent of base quantity added before rounding (10 means 10%).',
};
const packageSize: PayloadSchema = {
  ...positive,
  description: 'Quantity per whole package in the declared output unit.',
};
const allowance = object({ wastePercent, packageSize }, ['wastePercent']);
const allowanceOverride = object(
  { wastePercent, packageSize: { ...packageSize, nullable: true } },
  [],
);
const sheet = object(
  {
    id: string,
    name: string,
    assetId: { ...string, description: 'Stored PDF asset ID.' },
    pageIndex: {
      type: 'number',
      minimum: 0,
      description: 'Zero-based page in the source PDF.',
    },
    order: {
      ...number,
      description: 'Sheet display order. Defaults to pageIndex.',
    },
    width: {
      ...positive,
      description: 'Rotated page width in points (72 per paper inch).',
    },
    height: { ...positive, description: 'Rotated page height in points.' },
    rotation: { ...number, description: 'PDF page rotation in degrees.' },
    pdfToPage: {
      type: 'array',
      items: number,
      minItems: 6,
      maxItems: 6,
      description:
        'Original PDF to rotated page points: [a,b,c,d,e,f] maps (x,y) to (ax+cy+e,bx+dy+f).',
    },
    calibration: object({
      feetPerUnit: {
        ...positive,
        description: 'Real feet per page point, shared by all takeoffs.',
      },
    }),
    combined3dAlignment,
  },
  ['id', 'name', 'assetId', 'pageIndex', 'width', 'height'],
);
const annotationFields = {
  sheetId: string,
  kind: { type: 'string', enum: [...annotationKinds] } as PayloadSchema,
  points: array(point),
  text: string,
};
const annotation = object(
  {
    ...annotationFields,
    id: string,
    author: { type: 'string', enum: ['user', 'agent'] },
    createdAt: string,
  },
  ['sheetId', 'kind', 'points', 'id', 'author', 'createdAt'],
);
const geometry = object({
  id: string,
  name: string,
  sheetId: string,
  kind: {
    type: 'string',
    enum: ['path', 'area', 'count'],
    description: 'Open polyline, closed polygon or independent count markers.',
  },
  points: {
    ...array(pagePoint),
    description:
      'With pixelToPage [0.5,0,0,0.5,100,50], pixel (20,40) is page point (110,70).',
  },
});
const geometryIds = {
  ...array(string),
  description:
    'Unique geometry IDs in this takeoff. Membership can span sheets.',
};
const group = object(
  {
    id: string,
    name: string,
    geometryIds,
    color: { ...string, description: 'Optional group highlight color.' },
  },
  ['id', 'name', 'geometryIds'],
);
const lengthFormula = object({
  formula: {
    ...string,
    description: 'Length expression using geometry metrics and recipe inputs.',
  },
  unit: {
    ...lengthUnit,
    description:
      'Result unit of this expression. Schedules normalize lengths to feet.',
  },
});
const leafAssemblySchema = object(
  {
    id: string,
    name: string,
    category: string,
    description: string,
    reference: string,
    librarySource: object({ id: string, name: string }),
    geometryKinds: array({ type: 'string', enum: ['path', 'area', 'count'] }),
    inputs: array(
      object(
        {
          name: string,
          type: { type: 'string', enum: ['number', 'boolean'] },
          unit: {
            ...unit,
            description:
              'Unit for numeric input values, defaults and minimums. Use scalar for booleans.',
          },
          default: {
            ...value,
            description:
              'Fallback when the assignment supplies no value. Omit to require an input.',
          },
          minimum: number,
        },
        ['name', 'type', 'unit'],
      ),
      'Named variables available to formulas and assignment overrides.',
    ),
    outputs: array(
      object(
        {
          id: string,
          name: string,
          materialId: {
            ...string,
            description:
              'Purchasing identity used to combine compatible outputs.',
          },
          unit: {
            ...unit,
            description: 'Unit for calculated and purchased amounts.',
          },
          formula: {
            ...string,
            description:
              'Base quantity per compatible geometry before waste and packages.',
          },
          allowance: {
            ...allowance,
            description: 'Default waste and packaging for this output.',
          },
          piece: object(
            {
              role: string,
              cutLength: {
                ...lengthFormula,
                description: 'Required length of one installed piece.',
              },
              stockLength: {
                ...lengthFormula,
                description:
                  'Purchased length per piece, at least the cut length.',
              },
            },
            ['role', 'cutLength'],
          ),
        },
        ['id', 'name', 'materialId', 'unit', 'formula', 'allowance'],
      ),
      'Material quantities calculated per compatible trace and aggregated for purchasing.',
    ),
  },
  ['id', 'name', 'geometryKinds', 'inputs', 'outputs'],
);
export const assemblySchema: PayloadSchema = {
  ...leafAssemblySchema,
  properties: {
    ...leafAssemblySchema.properties,
    wallTemplate: {
      ...wallTemplateSchema,
      description: 'Live construction defaults for path members of the group.',
    },
    ceilingTemplate: {
      ...ceilingTemplateSchema,
      description: 'Live ceiling defaults for area members of the group.',
    },
    materialTemplate: {
      ...materialTemplateSchema,
      description:
        'Positioned material layout. Lengths and world XY origins use feet, rotations use radians.',
    },
    components: array(
      object({
        id: string,
        assembly: leafAssemblySchema,
        bindings: {
          type: 'object',
          additionalProperties: string,
          description: 'Component input name to shared input name.',
        },
      }),
    ),
  },
};
const recipe = assemblySchema;
const inputValues: PayloadSchema = {
  type: 'object',
  description:
    'Values by recipe input name, in each declared unit (e.g. ft or in), or booleans.',
  additionalProperties: value,
};
const assignment = object(
  {
    direction: {
      type: 'string',
      enum: ['add', 'deduct'],
      description:
        'Defaults to add. Only change orders can deduct. Enter positive quantities.',
    },
    id: string,
    groupId: string,
    recipeId: {
      ...string,
      description:
        'ID of the project recipe or assembly applied to this group.',
    },
    inputs: inputValues,
    allowances: {
      type: 'object',
      additionalProperties: allowanceOverride,
      description:
        'Overrides by output ID. Omitted fields inherit the recipe allowance; packageSize null clears package rounding. Use {} for recipe defaults.',
    },
    geometryInputs: {
      type: 'object',
      additionalProperties: inputValues,
      description: 'Overrides assignment inputs for individual geometry IDs.',
    },
    wallOverrides: {
      ...wallOverrideSchema,
      description: 'Group-wide changes to the wall template.',
    },
    ceilingOverrides: {
      ...ceilingOverrideSchema,
      description: 'Group-wide changes to the ceiling template.',
    },
    materialOverrides: {
      ...materialOverrideSchema,
      description: 'Group-wide changes to the material template.',
    },
    geometryDetails: {
      type: 'object',
      description:
        'By geometry ID. Optional applied item ID and settings for that trace. Local values override group-wide settings.',
      additionalProperties: object(
        {
          id: string,
          wall: wallOverrideSchema,
          ceiling: ceilingOverrideSchema,
          material: materialOverrideSchema,
        },
        [],
      ),
    },
  },
  ['id', 'groupId', 'recipeId', 'inputs', 'allowances'],
);
const id = object({ id: string });
const commands = array(
  object(
    { name: string, payload: { type: 'object', additionalProperties: true } },
    ['name'],
  ),
);
const definitions: [string, string, PayloadSchema, boolean, unknown][] = [
  [
    'commands.list',
    'List command names, effects and mutation flags. Use help <command> for its payload.',
    object({}),
    false,
    {},
  ],
  [
    'construction.alignment.put',
    'Set a presentation-only combined 3D alignment (feet/radians).',
    object({ sheetId: string, ...alignmentFields }),
    true,
    { sheetId: 'sheet-1', offset: { x: 0, y: 0 }, rotation: 0 },
  ],
  [
    'construction.alignment.delete',
    'Clear a combined 3D alignment.',
    object({
      sheetId: {
        ...string,
        description: 'Sheet whose saved presentation transform is removed.',
      },
    }),
    true,
    { sheetId: 'sheet-1' },
  ],
  [
    'construction.alignment.match',
    'Match one or two paired page points without changing scale.',
    object({
      sheetId: string,
      referenceSheetId: string,
      sourcePoints: {
        ...array(pagePoint),
        minItems: 1,
        maxItems: 2,
        description:
          'Control points on sheetId. One preserves rotation, two solve rotation and translation.',
      },
      referencePoints: {
        ...array(pagePoint),
        minItems: 1,
        maxItems: 2,
        description: 'Matching points on referenceSheetId in the same order.',
      },
    }),
    true,
    {
      sheetId: 'sheet-1',
      referenceSheetId: 'sheet-2',
      sourcePoints: [{ x: 0, y: 0 }],
      referencePoints: [{ x: 10, y: 10 }],
    },
  ],
  [
    'project.sizes.inspect',
    'Read the standard sizes saved with this job.',
    object({}),
    false,
    {},
  ],
  [
    'project.sizes.put',
    'Replace the standard sizes saved with this job.',
    object({ sizes: standardSizesSchema }),
    true,
    { sizes: companySizes() },
  ],
  [
    'project.specialOrderStuds.put',
    'Allow or disable special-order stud lengths across this job.',
    object({ enabled: { type: 'boolean' } }),
    true,
    { enabled: true },
  ],
  [
    'annotation.list',
    'Read all permanent annotations on a sheet, including hidden annotations.',
    object({ sheetId: string }),
    false,
    { sheetId: 'sheet-1' },
  ],
  [
    'annotation.inspect',
    'Read one complete sheet annotation.',
    id,
    false,
    { id: 'annotation-id' },
  ],
  [
    'annotation.add',
    'Add a permanent sheet annotation in rotated page coordinates. Freehand creation uses the drawing tool only.',
    object(annotationFields, ['sheetId', 'kind', 'points']),
    true,
    {
      sheetId: 'sheet-1',
      kind: 'text',
      points: [{ x: 80, y: 40 }],
      text: 'Verify opening',
    },
  ],
  [
    'annotation.update',
    'Edit annotation points or text, preserving creation metadata.',
    object({ id: string, points: array(point), text: string }, ['id']),
    true,
    { id: 'annotation-id', text: 'Confirmed opening' },
  ],
  [
    'annotation.delete',
    'Remove a permanent sheet annotation through project history.',
    id,
    true,
    { id: 'annotation-id' },
  ],
  ['project.inspect', 'Read the accepted project.', object({}), false, {}],
  [
    'project.category.put',
    'Add or recolor a project-only assembly category.',
    object({ name: string, color: string }),
    true,
    { name: 'Specialty scope', color: '#8A36D1' },
  ],
  [
    'notes.read',
    'Read the project Markdown scratchpad before editing.',
    object({}),
    false,
    {},
  ],
  [
    'notes.write',
    'Replace the full scratchpad. Read first and preserve unrelated text.',
    object({ markdown: string }),
    true,
    { markdown: '# Notes\nCheck A101 detail 2.' },
  ],
  [
    'notes.search',
    'Find case-insensitive literal text in accepted notes; returns matching lines and total occurrences.',
    object({ query: string }),
    false,
    { query: 'detail' },
  ],
  [
    'project.rename',
    'Rename the project.',
    object({ name: string }),
    true,
    { name: 'Estimate' },
  ],
  [
    'sheet.put',
    'Replace the whole sheet record, including calibration. Omitted optional fields are cleared. Use sheet.naming.apply to rename.',
    sheet,
    true,
    {
      id: 'sheet-1',
      name: 'Plan',
      assetId: 'asset-1',
      pageIndex: 0,
      width: 1000,
      height: 800,
    },
  ],
  [
    'sheet.naming.apply',
    'Rename sheets atomically, preserving their other fields.',
    object({
      sheets: {
        ...array(object({ id: string, name: string })),
        minItems: 1,
        maxItems: 500,
      },
    }),
    true,
    { sheets: [{ id: 'sheet-1', name: 'A101 · FLOOR PLAN' }] },
  ],
  [
    'sheet.scale',
    'Set a PDF sheet scale from printed paper and real distances (72 page units per paper inch).',
    object({
      id: string,
      paper: { ...distance, description: 'Printed length on paper.' },
      real: { ...distance, description: 'Corresponding real-world length.' },
    }),
    true,
    {
      id: 'sheet-1',
      paper: { value: 0.25, unit: 'in' },
      real: { value: 1, unit: 'ft' },
    },
  ],
  [
    'sheet.calibrate',
    'Calibrate two page points against a physical distance.',
    object({
      id: string,
      start: pagePoint,
      end: pagePoint,
      distance: {
        ...distance,
        description: 'Known real-world length between start and end.',
      },
    }),
    true,
    {
      id: 'sheet-1',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      distance: { value: 24, unit: 'ft' },
    },
  ],
  [
    'sheet.delete',
    'Delete a sheet, its annotations, its geometry, and resulting memberships.',
    id,
    true,
    { id: 'sheet-1' },
  ],
  [
    'geometry.put',
    'Replace geometry in page coordinates. Convert image pixels with the pixelToPage transform returned by the render they came from.',
    geometry,
    true,
    {
      id: 'original-wall-id',
      name: 'Wall',
      sheetId: 'sheet-1',
      kind: 'path',
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    },
  ],
  [
    'geometry.move',
    'Translate selected objects in page units.',
    object({ ids: array(string), ...translation }),
    true,
    { ids: ['original-wall-id'], dx: 10, dy: 0 },
  ],
  [
    'geometry.copy',
    'Duplicate a trace, translating its page points, with its group memberships, assemblies and per-trace details. Its quantities are added. Returns the new geometry and affected IDs.',
    object({ id: string, newId: string, ...translation }, ['id']),
    true,
    { id: 'original-wall-id', dx: 10 },
  ],
  [
    'geometry.delete',
    'Delete geometry and its memberships.',
    id,
    true,
    { id: 'original-wall-id' },
  ],
  [
    'group.put',
    'Replace the group and its memberships. Omitted optional fields are cleared.',
    group,
    true,
    { id: 'group-1', name: 'Walls', geometryIds: ['original-wall-id'] },
  ],
  [
    'group.members',
    'Replace group memberships.',
    object({ id: string, geometryIds }),
    true,
    { id: 'group-1', geometryIds: ['original-wall-id'] },
  ],
  [
    'group.copy',
    'Duplicate memberships and assignments, retaining geometry references.',
    object({ id: string, newId: string, name: string }, ['id']),
    true,
    { id: 'group-1', name: 'Second finish' },
  ],
  [
    'group.delete',
    'Delete a group and assignments, retaining geometry.',
    id,
    true,
    { id: 'group-1' },
  ],
  [
    'recipe.put',
    'Replace the project recipe used by its assignments. Omitted optional fields are cleared.',
    recipe,
    true,
    {
      id: 'custom',
      name: 'Floor',
      geometryKinds: ['area'],
      inputs: [],
      outputs: [
        {
          id: 'area',
          name: 'Floor area',
          materialId: 'floor',
          unit: 'ft2',
          formula: 'area',
          allowance: { wastePercent: 0 },
        },
      ],
    },
  ],
  ['recipe.delete', 'Delete an unused recipe.', id, true, { id: 'custom' }],
  [
    'assignment.put',
    'Replace a group assignment. Omitted optional fields, including per-geometry overrides, are cleared. Allowance overrides inherit omitted fields from the recipe.',
    assignment,
    true,
    {
      id: 'assignment-1',
      groupId: 'group-1',
      recipeId: 'wall-area',
      inputs: { height: 8, layers: 2 },
      allowances: {},
    },
  ],
  [
    'assignment.delete',
    'Delete an assignment.',
    id,
    true,
    { id: 'assignment-1' },
  ],
  [
    'quantities.inspect',
    'Read this takeoff’s source quantities, diagnostics, allowances, purchases and material totals in their reported units, plus sourceCoverage: drawing objects that reach no quantity and assignments to empty groups.',
    object({}),
    false,
    {},
  ],
  [
    'quantities.export',
    'Return this takeoff’s quantity report as text.',
    object({
      format: {
        type: 'string',
        enum: ['csv', 'json'],
        description: 'CSV output rows or the full JSON quantity report.',
      },
    }),
    false,
    { format: 'csv' },
  ],
  [
    'pieces.inspect',
    'Read required pieces by drawing location, excluding purchasing waste.',
    object({}),
    false,
    {},
  ],
  [
    'pieces.export',
    'Export required pieces and cut/stock lengths by location as CSV or JSON.',
    object({ format: { type: 'string', enum: ['csv', 'json'] } }),
    false,
    { format: 'csv' },
  ],
  [
    'history.undo',
    'Undo the latest project-wide edit, including desktop edits. Ignores takeoffId and saves a new revision.',
    object({}),
    true,
    {},
  ],
  [
    'history.redo',
    'Redo the last project-wide undo, including desktop edits. Ignores takeoffId and saves a new revision.',
    object({}),
    true,
    {},
  ],
  [
    'batch',
    'Apply commands atomically as one saved revision and undo step.',
    object({ commands }),
    true,
    { commands: [{ name: 'project.rename', payload: { name: 'Estimate' } }] },
  ],
  [
    'preview',
    'Evaluate commands without saving or publishing.',
    object({ commands, includeProject: { type: 'boolean' } }, ['commands']),
    false,
    { commands: [{ name: 'quantities.inspect' }] },
  ],
];
// Existing recipe commands remain compatible with saved scripts.
for (const [name, original] of [
  ['assembly.put', 'recipe.put'],
  ['assembly.delete', 'recipe.delete'],
] as const) {
  const entry = definitions.find(([command]) => command === original);
  if (entry)
    definitions.push([
      name,
      entry[1].replaceAll('recipe', 'assembly'),
      entry[2],
      entry[3],
      entry[4],
    ]);
}
export const commandRegistry: readonly CommandDefinition[] = [
  ...definitions.map(([name, description, schema, mutates, payload]) => ({
    name,
    description,
    schema,
    mutates,
    examples: [{ name, payload }],
  })),
  ...detailedCommands,
  ...takeoffCommands,
];
export function commandIndex(definitions: readonly CommandDefinition[]) {
  return definitions
    .map(({ name, description, mutates }) => ({
      name,
      description: description.split(/(?<=\.)\s+/, 1)[0] ?? description,
      mutates,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function record(item: unknown): item is Record<string, unknown> {
  return typeof item === 'object' && item !== null && !Array.isArray(item);
}
export function validatePayload(
  schema: PayloadSchema,
  item: unknown,
  path = 'payload',
): void {
  if (schema.nullable && item === null) return;
  if (schema.anyOf) {
    for (const candidate of schema.anyOf) {
      try {
        validatePayload(candidate, item, path);
        return;
      } catch {
        /* Try the next declared type. */
      }
    }
    throw new Error(`${path} must match a declared type`);
  }
  if (schema.type === 'array') {
    if (!Array.isArray(item)) throw new Error(`${path} must be an array`);
    if (
      (schema.minItems !== undefined && item.length < schema.minItems) ||
      (schema.maxItems !== undefined && item.length > schema.maxItems)
    )
      throw new Error(`${path} has an invalid number of items`);
    const child = schema.items;
    if (child)
      item.forEach((entry: unknown, index) => {
        const label =
          schema === commands && record(entry) && typeof entry.name === 'string'
            ? ` (${entry.name})`
            : '';
        validatePayload(child, entry, `${path}[${String(index)}]${label}`);
      });
    return;
  }
  if (schema.type === 'object') {
    if (!record(item)) throw new Error(`${path} must be an object`);
    for (const key of schema.required ?? [])
      if (!Object.hasOwn(item, key))
        throw new Error(`${path}.${key} is required`);
    for (const [key, entry] of Object.entries(item)) {
      const child = schema.properties?.[key];
      if (child) validatePayload(child, entry, `${path}.${key}`);
      else if (schema.additionalProperties === false)
        throw new Error(`Unknown field ${path}.${key}`);
      else if (typeof schema.additionalProperties === 'object')
        validatePayload(schema.additionalProperties, entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof item !== schema.type)
    throw new Error(`${path} must be ${String(schema.type)}`);
  if (
    typeof item === 'number' &&
    (!Number.isFinite(item) ||
      (schema.minimum !== undefined && item < schema.minimum))
  )
    throw new Error(`${path} is outside its valid range`);
  if (schema.enum && !schema.enum.some((option) => option === item))
    throw new Error(`${path} must be one of ${schema.enum.join(', ')}`);
}
export function validateCommand(call: CommandCall): CommandDefinition {
  const definition = commandRegistry.find((entry) => entry.name === call.name);
  if (!definition)
    throw new Error(`Unknown command: ${call.name}. Use commands.list.`);
  validatePayload(definition.schema, call.payload ?? {});
  return definition;
}
function requireEntity<T>(
  entities: Record<string, T>,
  entityId: string,
  kind: string,
): T {
  const entity = Object.hasOwn(entities, entityId)
    ? entities[entityId]
    : undefined;
  if (!entity) throw new Error(`${kind} not found: ${entityId}`);
  return entity;
}
function removeGeometry(project: Project, geometryId: string): void {
  Reflect.deleteProperty(project.geometries, geometryId);
  for (const entry of Object.values(project.groups))
    entry.geometryIds = entry.geometryIds.filter(
      (member) => member !== geometryId,
    );
}
export function validateAssembly(input: unknown): asserts input is Recipe {
  validatePayload(assemblySchema, input);
  const entry = input as Recipe;
  if (
    !entry.id ||
    ['__proto__', 'constructor', 'prototype'].includes(entry.id) ||
    !entry.name.trim()
  )
    throw new Error('Assembly needs an id and name');
  if (
    !entry.geometryKinds.length ||
    new Set(entry.geometryKinds).size !== entry.geometryKinds.length
  )
    throw new Error('Assembly needs unique compatible geometry kinds');
  if (entry.wallTemplate || entry.ceilingTemplate || entry.materialTemplate) {
    if (
      entry.components ||
      (!entry.ceilingTemplate &&
        (entry.inputs.length || entry.outputs.length)) ||
      entry.geometryKinds.length !== 1 ||
      entry.geometryKinds[0] !==
        (entry.wallTemplate
          ? 'path'
          : entry.ceilingTemplate
            ? 'area'
            : entry.materialTemplate &&
              materialGeometryKind(entry.materialTemplate)) ||
      [
        entry.wallTemplate,
        entry.ceilingTemplate,
        entry.materialTemplate,
      ].filter(Boolean).length !== 1
    )
      throw new Error(
        'Modeled assemblies need one material definition, matching geometry and no system components. Only ceilings support additional formula estimates.',
      );
    if (entry.wallTemplate) validateWallTemplate(entry.wallTemplate);
    if (entry.ceilingTemplate) validateCeilingTemplate(entry.ceilingTemplate);
    if (entry.materialTemplate)
      validateMaterialTemplate(entry.materialTemplate);
    if (!entry.inputs.length && !entry.outputs.length) return;
  }
  const names = new Set<string>();
  for (const field of entry.inputs) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name) ||
      names.has(field.name) ||
      ['length', 'area', 'perimeter', 'count', 'true', 'false'].includes(
        field.name,
      )
    )
      throw new Error(
        'Recipe input names must be unique identifiers distinct from metrics',
      );
    names.add(field.name);
    if (
      (field.default !== undefined && typeof field.default !== field.type) ||
      (typeof field.default === 'number' && !Number.isFinite(field.default)) ||
      (field.type === 'boolean' &&
        (field.unit !== 'scalar' || field.minimum !== undefined)) ||
      (typeof field.default === 'number' &&
        field.minimum !== undefined &&
        field.default < field.minimum)
    )
      throw new Error(`Invalid default for ${field.name}`);
  }
  if (
    (!entry.components && entry.outputs.length === 0) ||
    new Set(entry.outputs.map((output) => output.id)).size !==
      entry.outputs.length
  )
    throw new Error('Recipe needs outputs with unique ids');
  validateSystem(entry);
  for (const component of entry.components ?? [])
    validateAssembly(component.assembly);
  for (const output of entry.outputs) {
    if (!output.id || !output.name.trim() || !output.materialId.trim())
      throw new Error('Output needs an id, name and material');
    if (
      output.piece &&
      output.allowance.packageSize !== undefined &&
      !Number.isInteger(output.allowance.packageSize)
    )
      throw new Error('Piece package size must be a whole number');
    if (output.piece && output.unit !== 'ea')
      throw new Error('Piece outputs must use ea');
  }
}
export function validateAssemblyInputs(
  definition: Recipe,
  inputs: Record<string, number | boolean>,
): void {
  for (const [name, item] of Object.entries(inputs)) {
    const field = definition.inputs.find(
      (candidate) => candidate.name === name,
    );
    if (
      !field ||
      typeof item !== field.type ||
      (typeof item === 'number' &&
        (!Number.isFinite(item) ||
          (field.minimum !== undefined && item < field.minimum)))
    )
      throw new Error(`Invalid assignment input: ${name}`);
  }
}

export function validateProject(
  input: unknown,
  view = false,
): asserts input is Project {
  if (
    input &&
    typeof input === 'object' &&
    'formatVersion' in input &&
    input.formatVersion !== 10
  )
    throw new Error(
      'Unsupported project format. Create a new takeoff with this version of Bluewing.',
    );
  validatePayload(
    object(
      {
        formatVersion: { type: 'number', enum: [10] },
        standardSizes: standardSizesSchema,
        allowSpecialOrderStuds: { type: 'boolean' },
        takeoffs: {
          type: 'object',
          additionalProperties: object(
            {
              id: string,
              name: string,
              kind: { type: 'string', enum: ['main', 'phase', 'change-order'] },
              mainTakeoffId: string,
              owned: {
                type: 'object',
                properties: Object.fromEntries(
                  ownedCollections.map((key) => [key, array(string)]),
                ),
                additionalProperties: false,
              },
              construction: constructionSchema,
              review: reviewSchema,
              copies: array(
                object({
                  sourceTakeoffId: string,
                  sourceRevision: number,
                  ids: { type: 'object', additionalProperties: string },
                }),
              ),
            },
            ['id', 'name', 'kind', 'owned'],
          ),
        },
        takeoffId: string,
        id: string,
        name: string,
        revision: { type: 'number', minimum: 0 },
        sheets: { type: 'object', additionalProperties: sheet },
        annotations: { type: 'object', additionalProperties: annotation },
        geometries: { type: 'object', additionalProperties: geometry },
        groups: { type: 'object', additionalProperties: group },
        recipes: { type: 'object', additionalProperties: recipe },
        assignments: { type: 'object', additionalProperties: assignment },
        construction: constructionSchema,
        review: reviewSchema,
        categoryColors: { type: 'object', additionalProperties: string },
        notes: string,
      },
      [
        'formatVersion',
        'standardSizes',
        'allowSpecialOrderStuds',
        'takeoffs',
        'id',
        'name',
        'revision',
        'sheets',
        'annotations',
        'geometries',
        'groups',
        'recipes',
        'assignments',
      ],
    ),
    input,
    'project',
  );
  const project = input as Project;
  checkSizes(project.standardSizes);
  if (project.takeoffId && !view)
    throw new Error('Derived takeoff views cannot be persisted');
  if (
    Object.values(project.takeoffs).filter((t) => t.kind === 'main').length !==
    1
  )
    throw new Error('Exactly one Main takeoff is required');
  if (!project.takeoffId) {
    for (const takeoff of Object.values(project.takeoffs)) {
      if (
        takeoff.id !==
          Object.keys(project.takeoffs).find(
            (key) => project.takeoffs[key] === takeoff,
          ) ||
        !takeoff.name.trim() ||
        !['main', 'phase', 'change-order'].includes(takeoff.kind)
      )
        throw new Error('Invalid takeoff');
      if (
        takeoff.kind === 'change-order' &&
        takeoff.mainTakeoffId !== mainId(project)
      )
        throw new Error('Change order must reference Main');
      const view = takeoffProject(project, takeoff.id);
      validateProject(view, true);
    }
    for (const collection of ownedCollections) {
      const ids = Object.values(project.takeoffs).flatMap(
        (t) => t.owned[collection] ?? [],
      );
      if (
        new Set(ids).size !== ids.length ||
        ids.some((id) => !project[collection][id])
      )
        throw new Error('Invalid takeoff ownership');
    }
    return;
  }
  for (const [name, color] of Object.entries(project.categoryColors ?? {}))
    validateCategoryColor(name, color);
  validateDetailed(project);
  if (!Number.isInteger(project.revision) || project.revision < 0)
    throw new Error('Unsupported project format or revision');
  for (const [key, entries, schema] of [
    ['sheets', project.sheets, sheet],
    ['annotations', project.annotations, annotation],
    ['geometries', project.geometries, geometry],
    ['groups', project.groups, group],
    ['recipes', project.recipes, recipe],
    ['assignments', project.assignments, assignment],
  ] as const) {
    for (const [entityId, entity] of Object.entries(
      entries as Record<string, { id: string }>,
    )) {
      validatePayload(schema, entity, key);
      if (
        entity.id !== entityId ||
        !entityId ||
        ['__proto__', 'constructor', 'prototype'].includes(entityId)
      )
        throw new Error(`Invalid ${key} record id`);
    }
  }
  for (const entry of Object.values(project.annotations)) {
    requireEntity(project.sheets, entry.sheetId, 'Sheet');
    validateAnnotation(entry);
  }
  for (const entry of Object.values(project.sheets)) {
    if (!Number.isInteger(entry.pageIndex))
      throw new Error('PDF pageIndex must be an integer');
  }
  for (const entry of Object.values(project.geometries)) {
    requireEntity(project.sheets, entry.sheetId, 'Sheet');
    validateGeometry(entry);
  }
  for (const entry of Object.values(project.groups)) {
    checkAnnotationColor(entry.color);
    if (new Set(entry.geometryIds).size !== entry.geometryIds.length)
      throw new Error('Group membership must be unique');
    entry.geometryIds.forEach((member) =>
      requireEntity(project.geometries, member, 'Geometry'),
    );
  }
  for (const entry of Object.values(project.recipes)) validateAssembly(entry);
  for (const entry of Object.values(project.assignments)) {
    requireEntity(project.groups, entry.groupId, 'Group');
    if (
      entry.direction === 'deduct' &&
      project.takeoffs[project.takeoffId ?? mainId(project)]?.kind !==
        'change-order'
    )
      throw new Error('Only change orders can deduct');
    const definition = requireEntity(project.recipes, entry.recipeId, 'Recipe');
    for (const geometryId of Object.keys(entry.geometryDetails ?? {}))
      if (!project.groups[entry.groupId]?.geometryIds.includes(geometryId))
        throw new Error('Material overrides must belong to the assigned group');
    if (
      (entry.wallOverrides ||
        Object.values(entry.geometryDetails ?? {}).some(
          (detail) => detail.wall,
        )) &&
      !definition.wallTemplate
    )
      throw new Error('Wall overrides require a wall assembly');
    // An empty group or a per-trace replacement can hide authored finish ranges.
    entry.wallOverrides?.finishes?.forEach(validateFinishHeights);
    for (const detail of Object.values(entry.geometryDetails ?? {}))
      detail.wall?.finishes?.forEach(validateFinishHeights);
    if (
      (entry.ceilingOverrides ||
        Object.values(entry.geometryDetails ?? {}).some(
          (detail) => detail.ceiling,
        )) &&
      !definition.ceilingTemplate
    )
      throw new Error('Ceiling overrides require a ceiling assembly');
    if (
      (entry.materialOverrides ||
        Object.values(entry.geometryDetails ?? {}).some(
          (detail) => detail.material,
        )) &&
      !definition.materialTemplate
    )
      throw new Error('Material overrides require a material layout assembly');
    if (definition.materialTemplate) {
      const schema = materialFieldsSchema(
        definition.materialTemplate.kind,
        true,
      );
      validatePayload(schema, entry.materialOverrides ?? {});
      const groupSettings = mergeMaterialSettings(
        definition.materialTemplate,
        entry.materialOverrides,
      );
      for (const override of [
        undefined,
        ...Object.values(entry.geometryDetails ?? {}).map(
          (detail) => detail.material,
        ),
      ]) {
        validatePayload(schema, override ?? {});
        const settings = mergeMaterialSettings(
          groupSettings,
          override,
        ) as typeof groupSettings & { levelId?: string };
        const { levelId, ...template } = settings;
        validateMaterialTemplate(template);
        if (levelId !== undefined && !project.construction?.levels[levelId])
          throw new Error(`Material layout level ${levelId} is missing`);
      }
    }
    validateAssemblyInputs(definition, entry.inputs);
    for (const [geometryId, inputs] of Object.entries(
      entry.geometryInputs ?? {},
    )) {
      if (!project.groups[entry.groupId]?.geometryIds.includes(geometryId))
        throw new Error('Object inputs must belong to the assigned group');
      validateAssemblyInputs(definition, inputs);
    }
    for (const [outputId, allowance] of Object.entries(entry.allowances)) {
      const output = assemblyOutputs(definition).find(
        ({ output }) => output.id === outputId,
      )?.output;
      if (!output) throw new Error(`Unknown allowance output: ${outputId}`);
      if (
        output.piece &&
        allowance.packageSize != null &&
        !Number.isInteger(allowance.packageSize)
      )
        throw new Error('Piece package size must be a whole number');
    }
  }
}
export function executeCommand(
  project: Project,
  call: CommandCall,
  validateResult = true,
): { project: Project; data: unknown; changed: boolean } {
  return executeCommandOnDraft(structuredClone(project), call, validateResult);
}

/** Internal session path: mutations require an owned draft; returned data is isolated. */
export function executeCommandOnDraft(
  next: Project,
  call: CommandCall,
  validateResult = true,
  calculation: () => CalculationSnapshot = () =>
    calculateProject(takeoffProject(next, call.takeoffId)),
  origin = 'ui',
): { project: Project; data: unknown; changed: boolean } {
  const definition = validateCommand(call);
  if (!next.takeoffId) {
    if (call.name.startsWith('takeoff.') && call.name !== 'takeoff.inspect') {
      const data = manageTakeoff(next, call);
      if (definition.mutates && validateResult) validateProject(next);
      return {
        project: next,
        data: structuredClone(data),
        changed: definition.mutates,
      };
    }
    if (
      !call.name.startsWith('annotation.') &&
      ![
        'commands.list',
        'project.rename',
        'project.inspect',
        'project.category.put',
        'project.sizes.inspect',
        'project.specialOrderStuds.put',
        'project.sizes.put',
        'notes.read',
        'notes.write',
        'notes.search',
        'sheet.put',
        'sheet.delete',
        'sheet.naming.apply',
      ].includes(call.name)
    ) {
      const view = takeoffProject(next, call.takeoffId ?? mainId(next));
      if (!definition.mutates) {
        const result = executeCommandOnDraft(
          view,
          call,
          validateResult,
          calculation,
        );
        return { ...result, project: next };
      }
      const before = structuredClone(view);
      const result = executeCommandOnDraft(
        view,
        call,
        validateResult,
        calculation,
      );
      if (result.changed) {
        mergeTakeoff(next, view, before);
        if (validateResult) validateProject(next, next.takeoffId !== undefined);
      }
      return { ...result, project: next };
    }
  }
  if (['batch', 'preview', 'history.undo', 'history.redo'].includes(call.name))
    throw new Error(`${call.name} must run through ProjectSession`);
  const payload = (call.payload ?? {}) as Record<string, unknown>;
  const entityId = payload.id as string;
  if (entityId && ['__proto__', 'constructor', 'prototype'].includes(entityId))
    throw new Error('Invalid entity id');
  let data: unknown = null;
  switch (call.name) {
    case 'commands.list':
      data = commandIndex(commandRegistry);
      break;
    case 'annotation.list':
      requireEntity(next.sheets, payload.sheetId as string, 'Sheet');
      data = Object.values(next.annotations).filter(
        (a) => a.sheetId === payload.sheetId,
      );
      break;
    case 'annotation.inspect':
      data = requireEntity(next.annotations, entityId, 'Annotation');
      break;
    case 'annotation.add': {
      const fields = payload as unknown as Pick<
        SheetAnnotation,
        'sheetId' | 'kind' | 'points' | 'text'
      >;
      requireEntity(next.sheets, fields.sheetId, 'Sheet');
      if (origin === 'cli' && fields.kind === 'freehand')
        throw new Error('Freehand annotations must be drawn in the UI');
      const entry: SheetAnnotation = {
        ...structuredClone(fields),
        id: newId(),
        author: origin === 'cli' ? 'agent' : 'user',
        createdAt: new Date().toISOString(),
      };
      validateAnnotation(entry);
      next.annotations[entry.id] = entry;
      data = entry;
      break;
    }
    case 'annotation.update': {
      const entry = requireEntity(next.annotations, entityId, 'Annotation');
      if (payload.points === undefined && payload.text === undefined)
        throw new Error('Supply annotation points or text');
      if (payload.points !== undefined)
        entry.points = structuredClone(
          payload.points,
        ) as SheetAnnotation['points'];
      if (payload.text !== undefined) entry.text = payload.text as string;
      validateAnnotation(entry);
      data = entry;
      break;
    }
    case 'annotation.delete':
      requireEntity(next.annotations, entityId, 'Annotation');
      Reflect.deleteProperty(next.annotations, entityId);
      break;
    case 'notes.read':
      data = { markdown: next.notes ?? '' };
      break;
    case 'notes.search':
      data = searchNotes(next.notes ?? '', payload.query as string);
      break;
    case 'notes.write':
      if (payload.markdown === '') delete next.notes;
      else next.notes = payload.markdown as string;
      break;
    case 'project.inspect':
      data = next;
      break;
    case 'takeoff.inspect':
      data = {
        projectId: next.id,
        revision: next.revision,
        takeoff: next.takeoffs[next.takeoffId ?? mainId(next)],
        sheets: next.sheets,
        geometries: next.geometries,
        groups: next.groups,
        recipes: next.recipes,
        assignments: next.assignments,
        construction: next.construction,
        review: next.review,
      };
      break;
    case 'project.specialOrderStuds.put':
      next.allowSpecialOrderStuds = payload.enabled as boolean;
      data = next.allowSpecialOrderStuds;
      break;
    case 'project.sizes.inspect':
      data = next.standardSizes;
      break;
    case 'project.sizes.put':
      next.standardSizes = structuredClone(payload.sizes as StandardSizes);
      checkSizes(next.standardSizes);
      data = next.standardSizes;
      break;
    case 'project.category.put': {
      const name = (payload.name as string).trim();
      const color = payload.color as string;
      validateCategoryColor(name, color);
      const existing = Object.keys(next.categoryColors ?? {}).find(
        (key) => key.toLowerCase() === name.toLowerCase(),
      );
      next.categoryColors = {
        ...next.categoryColors,
        [existing ?? name]: color,
      };
      data = next.categoryColors;
      break;
    }
    case 'pieces.inspect':
      data = pieceSchedule(next, calculation());
      break;
    case 'pieces.export':
      data = exportPieces(
        next,
        payload.format as 'csv' | 'json',
        calculation(),
      );
      break;
    case 'quantities.inspect':
      data = inspectQuantities(calculation(), next);
      break;
    case 'quantities.export':
      data = exportQuantities(
        next,
        payload.format as 'csv' | 'json',
        calculation(),
      );
      break;
    case 'project.rename':
      next.name = payload.name as string;
      break;
    case 'sheet.put':
      next.sheets[entityId] = structuredClone(payload) as unknown as Sheet;
      break;
    case 'construction.alignment.put': {
      const sheet = requireEntity(
        next.sheets,
        payload.sheetId as string,
        'Sheet',
      );
      const alignment = structuredClone({
        offset: payload.offset,
        rotation: payload.rotation,
      }) as Combined3dAlignment;
      sheet.combined3dAlignment = alignment;
      data = { alignment };
      break;
    }
    case 'construction.alignment.delete':
      delete requireEntity(next.sheets, payload.sheetId as string, 'Sheet')
        .combined3dAlignment;
      break;
    case 'construction.alignment.match': {
      const match = matchSheetAlignment(
        next,
        payload as unknown as MatchSheetAlignmentPayload,
      );
      requireEntity(
        next.sheets,
        payload.sheetId as string,
        'Sheet',
      ).combined3dAlignment = match.alignment;
      data = match;
      break;
    }
    case 'sheet.naming.apply': {
      const entries = payload.sheets as { id: string; name: string }[];
      const seen = new Set<string>();
      for (const entry of entries) {
        if (seen.has(entry.id)) throw new Error(`Duplicate sheet: ${entry.id}`);
        seen.add(entry.id);
        requireEntity(next.sheets, entry.id, 'Sheet');
        if (!entry.name.trim()) throw new Error('Sheet name cannot be empty');
      }
      for (const entry of entries)
        requireEntity(next.sheets, entry.id, 'Sheet').name = entry.name.trim();
      break;
    }
    case 'sheet.scale':
      requireEntity(next.sheets, entityId, 'Sheet').calibration =
        calibrationFromRatio(payload as unknown as PaperScale);
      break;
    case 'sheet.calibrate':
      requireEntity(next.sheets, entityId, 'Sheet').calibration =
        calibrationFromDistance(
          payload.start as { x: number; y: number },
          payload.end as { x: number; y: number },
          payload.distance as ScaleDistance,
        );
      break;
    case 'sheet.delete':
      requireEntity(next.sheets, entityId, 'Sheet');
      if (
        Object.values(next.geometries).some(
          (g) =>
            g.sheetId === entityId &&
            Object.values(next.takeoffs).some(
              (t) => t.kind !== 'main' && t.owned.geometries?.includes(g.id),
            ),
        )
      )
        throw new Error('Remove takeoff work before deleting a shared sheet');
      for (const entry of Object.values(next.geometries))
        if (entry.sheetId === entityId) removeGeometry(next, entry.id);
      for (const entry of Object.values(next.annotations))
        if (entry.sheetId === entityId)
          Reflect.deleteProperty(next.annotations, entry.id);
      Reflect.deleteProperty(next.sheets, entityId);
      break;
    case 'geometry.put':
      next.geometries[entityId] = structuredClone(
        payload,
      ) as unknown as Geometry;
      break;
    case 'geometry.move':
      for (const member of new Set(payload.ids as string[]))
        requireEntity(next.geometries, member, 'Geometry').points.forEach(
          (p) => {
            p.x += payload.dx as number;
            p.y += payload.dy as number;
          },
        );
      break;
    case 'geometry.copy': {
      const source = structuredClone(
        requireEntity(next.geometries, entityId, 'Geometry'),
      );
      source.id = (payload.newId as string | undefined) ?? newId();
      if (next.geometries[source.id]) throw new Error('Copy id already exists');
      source.points.forEach((p) => {
        p.x += (payload.dx as number | undefined) ?? 0;
        p.y += (payload.dy as number | undefined) ?? 0;
      });
      next.geometries[source.id] = source;
      data = {
        geometry: source,
        ...copyDetailedGeometry(next, entityId, source.id),
      };
      break;
    }
    case 'geometry.delete':
      requireEntity(next.geometries, entityId, 'Geometry');
      removeGeometry(next, entityId);
      break;
    case 'group.put':
      next.groups[entityId] = structuredClone(payload) as unknown as Group;
      break;
    case 'group.members':
      requireEntity(next.groups, entityId, 'Group').geometryIds = [
        ...(payload.geometryIds as string[]),
      ];
      break;
    case 'group.copy': {
      const source = structuredClone(
        requireEntity(next.groups, entityId, 'Group'),
      );
      source.id = (payload.newId as string | undefined) ?? newId();
      source.name =
        (payload.name as string | undefined) ?? `${source.name} copy`;
      if (next.groups[source.id]) throw new Error('Copy id already exists');
      next.groups[source.id] = source;
      for (const entry of Object.values(next.assignments))
        if (entry.groupId === entityId) {
          const copy = {
            ...structuredClone(entry),
            id: newId(),
            groupId: source.id,
          };
          copyApplicationDetails(next, entry, copy);
          next.assignments[copy.id] = copy;
        }
      data = source;
      break;
    }
    case 'group.delete':
      requireEntity(next.groups, entityId, 'Group');
      Reflect.deleteProperty(next.groups, entityId);
      for (const entry of Object.values(next.assignments))
        if (entry.groupId === entityId)
          Reflect.deleteProperty(next.assignments, entry.id);
      break;
    case 'assembly.put':
    case 'recipe.put':
      next.recipes[entityId] = structuredClone(payload) as unknown as Recipe;
      break;
    case 'assembly.delete':
    case 'recipe.delete':
      requireEntity(next.recipes, entityId, 'Recipe');
      if (
        Object.values(next.assignments).some(
          (entry) => entry.recipeId === entityId,
        )
      )
        throw new Error(
          'Remove recipe assignments before deleting this recipe',
        );
      Reflect.deleteProperty(next.recipes, entityId);
      break;
    case 'assignment.put':
      if (
        payload.direction === 'deduct' &&
        next.takeoffs[next.takeoffId ?? mainId(next)]?.kind !== 'change-order'
      )
        throw new Error('Only change orders can deduct');
      next.assignments[entityId] = structuredClone(
        payload,
      ) as unknown as Assignment;
      break;
    case 'assignment.delete':
      requireEntity(next.assignments, entityId, 'Assignment');
      Reflect.deleteProperty(next.assignments, entityId);
      break;
    default:
      data = executeDetailed(next, call, calculation);
  }
  if (definition.mutates) {
    if (
      (call.name.endsWith('.delete') && call.name !== 'annotation.delete') ||
      [
        'group.members',
        'group.put',
        'assignment.put',
        'assembly.put',
        'recipe.put',
      ].includes(call.name)
    )
      pruneDetailed(next);
    if (
      [
        'geometry.delete',
        'sheet.delete',
        'group.members',
        'group.put',
      ].includes(call.name)
    )
      pruneObjectInputs(next);
  }
  if (definition.mutates && !next.takeoffId)
    for (const takeoff of Object.values(next.takeoffs))
      for (const collection of ownedCollections)
        if (takeoff.owned[collection])
          takeoff.owned[collection] = takeoff.owned[collection].filter(
            (id) => next[collection][id],
          );
  if (definition.mutates && validateResult)
    validateProject(next, next.takeoffId !== undefined);
  // Capture results now, before another batch command edits the same draft.
  return {
    project: next,
    data: structuredClone(data),
    changed: definition.mutates,
  };
}

function pruneObjectInputs(project: Project): void {
  for (const assignment of Object.values(project.assignments)) {
    const members = project.groups[assignment.groupId]?.geometryIds ?? [];
    assignment.geometryDetails = Object.fromEntries(
      Object.entries(assignment.geometryDetails ?? {}).filter(([id]) =>
        members.includes(id),
      ),
    );
    assignment.geometryInputs = Object.fromEntries(
      Object.entries(assignment.geometryInputs ?? {}).filter(([id]) =>
        members.includes(id),
      ),
    );
  }
}
