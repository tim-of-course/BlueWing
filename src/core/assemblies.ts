import type {
  Assembly,
  AssemblyLibrary,
  RecipeInput,
  RecipeOutput,
  Unit,
} from './types';
import { validateAssembly } from './commands';

const number = (
  name: string,
  unit: Unit,
  value?: number,
  minimum = 0,
): RecipeInput => ({
  name,
  type: 'number',
  unit,
  minimum,
  ...(value === undefined ? {} : { default: value }),
});
const output = (
  id: string,
  name: string,
  materialId: string,
  unit: Unit,
  formula: string,
): RecipeOutput => ({
  id,
  name,
  materialId,
  unit,
  formula,
  allowance: { wastePercent: 0 },
});
/** Editable estimating templates. Project detail dimensions are deliberately required. */
export function starterAssemblies(): Record<string, Assembly> {
  const assemblies: Assembly[] = [
    {
      id: 'drywall-face',
      name: 'Drywall wall face',
      category: 'Drywall',
      description:
        'One wall face. Set the material ID for its board type and thickness. Deduction is area per layer; layers apply after deduction.',
      geometryKinds: ['path'],
      inputs: [
        number('height', 'ft', undefined, Number.MIN_VALUE),
        number('layers', 'scalar', 1, 1),
        number('deduction', 'ft2', 0),
      ],
      outputs: [
        output(
          'board-area',
          'Net board area',
          'drywall-unspecified',
          'ft2',
          '(length * height - deduction) * layers',
        ),
      ],
    },
    {
      id: 'steel-straight-run',
      name: 'Steel studs — straight run',
      category: 'Light gauge framing',
      description:
        'Spacing estimate for an uninterrupted run, plus explicitly entered extra studs. Set the material ID to the required stud designation. Opening and junction framing require separate assignments.',
      geometryKinds: ['path'],
      inputs: [
        number('height', 'ft', undefined, Number.MIN_VALUE),
        number('spacing', 'in', 16, Number.MIN_VALUE),
        number('endAllowance', 'in', 0),
        number('extraStuds', 'ea', 0),
        number('stockLength', 'ft', undefined, Number.MIN_VALUE),
      ],
      outputs: [
        {
          ...output(
            'studs',
            'Studs',
            'steel-stud-unspecified',
            'ea',
            'ceil(length / spacing) + 1 + extraStuds',
          ),
          piece: {
            role: 'Stud',
            cutLength: { formula: 'height - endAllowance', unit: 'ft' },
            stockLength: { formula: 'stockLength', unit: 'ft' },
          },
        },
      ],
    },
    {
      id: 'header-components',
      name: 'Header component schedule',
      category: 'Light gauge framing',
      description:
        'One component of the specified header detail per opening. Add outputs for other components. No structural detail is assumed.',
      geometryKinds: ['count'],
      inputs: [
        number('openingWidth', 'ft', undefined, Number.MIN_VALUE),
        number('endExtension', 'in'),
        number('piecesPerOpening', 'ea', undefined, 1),
        number('stockLength', 'ft', undefined, Number.MIN_VALUE),
      ],
      outputs: [
        {
          ...output(
            'header-piece',
            'Header components',
            'header-component-unspecified',
            'ea',
            'count * piecesPerOpening',
          ),
          piece: {
            role: 'Header component',
            cutLength: {
              formula: 'openingWidth + 2 * endExtension',
              unit: 'ft',
            },
            stockLength: { formula: 'stockLength', unit: 'ft' },
          },
        },
      ],
    },
    {
      id: 'ceiling-finish',
      name: 'Acoustical ceiling area',
      category: 'Acoustical ceilings',
      description:
        'Net finish area and perimeter only. Grid members and hangers need their own detail-based calculations.',
      geometryKinds: ['area'],
      inputs: [number('deduction', 'ft2', 0)],
      outputs: [
        output(
          'ceiling-area',
          'Ceiling area',
          'acoustical-ceiling-unspecified',
          'ft2',
          'area - deduction',
        ),
        output(
          'edge',
          'Perimeter trim',
          'ceiling-edge-unspecified',
          'ft',
          'perimeter',
        ),
      ],
    },
    {
      id: 'frp-face',
      name: 'FRP / wall sheathing face',
      category: 'FRP and sheathing',
      description:
        'Set the material ID to the specified panel product. Deduction is area per layer.',
      geometryKinds: ['path'],
      inputs: [
        number('height', 'ft', undefined, Number.MIN_VALUE),
        number('layers', 'scalar', 1, 1),
        number('deduction', 'ft2', 0),
      ],
      outputs: [
        output(
          'panel-area',
          'Panel area',
          'frp-unspecified',
          'ft2',
          '(length * height - deduction) * layers',
        ),
      ],
    },
    {
      id: 'blocking-runs',
      name: 'Blocking / backing runs',
      category: 'Blocking and rough carpentry',
      description:
        'Measure the backing run and supply the number of rows. Set the material ID to its section and specification.',
      geometryKinds: ['path'],
      inputs: [number('rows', 'scalar', 1, 1)],
      outputs: [
        output(
          'blocking-length',
          'Blocking length',
          'blocking-unspecified',
          'ft',
          'length * rows',
        ),
      ],
    },
    {
      id: 'acoustical-panels',
      name: 'Acoustical wall panels',
      category: 'Acoustical wall panels',
      description:
        'Count panels of one type and enter their dimensions. Use separate assignments for different products.',
      geometryKinds: ['count'],
      inputs: [
        number('width', 'ft', undefined, Number.MIN_VALUE),
        number('height', 'ft', undefined, Number.MIN_VALUE),
      ],
      outputs: [
        output(
          'panels',
          'Panels',
          'acoustical-panel-unspecified',
          'ea',
          'count',
        ),
        output(
          'coverage',
          'Panel coverage',
          'acoustical-panel-unspecified',
          'ft2',
          'count * width * height',
        ),
      ],
    },
  ];
  return Object.fromEntries(
    assemblies.map((assembly) => [assembly.id, assembly]),
  );
}
export function createLibrary(): AssemblyLibrary {
  return { version: 1, revision: 0, assemblies: starterAssemblies() };
}
export function validateLibrary(
  value: unknown,
): asserts value is AssemblyLibrary {
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('revision' in value) ||
    !Number.isInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !('assemblies' in value) ||
    !value.assemblies ||
    typeof value.assemblies !== 'object' ||
    Array.isArray(value.assemblies)
  )
    throw new Error('Invalid assembly library');
  for (const [id, assembly] of Object.entries(value.assemblies)) {
    validateAssembly(assembly);
    if (id !== assembly.id) throw new Error('Invalid library assembly id');
  }
}
export function copyAssembly(assembly: Assembly, id: string): Assembly {
  return {
    ...structuredClone(assembly),
    id,
    librarySource: { id: assembly.id, name: assembly.name },
  };
}
