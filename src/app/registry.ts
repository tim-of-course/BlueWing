import {
  commandRegistry,
  assemblySchema,
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
    'library.inspect',
    'Read this device’s global assembly library, independent of the project.',
    {},
    [],
    false,
    {},
  ),
  entry(
    'library.put',
    'Save a global assembly. Existing project copies are unchanged; global edits have no project undo.',
    {
      assembly: assemblySchema,
      expectedLibraryRevision: { type: 'number', minimum: 0 },
    },
    ['assembly', 'expectedLibraryRevision'],
    true,
    {
      assembly: commandRegistry.find((entry) => entry.name === 'assembly.put')
        ?.examples[0]?.payload,
      expectedLibraryRevision: 0,
    },
  ),
  entry(
    'library.delete',
    'Delete a global assembly without changing project copies.',
    { id: string, expectedLibraryRevision: { type: 'number', minimum: 0 } },
    ['id', 'expectedLibraryRevision'],
    true,
    { id: 'assembly-1', expectedLibraryRevision: 0 },
  ),
  entry(
    'library.addStarters',
    'Add missing starter assemblies, including previously deleted starters. Preserve existing definitions and project copies.',
    { expectedLibraryRevision: { type: 'number', minimum: 0 } },
    ['expectedLibraryRevision'],
    true,
    { expectedLibraryRevision: 0 },
  ),
  entry(
    'assembly.import',
    'Copy a global assembly into this project with a new id and one undo step.',
    { libraryId: string, id: string },
    ['libraryId', 'id'],
    true,
    { libraryId: 'drywall-face', id: 'project-drywall' },
  ),
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
