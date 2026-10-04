import type {
  Assembly,
  AssemblyLibrary,
  RecipeInput,
  RecipeOutput,
  Unit,
} from './types';
import { validateAssembly } from './commands';
import { modeledStarters } from './modeled-starters';

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
const foot = 0.3048;
const inch = 0.0254;

function ceilingGrid(square: boolean): Assembly {
  const size = square ? '2x2' : '2x4';
  const section = { width: (15 / 16) * inch, depth: 1.5 * inch };
  return {
    id: `ceiling-grid-${size}`,
    name: `Acoustical ceiling ${size} layout`,
    category: 'Acoustical ceilings',
    description:
      'Modeled grid and tile area clipped to the traced room. Starter elevation is 9 ft at the finished underside, with mains parallel to world X and the grid origin at world 0,0. Edit these settings to match the plan. Nominal starter sections are 15/16 in wide by 1-1/2 in deep; wall angle is 7/8 by 7/8 in. Set the specified products and dimensions. Members use rectangular envelopes with their lower edges at the ceiling elevation; entered tile thickness extends upward from the same datum. Counts and cuts come from the displayed members; tile purchasing uses net area. Hangers, connector tabs, tegular offsets and offcut reuse are not included.',
    geometryKinds: ['area'],
    inputs: [],
    outputs: [],
    ceilingTemplate: {
      elevation: 9 * foot,
      materialId: `ceiling-tile-${size}-unspecified`,
      layers: 1,
      grid: {
        system: size,
        origin: { x: 0, y: 0 },
        rotation: 0,
        main: {
          ...section,
          materialId: 'ceiling-main-12ft-unspecified',
          stockLength: 12 * foot,
        },
        crossTee4: {
          ...section,
          materialId: 'ceiling-tee-4ft-unspecified',
          stockLength: 4 * foot,
        },
        ...(square
          ? {
              crossTee2: {
                ...section,
                materialId: 'ceiling-tee-2ft-unspecified',
                stockLength: 2 * foot,
              },
            }
          : {}),
        wallAngle: {
          materialId: 'ceiling-wall-angle-12ft-unspecified',
          width: (7 / 8) * inch,
          depth: (7 / 8) * inch,
          stockLength: 12 * foot,
        },
      },
    },
  };
}

function ceilingGridEstimate(square: boolean): Assembly {
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
    id: `ceiling-grid-${size}-estimate`,
    name: `Acoustical ceiling ${size} grid estimate`,
    category: 'Acoustical ceilings',
    description:
      'Unmodeled area/perimeter estimate; it creates no 3D material objects. Uses mains at 4 ft and cross tees at 2 ft centers. Tile and grid deductions are independent totals. Wall angle uses perimeter plus added edges less excluded edges. Counts round after group totals and waste. Set actual product IDs, including main/angle stock lengths. Use a ceiling layout assembly for positioned members and border cuts.',
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
      id: 'steel-wall',
      name: 'Steel wall with drywall',
      category: 'Light gauge framing',
      description:
        'Modeled wall framing and finishes. Enter the wall height before quantities are available. Starter members use 3-5/8 in studs with 1-5/8 in flanges at 16 in spacing, 12 ft stud stock, and 10 ft track stock. Two optional finish faces start with one layer of 5/8 in drywall each. Edit the specified products, member dimensions, allowances and finish layers; remove finishes for framing-only work or add positioned backing rows. Openings and project header details are entered on each applied wall.',
      geometryKinds: ['path'],
      inputs: [],
      outputs: [],
      wallTemplate: {
        baseElevation: 0,
        studSpacing: 16 * inch,
        stud: {
          materialId: 'steel-stud-3-5-8-unspecified',
          width: 1.625 * inch,
          depth: 3.625 * inch,
          stockLength: 12 * foot,
        },
        track: {
          materialId: 'steel-track-3-5-8-unspecified',
          width: 3.625 * inch,
          depth: 1.25 * inch,
          stockLength: 10 * foot,
        },
        bottomAllowance: 0,
        topAllowance: 0,
        finishes: ['front', 'back'].map((face) => ({
          id: face,
          materialId: 'drywall-5-8-unspecified',
          face: face as 'front' | 'back',
          layers: 1,
          thickness: 0.625 * inch,
          packageSize: 32 * foot ** 2,
        })),
        backing: [],
      },
    },
    {
      id: 'drywall-face',
      name: 'Drywall wall face estimate',
      category: 'Drywall',
      description:
        'Unmodeled estimate for one wall face. Set the material ID for its board type and thickness. Deduction is area per layer; layers apply after deduction. Use a modeled wall finish for material surfaces in 3D.',
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
      name: 'Steel studs straight run estimate',
      category: 'Light gauge framing',
      description:
        'Unmodeled spacing estimate for an uninterrupted run, plus explicitly entered extra studs. Set the material ID to the required stud designation. Opening and junction framing require separate assignments. Use a modeled steel wall for positioned members in 3D.',
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
      name: 'Header component estimate',
      category: 'Light gauge framing',
      description:
        'Unmodeled estimate of one component of the specified header detail per opening. Add outputs for other components. No structural detail is assumed. Positioned headers belong to openings on a modeled wall.',
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
      name: 'Acoustical ceiling area estimate',
      category: 'Acoustical ceilings',
      description:
        'Unmodeled net finish area and perimeter estimate. Use a ceiling layout assembly for positioned grid and tile surfaces.',
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
    ceilingGridEstimate(true),
    ceilingGridEstimate(false),
    {
      id: 'frp-face',
      name: 'FRP / wall sheathing face estimate',
      category: 'FRP and sheathing',
      description:
        'Unmodeled surface estimate. Set the material ID to the specified panel product. Deduction is area per layer. Add this product as a modeled wall finish when its physical surfaces are needed in 3D.',
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
      name: 'Blocking / backing run estimate',
      category: 'Blocking and rough carpentry',
      description:
        'Unmodeled run estimate. Measure the backing run and supply the number of rows. Set the material ID to its section and specification. Add positioned backing rows to a modeled wall for actual cuts and 3D members.',
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
      name: 'Acoustical wall panel estimate',
      category: 'Acoustical wall panels',
      description:
        'Unmodeled panel estimate. Count panels of one type and enter their dimensions. Use separate assignments for different products. This does not infer panel positions, elevation or orientation.',
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
  const wall = assemblies.find(
    (assembly) => assembly.id === 'steel-wall',
  )?.wallTemplate;
  if (wall) assemblies.push(...modeledStarters(wall));
  return Object.fromEntries(
    assemblies.map((assembly) => [assembly.id, assembly]),
  );
}
export function createLibrary(): AssemblyLibrary {
  return { version: 2, revision: 0, assemblies: starterAssemblies() };
}
export function validateLibrary(
  value: unknown,
): asserts value is AssemblyLibrary {
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 2 ||
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
