import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import { calculateProject } from '../../src/core/calculations';
import {
  formulaOutput,
  formulaQuantity,
  prepareFormula,
} from '../../src/core/formula';
import {
  resolveConstruction,
  emptyConstructionContext,
} from '../../src/core/applied-assemblies';
import {
  generateConstruction,
  validateConstruction,
} from '../../src/core/construction';
import {
  inspectReview,
  reviewFingerprint,
  sourceEntity,
} from '../../src/core/review';
import { createSystemAssembly } from '../../src/core/systems';
import type { Recipe } from '../../src/core/types';

function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

function fixture(count = 2) {
  const project = createProject('Preparation', 'project');
  project.sheets.s = {
    id: 's',
    name: 'Plan',
    assetId: 'pdf',
    pageIndex: 0,
    width: 100,
    height: 100,
    calibration: { metresPerUnit: 1 },
  };
  const geometryIds = Array.from(
    { length: count },
    (_, index) => `g${String(index)}`,
  );
  for (const id of geometryIds)
    project.geometries[id] = {
      id,
      name: id,
      sheetId: 's',
      kind: 'path',
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
    };
  project.groups.group = { id: 'group', name: 'Group', geometryIds };
  const recipe: Recipe = {
    id: 'recipe',
    name: 'Lengths',
    geometryKinds: ['path'],
    inputs: [
      { name: 'multiplier', type: 'number', unit: 'scalar', default: 2 },
    ],
    outputs: Array.from({ length: 4 }, (_, index) => ({
      id: `output${String(index)}`,
      name: 'Length',
      materialId: 'length',
      unit: 'm',
      formula: 'length * multiplier',
      allowance: { wastePercent: 0 },
    })),
  };
  project.recipes.recipe = recipe;
  project.assignments.use = {
    id: 'use',
    groupId: 'group',
    recipeId: 'recipe',
    inputs: {},
    allowances: {},
  };
  return { project, recipe, assignment: project.assignments.use };
}

function modeledFixture() {
  const { project, recipe, assignment } = fixture();
  recipe.inputs = [];
  recipe.outputs = [];
  recipe.wallTemplate = {
    height: 3,
    baseElevation: 0,
    studSpacing: 1,
    stud: { materialId: 'stud', width: 0.04, depth: 0.09 },
    track: { materialId: 'track', width: 0.09, depth: 0.03 },
    finishes: [{ id: 'board', materialId: 'board', face: 'front', layers: 1 }],
  };
  assignment.geometryDetails = { g0: { id: 'w0' }, g1: { id: 'w1' } };
  project.construction = emptyConstructionContext();
  for (const [id, wallId, distance] of [
    ['z-open', 'w0', 2],
    ['other', 'w1', 1],
    ['a-open', 'w0', 0.5],
  ] as const)
    project.construction.openings[id] = {
      id,
      wallId,
      distance,
      width: 0.5,
      sill: 0,
      height: 2,
      jambCount: 1,
    };
  project.construction.placements.place = {
    id: 'place',
    sheetId: 's',
    pageOrigin: { x: 0, y: 0 },
    worldOffset: { x: 10, y: 20, z: 1 },
    rotation: 0,
  };
  return { project, recipe, assignment };
}

void test('a calculation measures each trace once, prepares inputs per source and parses each formula once', () => {
  const { project, recipe, assignment } = fixture(100);
  project.assignments.second = { ...assignment, id: 'second' };
  assignment.geometryInputs = { g0: { multiplier: 3 } };
  const sheet = required(project.sheets.s);
  let measurements = 0,
    inputConversions = 0,
    defaults = 0,
    parses = 0;
  Object.defineProperty(sheet, 'calibration', {
    configurable: true,
    get: () => {
      measurements++;
      return { metresPerUnit: 1 };
    },
  });
  const input = required(recipe.inputs[0]);
  Object.defineProperty(input, 'unit', {
    get: () => {
      inputConversions++;
      return 'scalar';
    },
  });
  Object.defineProperty(input, 'default', {
    get: () => {
      defaults++;
      return 2;
    },
  });
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Restore the exact method and invoke it with .call below.
  const slice = String.prototype.slice;
  String.prototype.slice = function (start, end) {
    if (start === 0 && this.valueOf() === 'length * multiplier') parses++;
    return slice.call(this, start, end);
  };
  let result;
  try {
    result = calculateProject(project);
  } finally {
    String.prototype.slice = slice;
  }
  assert.equal(measurements, 100);
  assert.equal(inputConversions, 200);
  assert.equal(defaults, 2);
  assert.equal(parses, 1);
  assert.deepEqual(
    result.outputs.map((output) => output.baseAmount),
    [804, 804, 804, 804, 800, 800, 800, 800],
  );
  const first = required(result.outputs[0]?.sources[0]);
  first.inputs.multiplier = 99;
  assert.equal(result.outputs[1]?.sources[0]?.inputs.multiplier, 3);
  assert.equal(result.outputs[4]?.sources[0]?.inputs.multiplier, 2);
  Object.defineProperty(sheet, 'calibration', { value: { metresPerUnit: 2 } });
  assert.equal(calculateProject(project).outputs[0]?.baseAmount, 1608);
});

void test('prepared formulas retain lazy branches, units, errors and fresh evaluation variables', () => {
  const evaluate = prepareFormula('if(enabled, length, missing / 0)');
  assert.equal(
    formulaOutput(
      evaluate({
        enabled: true,
        length: formulaQuantity({ value: 12, unit: 'ft' }),
      }),
      'ft',
    ),
    12,
  );
  assert.equal(
    formulaOutput(
      evaluate({
        enabled: true,
        length: formulaQuantity({ value: 2, unit: 'm' }),
      }),
      'm',
    ),
    2,
  );
  assert.throws(() => evaluate({ enabled: false }), {
    message: 'Unavailable or undeclared formula value: missing',
  });
  assert.equal(prepareFormula('false && missing')({}), false);
  assert.equal(prepareFormula('true || (1 / 0 > 0)')({}), true);
  assert.throws(() => prepareFormula('length @ 2'), {
    message: 'Invalid formula token near @ 2',
  });
});

void test('shared preparation keeps output diagnostics and piece buckets independent', () => {
  const { project, recipe, assignment } = fixture();
  recipe.inputs = [{ name: 'cut', type: 'number', unit: 'ft', default: 8 }];
  assignment.geometryInputs = { g1: { cut: 10 } };
  const base = required(recipe.outputs[0]);
  recipe.outputs = [
    {
      ...base,
      id: 'pieces',
      unit: 'ea',
      formula: '2',
      piece: { role: 'stud', cutLength: { formula: 'cut', unit: 'ft' } },
    },
    { ...base, id: 'bad-dimension', unit: 'm2', formula: 'length' },
    { ...base, id: 'lazy', unit: 'm', formula: 'if(true, length, missing)' },
    { ...base, id: 'bad-parse', formula: 'length @ 2' },
  ];
  let result = calculateProject(project);
  assert.deepEqual(
    result.outputs.map((output) => output.outputId),
    ['pieces', 'pieces', 'bad-dimension', 'lazy', 'bad-parse'],
  );
  assert.deepEqual(
    result.outputs
      .slice(0, 2)
      .map((output) => output.sources.map((source) => source.geometryId)),
    [['g0'], ['g1']],
  );
  assert.deepEqual(
    result.outputs.slice(0, 2).map((output) => output.cutLength?.value),
    [8 * 0.3048, 10 * 0.3048],
  );
  assert.equal(
    result.outputs[2]?.sources[0]?.diagnostic,
    'Formula dimension does not match output unit m2',
  );
  assert.equal(result.outputs[3]?.baseAmount, 8);
  assert.equal(
    result.outputs[4]?.sources[0]?.diagnostic,
    'Invalid formula token near @ 2',
  );
  assignment.inputs = { extra: 1 };
  result = calculateProject(project);
  assert.ok(
    result.outputs.every((output) =>
      output.sources.every(
        (source) => source.diagnostic === 'Undeclared assignment input: extra',
      ),
    ),
  );
  assignment.inputs = {};
  delete required(recipe.inputs[0]).default;
  result = calculateProject(project);
  assert.equal(
    result.outputs.at(-1)?.sources[0]?.diagnostic,
    'Required input: cut',
  );
  assert.equal(
    result.outputs.at(-1)?.sources[1]?.diagnostic,
    'Invalid formula token near @ 2',
  );
});

void test('component preparation retains converted shared inputs and independent explanations', () => {
  const { project, recipe } = fixture();
  const component = structuredClone(recipe);
  component.inputs = [{ name: 'height', type: 'number', unit: 'ft' }];
  for (const output of component.outputs) {
    output.unit = 'ft2';
    output.formula = 'length * height';
  }
  project.recipes.recipe = createSystemAssembly({
    id: 'recipe',
    name: 'System',
    inputs: [{ name: 'height', type: 'number', unit: 'mm', default: 3048 }],
    components: [
      { id: 'front', assembly: component, bindings: { height: 'height' } },
      {
        id: 'back',
        assembly: {
          ...component,
          inputs: [{ name: 'height', type: 'number', unit: 'ft', default: 5 }],
        },
        bindings: {},
      },
    ],
  });
  const result = calculateProject(project);
  assert.equal(result.outputs.length, 8);
  assert.equal(result.outputs[0]?.sources[0]?.inputs.height, 10);
  assert.equal(result.outputs[4]?.sources[0]?.inputs.height, 5);
  assert.equal(
    required(result.outputs[0]).baseAmount,
    required(result.outputs[4]).baseAmount * 2,
  );
  required(result.outputs[0].sources[0]).inputs.height = 100;
  assert.equal(result.outputs[1]?.sources[0]?.inputs.height, 10);
});

void test('assignment merges preserve sparse overrides and independently owned nested records', () => {
  const { project, recipe, assignment } = modeledFixture();
  required(recipe.wallTemplate).stud.stockLength = 6;
  assignment.wallOverrides = { stud: { width: 0.05 }, height: 4 };
  required(assignment.geometryDetails).g1 = {
    id: 'w1',
    wall: { height: 5, finishes: [], stud: { stockLength: null } },
  };
  const data = resolveConstruction(project);
  const first = required(data.walls.w0),
    second = required(data.walls.w1);
  assert.equal(first.height, 4);
  assert.equal(second.height, 5);
  assert.deepEqual(second.finishes, []);
  assert.equal(first.stud.stockLength, 6);
  assert.equal(second.stud.stockLength, undefined);
  assert.equal(first.stud.width, 0.05);
  assert.equal(second.stud.depth, 0.09);
  first.stud.depth = 99;
  required(first.finishes?.[0]).layers = 2;
  assert.equal(second.stud.depth, 0.09);
  assert.equal(recipe.wallTemplate?.stud.depth, 0.09);
  assert.equal(
    required(required(required(recipe.wallTemplate).finishes)[0]).layers,
    1,
  );
  assert.equal(resolveConstruction(project).walls.w0?.stud.depth, 0.09);
});

void test('opening lookup preserves generation order, world placement, overlap errors and budgets', () => {
  const { project } = modeledFixture();
  const data = resolveConstruction(project);
  const before = structuredClone(data);
  const result = generateConstruction(project, data);
  assert.equal(result.complete, false);
  assert.deepEqual(
    result.diagnostics.map((diagnostic) => [
      diagnostic.openingId,
      diagnostic.code,
    ]),
    [
      ['a-open', 'missing-header'],
      ['z-open', 'missing-header'],
      ['other', 'missing-header'],
    ],
  );
  const jambs = result.pieces.filter((piece) => piece.role === 'jamb');
  assert.deepEqual(
    jambs.map((piece) => piece.openingId),
    ['a-open', 'a-open', 'z-open', 'z-open', 'other', 'other'],
  );
  assert.equal(jambs[0]?.start.y, 20);
  assert.equal(jambs[0].start.z, 1);
  data.openings = Object.fromEntries(Object.entries(data.openings).reverse());
  assert.deepEqual(generateConstruction(project, data), result);
  assert.deepEqual(
    generateConstruction(project, data, { maxPieces: 10 }),
    generateConstruction(project, before, { maxPieces: 10 }),
  );
  assert.ok(
    generateConstruction(project, data, { maxPieces: 10 }).diagnostics.some(
      (diagnostic) => diagnostic.code === 'generation-budget',
    ),
  );
  required(data.openings['z-open']).distance = 0.6;
  assert.throws(
    () => {
      validateConstruction(project, data);
    },
    {
      message: 'Construction: openings overlap',
    },
  );
  assert.deepEqual(before, resolveConstruction(project));
});

void test('review preparation preserves exact dependency order, canonical text and related owner changes', () => {
  const { project, assignment } = modeledFixture();
  required(assignment.geometryDetails).g1 = {
    id: 'w1',
    wall: {
      conditions: [
        {
          id: 'joint',
          distance: 0,
          kind: 'junction',
          count: 1,
          ownerWallId: 'w0',
        },
      ],
    },
  };
  project.review = {
    marks: {},
    snippets: {
      evidence: {
        id: 'evidence',
        name: 'Evidence',
        sheetId: 's',
        bounds: { x: 0, y: 0, width: 4, height: 4 },
        sources: [{ kind: 'opening', id: 'a-open' }],
        geometryIds: ['g0'],
        annotations: [],
        note: 'Checked',
      },
    },
  };
  const target = { kind: 'wall' as const, id: 'w1' };
  const data = resolveConstruction(project);
  const fingerprint = reviewFingerprint(project, target, data);
  assert.deepEqual(
    JSON.parse(fingerprint),
    [
      data.walls.w1,
      data.walls.w1,
      data.walls.w0,
      data.openings['a-open'],
      data.openings['z-open'],
      data.openings.other,
      project.geometries.g0,
      project.sheets.s?.calibration,
      data.placements.place,
      {
        ...assignment,
        geometryInputs: undefined,
        geometryDetails: assignment.geometryDetails?.g0,
      },
      project.recipes.recipe,
      project.geometries.g1,
      project.sheets.s?.calibration,
      data.placements.place,
      {
        ...assignment,
        geometryInputs: undefined,
        geometryDetails: assignment.geometryDetails?.g1,
      },
      project.recipes.recipe,
      project.review.snippets.evidence,
    ].map(
      (value) =>
        JSON.parse(
          JSON.stringify(value, (_key, item: unknown) =>
            item === undefined ? null : item,
          ),
        ) as unknown,
    ),
  );
  project.review.marks.checked = {
    id: 'checked',
    target,
    status: 'reviewed',
    note: '',
    fingerprint,
  };
  const inspection = inspectReview(project);
  assert.equal(inspection.marks[0]?.effectiveStatus, 'reviewed');
  assert.deepEqual(inspection.unreviewed, [
    { kind: 'wall', id: 'w0' },
    { kind: 'opening', id: 'z-open' },
    { kind: 'opening', id: 'other' },
    { kind: 'opening', id: 'a-open' },
  ]);
  data.openings = Object.fromEntries(Object.entries(data.openings).reverse());
  data.walls = Object.fromEntries(Object.entries(data.walls).reverse());
  assert.equal(reviewFingerprint(project, target, data), fingerprint);
  required(project.geometries.g0).points[1] = { x: 5, y: 0 };
  assert.equal(inspectReview(project).marks[0]?.effectiveStatus, 'changed');
});

void test('project-only source lookups do not resolve unrelated invalid applications', () => {
  const { project, assignment } = modeledFixture();
  project.assignments.duplicate = {
    ...structuredClone(assignment),
    id: 'duplicate',
  };
  assert.equal(
    sourceEntity(project, { kind: 'geometry', id: 'g0' }),
    project.geometries.g0,
  );
  assert.equal(
    sourceEntity(project, { kind: 'assembly', id: 'recipe' }),
    project.recipes.recipe,
  );
  assert.throws(() => sourceEntity(project, { kind: 'wall', id: 'w0' }), {
    message: 'Duplicate applied wall id: w0',
  });
});
