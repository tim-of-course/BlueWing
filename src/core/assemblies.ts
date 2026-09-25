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
function ceilingGrid(square: boolean): Assembly {
  const size = square ? '2x2' : '2x4';
  const counted = (
    id: string,
    name: string,
    materialId: string,
    formula: string,
  ): RecipeOutput => ({
    ...output(id, name, materialId, 'ea', formula),
    allowance: { wastePercent: 0, packageSize: 1 },
  });
  return {
    id: `ceiling-grid-${size}`,
    name: `Acoustical ceiling ${size} grid estimate`,
    category: 'Acoustical ceilings',
    description:
      'Area/perimeter estimate with mains at 4 ft and cross tees at 2 ft centers. Tile and grid deductions are independent totals. Wall angle uses perimeter plus added edges less excluded edges. Counts round after group totals and waste. Set actual product IDs, including main/angle stock lengths. Border cuts, grid orientation, hangers and offcut reuse are not calculated.',
    reference:
      'Standard 4 ft main / 2 ft cross-tee module; verify specified system and border allowances. https://www.armstrongceilings.com/content/dam/armstrongceilings/commercial/north-america/technical-guides/installing-suspended-ceilings-guide.pdf',
    geometryKinds: ['area'],
    inputs: [
      number('tileDeduction', 'ft2', 0),
      number('gridDeduction', 'ft2', 0),
      number('mainSpacing', 'ft', 4, Number.MIN_VALUE),
      number('crossTeeSpacing', 'ft', 2, Number.MIN_VALUE),
      number('mainStockLength', 'ft', 12, Number.MIN_VALUE),
      number('wallAngleStockLength', 'ft', 12, Number.MIN_VALUE),
      number('extraTwoFootTees', 'ea', 0),
      number('extraWallAngle', 'ft', 0),
      number('wallAngleDeduction', 'ft', 0),
    ],
    outputs: [
      output(
        'ceiling-area',
        'Ceiling tile area',
        `ceiling-tile-${size}-unspecified`,
        'ft2',
        'area - tileDeduction',
      ),
      counted(
        'tee-2ft',
        '2 ft cross tees',
        'ceiling-tee-2ft-unspecified',
        square
          ? '(area - gridDeduction) / (mainSpacing * crossTeeSpacing) + extraTwoFootTees'
          : 'extraTwoFootTees',
      ),
      counted(
        'tee-4ft',
        '4 ft cross tees',
        'ceiling-tee-4ft-unspecified',
        '(area - gridDeduction) / (mainSpacing * crossTeeSpacing)',
      ),
      counted(
        'mains',
        'Main runner stock lengths',
        'ceiling-main-12ft-unspecified',
        '(area - gridDeduction) / (mainSpacing * mainStockLength)',
      ),
      counted(
        'wall-angle',
        'Wall angle stock lengths',
        'ceiling-wall-angle-12ft-unspecified',
        '(perimeter + extraWallAngle - wallAngleDeduction) / wallAngleStockLength',
      ),
    ],
  };
}
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
    ceilingGrid(true),
    ceilingGrid(false),
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
