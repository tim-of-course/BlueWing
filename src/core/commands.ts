import type {
  Assignment,
  CommandCall,
  Geometry,
  Group,
  Project,
  Recipe,
  Sheet,
} from './types';
import { calibrationFromDistance, newId, validateGeometry } from './geometry';
import { calculateProject, exportQuantities } from './calculations';
import { calibrationFromRatio, type PaperScale } from './scale';

export interface PayloadSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'boolean';
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
const recipe = object({
  id: string,
  name: string,
  geometryKinds: array({ type: 'string', enum: ['path', 'area', 'count'] }),
  inputs: array(
    object({
      name: string,
      type: { type: 'string', enum: ['number', 'boolean'] },
      unit,
      default: value,
    }),
  ),
  outputs: array(
    object({
      id: string,
      name: string,
      materialId: string,
      unit,
      formula: string,
      allowance,
    }),
  ),
});
const assignment = object({
  id: string,
  groupId: string,
  recipeId: string,
  inputs: { type: 'object', additionalProperties: value },
  allowances: { type: 'object', additionalProperties: allowance },
});
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
export const commandRegistry: readonly CommandDefinition[] = definitions.map(
  ([name, description, schema, mutates, payload]) => ({
    name,
    description,
    schema,
    mutates,
    examples: [{ name, payload }],
  }),
);
function record(item: unknown): item is Record<string, unknown> {
  return typeof item === 'object' && item !== null && !Array.isArray(item);
}
export function validatePayload(
  schema: PayloadSchema,
  item: unknown,
  path = 'payload',
): void {
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
export function validateProject(input: unknown): asserts input is Project {
  validatePayload(
    object({
      formatVersion: { type: 'number', enum: [1] },
      id: string,
      name: string,
      revision: { type: 'number', minimum: 0 },
      sheets: { type: 'object', additionalProperties: sheet },
      geometries: { type: 'object', additionalProperties: geometry },
      groups: { type: 'object', additionalProperties: group },
      recipes: { type: 'object', additionalProperties: recipe },
      assignments: { type: 'object', additionalProperties: assignment },
    }),
    input,
    'project',
  );
  const project = input as Project;
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
  for (const entry of Object.values(project.recipes)) {
    const names = new Set<string>();
    for (const field of entry.inputs) {
      if (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.name) ||
        names.has(field.name) ||
        ['length', 'area', 'perimeter', 'count'].includes(field.name)
      )
        throw new Error(
          'Recipe input names must be unique identifiers distinct from metrics',
        );
      names.add(field.name);
      if (
        typeof field.default !== field.type ||
        (typeof field.default === 'number' &&
          !Number.isFinite(field.default)) ||
        (field.type === 'boolean' && field.unit !== 'scalar')
      )
        throw new Error(`Invalid default for ${field.name}`);
    }
    if (
      entry.outputs.length === 0 ||
      new Set(entry.outputs.map((output) => output.id)).size !==
        entry.outputs.length
    )
      throw new Error('Recipe needs outputs with unique ids');
  }
  for (const entry of Object.values(project.assignments)) {
    requireEntity(project.groups, entry.groupId, 'Group');
    const definition = requireEntity(project.recipes, entry.recipeId, 'Recipe');
    for (const [name, item] of Object.entries(entry.inputs)) {
      const field = definition.inputs.find(
        (candidate) => candidate.name === name,
      );
      if (
        !field ||
        typeof item !== field.type ||
        (typeof item === 'number' && !Number.isFinite(item))
      )
        throw new Error(`Invalid assignment input: ${name}`);
    }
    for (const outputId of Object.keys(entry.allowances))
      if (!definition.outputs.some((output) => output.id === outputId))
        throw new Error(`Unknown allowance output: ${outputId}`);
  }
}
export function executeCommand(
  project: Project,
  call: CommandCall,
  validateResult = true,
): { project: Project; data: unknown; changed: boolean } {
  const definition = validateCommand(call);
  if (['batch', 'preview', 'history.undo', 'history.redo'].includes(call.name))
    throw new Error(`${call.name} must run through ProjectSession`);
  const next = structuredClone(project);
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
    case 'quantities.inspect':
      data = calculateProject(next);
      break;
    case 'quantities.export':
      data = exportQuantities(next, payload.format as 'csv' | 'json');
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
    case 'recipe.put':
      next.recipes[entityId] = structuredClone(payload) as unknown as Recipe;
      break;
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
      throw new Error(`Unknown command: ${call.name}`);
  }
  if (definition.mutates && validateResult) validateProject(next);
  return { project: next, data, changed: definition.mutates };
}
