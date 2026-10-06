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
import { calibrationFromDistance, newId, validateGeometry } from './geometry';
import {
  calculateProject,
  quantityReport,
  exportQuantities,
  pieceSchedule,
  exportPieces,
} from './calculations';
import { calibrationFromRatio, type PaperScale } from './scale';
import { assemblyOutputs, validateSystem } from './systems';
import { validateWallTemplate, validateCeilingTemplate } from './wall-template';
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
const array = (items: PayloadSchema): PayloadSchema => ({
  type: 'array',
  items,
});
const positive: PayloadSchema = { type: 'number', minimum: Number.MIN_VALUE };
const point = object({ x: number, y: number });
const unit: PayloadSchema = {
  type: 'string',
  enum: ['m', 'mm', 'ft', 'in', 'm2', 'ft2', 'ea', 'scalar'],
};
const allowance = object(
  { wastePercent: { type: 'number', minimum: 0 }, packageSize: positive },
  ['wastePercent'],
);
const sheet = object(
  {
    id: string,
    name: string,
    assetId: string,
    pageIndex: { type: 'number', minimum: 0 },
    order: number,
    width: positive,
    height: positive,
    rotation: number,
    pdfToPage: { type: 'array', items: number, minItems: 6, maxItems: 6 },
    calibration: object({ metresPerUnit: positive }),
  },
  ['id', 'name', 'assetId', 'pageIndex', 'width', 'height'],
);
const geometry = object({
  id: string,
  name: string,
  sheetId: string,
  kind: { type: 'string', enum: ['path', 'area', 'count'] },
  points: array(point),
});
const group = object(
  { id: string, name: string, geometryIds: array(string), color: string },
  ['id', 'name', 'geometryIds'],
);
const lengthFormula = object({
  formula: string,
  unit: { type: 'string', enum: ['m', 'mm', 'ft', 'in'] },
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
          unit,
          default: value,
          minimum: number,
        },
        ['name', 'type', 'unit'],
      ),
    ),
    outputs: array(
      object(
        {
          id: string,
          name: string,
          materialId: string,
          unit,
          formula: string,
          allowance,
          piece: object(
            {
              role: string,
              cutLength: lengthFormula,
              stockLength: lengthFormula,
            },
            ['role', 'cutLength'],
          ),
        },
        ['id', 'name', 'materialId', 'unit', 'formula', 'allowance'],
      ),
    ),
  },
  ['id', 'name', 'geometryKinds', 'inputs', 'outputs'],
);
export const assemblySchema: PayloadSchema = {
  ...leafAssemblySchema,
  properties: {
    ...leafAssemblySchema.properties,
    wallTemplate: wallTemplateSchema,
    ceilingTemplate: ceilingTemplateSchema,
    materialTemplate: materialTemplateSchema,
    components: array(
      object({
        id: string,
        assembly: leafAssemblySchema,
        bindings: { type: 'object', additionalProperties: string },
      }),
    ),
  },
};
const recipe = assemblySchema;
const inputValues: PayloadSchema = {
  type: 'object',
  additionalProperties: value,
};
const assignment = object(
  {
    id: string,
    groupId: string,
    recipeId: string,
    inputs: inputValues,
    allowances: { type: 'object', additionalProperties: allowance },
    geometryInputs: { type: 'object', additionalProperties: inputValues },
    wallOverrides: wallOverrideSchema,
    ceilingOverrides: ceilingOverrideSchema,
    materialOverrides: materialOverrideSchema,
    geometryDetails: {
      type: 'object',
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
const commands = object({
  commands: array(
    object(
      { name: string, payload: { type: 'object', additionalProperties: true } },
      ['name'],
    ),
  ),
});
const definitions: [string, string, PayloadSchema, boolean, unknown][] = [
  [
    'commands.list',
    'List commands, payload schemas, and examples.',
    object({}),
    false,
    {},
  ],
  ['project.inspect', 'Read the accepted project.', object({}), false, {}],
  [
    'project.rename',
    'Rename the project.',
    object({ name: string }),
    true,
    { name: 'Estimate' },
  ],
  [
    'sheet.put',
    'Add or replace a sheet; assetId references separately stored PDF bytes and pageIndex is zero based.',
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
    'sheet.scale',
    'Set a PDF sheet scale from printed paper and real distances (72 page units per paper inch).',
    object({
      id: string,
      paper: object({
        value: positive,
        unit: { type: 'string', enum: ['m', 'mm', 'ft', 'in'] },
      }),
      real: object({
        value: positive,
        unit: { type: 'string', enum: ['m', 'mm', 'ft', 'in'] },
      }),
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
      start: point,
      end: point,
      distance: object({
        value: positive,
        unit: { type: 'string', enum: ['m', 'mm', 'ft', 'in'] },
      }),
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
    'Delete a sheet, its geometry, and resulting memberships.',
    id,
    true,
    { id: 'sheet-1' },
  ],
  [
    'geometry.put',
    'Add or replace complete geometry. Supply a stable UUID id.',
    geometry,
    true,
    {
      id: 'geometry-1',
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
    object({ ids: array(string), dx: number, dy: number }),
    true,
    { ids: ['geometry-1'], dx: 10, dy: 0 },
  ],
  [
    'geometry.copy',
    'Copy geometry to a new id without copying memberships.',
    object({ id: string, newId: string, dx: number, dy: number }, ['id']),
    true,
    { id: 'geometry-1', dx: 10 },
  ],
  [
    'geometry.delete',
    'Delete geometry and its memberships.',
    id,
    true,
    { id: 'geometry-1' },
  ],
  [
    'group.put',
    'Add or replace a flat reusable group and unique memberships.',
    group,
    true,
    { id: 'group-1', name: 'Walls', geometryIds: ['geometry-1'] },
  ],
  [
    'group.members',
    'Replace group memberships.',
    object({ id: string, geometryIds: array(string) }),
    true,
    { id: 'group-1', geometryIds: ['geometry-1'] },
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
    'Add or replace an editable project recipe; assignments use the new definition.',
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
    'Add or replace an assignment using declared input units and output allowance overrides.',
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
    'Calculate quantities with geometry sources and incomplete totals.',
    object({}),
    false,
    {},
  ],
  [
    'quantities.export',
    'Export derived quantities as CSV or JSON.',
    object({ format: { type: 'string', enum: ['csv', 'json'] } }),
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
    'Undo a session edit and save a new revision.',
    object({}),
    true,
    {},
  ],
  [
    'history.redo',
    'Redo an edit and save a new revision.',
    object({}),
    true,
    {},
  ],
  [
    'batch',
    'Apply commands atomically as one saved revision and undo step.',
    commands,
    true,
    { commands: [{ name: 'project.rename', payload: { name: 'Estimate' } }] },
  ],
  [
    'preview',
    'Evaluate commands without saving or publishing.',
    commands,
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
];
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
        validatePayload(child, entry, `${path}[${String(index)}]`);
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
      entry.inputs.length ||
      entry.outputs.length ||
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
        'Modeled assemblies need one material definition, matching geometry, empty inputs and outputs, and no formula system components',
      );
    if (entry.wallTemplate) validateWallTemplate(entry.wallTemplate);
    if (entry.ceilingTemplate) validateCeilingTemplate(entry.ceilingTemplate);
    if (entry.materialTemplate)
      validateMaterialTemplate(entry.materialTemplate);
    return;
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

export function validateProject(input: unknown): asserts input is Project {
  if (
    input &&
    typeof input === 'object' &&
    'formatVersion' in input &&
    input.formatVersion !== 4
  )
    throw new Error(
      'Unsupported project format. Create a new takeoff with this version of Bluewing.',
    );
  validatePayload(
    object(
      {
        formatVersion: { type: 'number', enum: [4] },
        id: string,
        name: string,
        revision: { type: 'number', minimum: 0 },
        sheets: { type: 'object', additionalProperties: sheet },
        geometries: { type: 'object', additionalProperties: geometry },
        groups: { type: 'object', additionalProperties: group },
        recipes: { type: 'object', additionalProperties: recipe },
        assignments: { type: 'object', additionalProperties: assignment },
        construction: constructionSchema,
        review: reviewSchema,
      },
      [
        'formatVersion',
        'id',
        'name',
        'revision',
        'sheets',
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
  validateDetailed(project);
  if (!Number.isInteger(project.revision) || project.revision < 0)
    throw new Error('Unsupported project format or revision');
  for (const [key, entries, schema] of [
    ['sheets', project.sheets, sheet],
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
  for (const entry of Object.values(project.sheets)) {
    if (!Number.isInteger(entry.pageIndex))
      throw new Error('PDF pageIndex must be an integer');
  }
  for (const entry of Object.values(project.geometries)) {
    requireEntity(project.sheets, entry.sheetId, 'Sheet');
    validateGeometry(entry);
  }
  for (const entry of Object.values(project.groups)) {
    if (new Set(entry.geometryIds).size !== entry.geometryIds.length)
      throw new Error('Group membership must be unique');
    entry.geometryIds.forEach((member) =>
      requireEntity(project.geometries, member, 'Geometry'),
    );
  }
  for (const entry of Object.values(project.recipes)) validateAssembly(entry);
  for (const entry of Object.values(project.assignments)) {
    requireEntity(project.groups, entry.groupId, 'Group');
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
        allowance.packageSize !== undefined &&
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
  calculation: () => CalculationSnapshot = () => calculateProject(next),
): { project: Project; data: unknown; changed: boolean } {
  const definition = validateCommand(call);
  if (['batch', 'preview', 'history.undo', 'history.redo'].includes(call.name))
    throw new Error(`${call.name} must run through ProjectSession`);
  const payload = (call.payload ?? {}) as Record<string, unknown>;
  const entityId = payload.id as string;
  if (entityId && ['__proto__', 'constructor', 'prototype'].includes(entityId))
    throw new Error('Invalid entity id');
  let data: unknown = null;
  switch (call.name) {
    case 'commands.list':
      data = commandRegistry;
      break;
    case 'project.inspect':
      data = next;
      break;
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
      data = quantityReport(calculation());
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
    case 'sheet.scale':
      requireEntity(next.sheets, entityId, 'Sheet').calibration =
        calibrationFromRatio(payload as unknown as PaperScale);
      break;
    case 'sheet.calibrate':
      requireEntity(next.sheets, entityId, 'Sheet').calibration =
        calibrationFromDistance(
          payload.start as { x: number; y: number },
          payload.end as { x: number; y: number },
          payload.distance as { value: number; unit: 'm' },
        );
      break;
    case 'sheet.delete':
      requireEntity(next.sheets, entityId, 'Sheet');
      for (const entry of Object.values(next.geometries))
        if (entry.sheetId === entityId) removeGeometry(next, entry.id);
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
      copyDetailedGeometry(next, entityId, source.id);
      data = source;
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
      call.name.endsWith('.delete') ||
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
  if (definition.mutates && validateResult) validateProject(next);
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
