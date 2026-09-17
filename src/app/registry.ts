import {
  commandRegistry,
  type CommandDefinition,
  type PayloadSchema,
} from '../core/commands';

const string: PayloadSchema = { type: 'string' };
function entry(
  name: string,
  description: string,
  properties: Record<string, PayloadSchema>,
  required: string[],
  mutates: boolean,
  payload: Record<string, unknown>,
): CommandDefinition {
  return {
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
  };
}
export const applicationCommands = [
  entry(
    'project.create',
    'Create a new local project at a new path. Close the current project first.',
    { name: string, path: string },
    ['name', 'path'],
    true,
    { name: 'Estimate', path: '/path/estimate.bluewing' },
  ),
  entry(
    'project.open',
    'Open a local project. Close the current project first.',
    { path: string },
    ['path'],
    true,
    { path: '/path/estimate.bluewing' },
  ),
  entry(
    'project.close',
    'Close the project and clear session undo history.',
    {},
    [],
    true,
    {},
  ),
  entry(
    'project.import',
    'Import every page of a PDF in one undoable save.',
    { path: string },
    ['path'],
    true,
    { path: '/path/plans.pdf' },
  ),
  entry(
    'sheet.render',
    'Render a bounded PNG with page/pixel mappings using the workspace renderer.',
    {
      sheetId: string,
      path: string,
      maxDimension: { type: 'number', minimum: 64 },
      mode: { type: 'string', enum: ['plan', 'takeoff', 'combined'] },
      bounds: {
        type: 'object',
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number', minimum: Number.MIN_VALUE },
          height: { type: 'number', minimum: Number.MIN_VALUE },
        },
        required: ['x', 'y', 'width', 'height'],
        additionalProperties: false,
      },
    },
    ['sheetId', 'path'],
    false,
    {
      sheetId: 'sheet-1',
      path: '/path/sheet.png',
      maxDimension: 2048,
      mode: 'combined',
    },
  ),
  entry(
    'web.inspect',
    'Read desktop bridge and cached web version information.',
    {},
    [],
    false,
    {},
  ),
  entry(
    'web.stage',
    'Download and verify a complete web release without activating it.',
    { manifestUrl: string },
    ['manifestUrl'],
    false,
    { manifestUrl: 'https://your-release-host/manifest.json' },
  ),
  entry(
    'web.activate',
    'Activate a staged web release while no project is open.',
    { version: string },
    ['version'],
    true,
    { version: '0.1.1' },
  ),
] as const;

/** UI and terminal discovery share the core registry and these native-session entries. */
export const registry = [...commandRegistry, ...applicationCommands];
