import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import {
  validateAssembly,
  validateProject,
  executeCommand,
} from '../../src/core/commands';
import { starterAssemblies, copyAssembly } from '../../src/core/assemblies';
import {
  calculateProject,
  pieceSchedule,
  exportPieces,
  exportQuantities,
} from '../../src/core/calculations';
import {
  createSystemAssembly,
  componentOutputId,
} from '../../src/core/systems';
import type { Recipe } from '../../src/core/types';
function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}
function starter(id: string): Recipe {
  const recipe = starterAssemblies()[id];
  assert.ok(recipe);
  return recipe;
}
function fixture() {
  const framing = starter('steel-straight-run');
  required(
    framing.inputs.find((input) => input.name === 'stockLength'),
  ).default = 12;
  const faceB = starter('drywall-face');
  required(faceB.inputs.find((input) => input.name === 'layers')).default = 2;
  const system = createSystemAssembly({
    id: 'wall',
    name: 'Two-face wall',
    inputs: [{ name: 'height', type: 'number', unit: 'mm', minimum: 1 }],
    components: [
      { id: 'framing', assembly: framing, bindings: { height: 'height' } },
      {
        id: 'faceA',
        assembly: starter('drywall-face'),
        bindings: { height: 'height' },
      },
      { id: 'faceB', assembly: faceB, bindings: { height: 'height' } },
      { id: 'backing', assembly: starter('blocking-runs'), bindings: {} },
    ],
  });
  const project = createProject('Systems');
  project.sheets.s = {
    id: 's',
    name: 'Plan',
    assetId: 'pdf',
    pageIndex: 0,
    width: 100,
    height: 100,
    calibration: { metresPerUnit: 0.3048 },
  };
  project.geometries.wall = {
    id: 'wall',
    sheetId: 's',
    name: 'Wall 1',
    kind: 'path',
    points: [
      { x: 0, y: 0 },
      { x: 24, y: 0 },
    ],
  };
  project.groups.g = { id: 'g', name: 'Walls', geometryIds: ['wall'] };
  project.recipes.wall = system;
  const assignment = {
    id: 'a',
    groupId: 'g',
    recipeId: 'wall',
    inputs: { height: 3048 },
    allowances: {},
  };
  project.assignments.a = assignment;
  return { project, system, assignment };
}
function near(actual: number | undefined, expected: number) {
  assert.ok(
    actual !== undefined && Math.abs(actual - expected) < 1e-8,
    `${String(actual)} != ${String(expected)}`,
  );
}
void test('system combines existing formulas once with converted shared dimensions and component defaults', () => {
  const { project, system } = fixture();
  validateProject(project);
  const accepted = executeCommand(project, {
    name: 'assembly.put',
    payload: system,
  }).project;
  const result = calculateProject(accepted);
  assert.equal(result.complete, true);
  assert.equal(result.outputs.length, 4);
  near(
    result.outputs.find((output) => output.outputId === 'faceA/board-area')
      ?.baseAmount,
    240,
  );
  near(
    result.outputs.find((output) => output.outputId === 'faceB/board-area')
      ?.baseAmount,
    480,
  );
  near(
    result.totals.find((total) => total.materialId === 'drywall-unspecified')
      ?.amount,
    720,
  );
  near(
    result.totals.find((total) => total.materialId === 'blocking-unspecified')
      ?.amount,
    24,
  );
  const pieces = pieceSchedule(accepted);
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0]?.quantity, 19);
  near(pieces[0].cutLength_m ?? undefined, 3.048);
  assert.equal(pieces[0].outputId, 'framing/studs');
  assert.equal(pieces[0].geometryId, 'wall');
  assert.equal(result.outputs[0]?.recipeId, 'wall');
  near(result.outputs[0].sources[0]?.inputs.height as number, 10);
  assert.ok(exportPieces(accepted, 'csv').includes('framing/studs'));
  assert.ok(exportQuantities(accepted, 'csv').includes('faceB/board-area'));
});
void test('object shared overrides and independent component allowances retain piece requirements', () => {
  const { project } = fixture();
  required(project.assignments.a).geometryInputs = { wall: { height: 2438.4 } };
  required(project.assignments.a).allowances = {
    'faceA/board-area': { wastePercent: 10 },
    'framing/studs': { wastePercent: 10, packageSize: 20 },
  };
  validateProject(project);
  const result = calculateProject(project);
  near(
    result.outputs.find((output) => output.outputId === 'faceA/board-area')
      ?.purchasedAmount,
    211.2,
  );
  near(
    result.outputs.find((output) => output.outputId === 'faceB/board-area')
      ?.purchasedAmount,
    384,
  );
  near(
    result.outputs.find((output) => output.outputId === 'framing/studs')
      ?.purchasedAmount,
    40,
  );
  assert.equal(pieceSchedule(project)[0]?.quantity, 19);
  required(project.assignments.a).allowances['framing/studs'] = {
    wastePercent: 0,
    packageSize: 1.5,
  };
  assert.throws(() => {
    validateProject(project);
  }, /whole number/);
});
void test('parent shared required values and unbound component required values remain incomplete', () => {
  const { project, system } = fixture();
  required(project.assignments.a).inputs = {};
  assert.equal(calculateProject(project).complete, false);
  assert.match(
    required(calculateProject(project).outputs[0]).diagnostics.join(),
    /Required input: height/,
  );
  required(system.inputs[0]).default = 3048;
  assert.equal(calculateProject(project).complete, true);
  delete required(
    required(required(system.components)[0]).assembly.inputs.find(
      (input) => input.name === 'stockLength',
    ),
  ).default;
  const result = calculateProject(project);
  assert.equal(result.complete, false);
  assert.match(
    required(result.outputs[0]).diagnostics.join(),
    /Required input: stockLength/,
  );
  assert.equal(result.outputs[1]?.complete, true);
});
void test('bindings reject incompatible units, unknown inputs and nesting; booleans stay booleans', () => {
  const { system } = fixture();
  required(system.inputs[0]).unit = 'ft2';
  assert.throws(() => {
    validateAssembly(system);
  }, /Incompatible/);
  required(system.inputs[0]).unit = 'mm';
  required(required(system.components)[0]).bindings.height = 'missing';
  assert.throws(() => {
    validateAssembly(system);
  }, /Invalid component binding/);
  required(required(system.components)[0]).bindings.height = 'height';
  required(required(system.components)[0]).assembly.components = [
    required(required(system.components)[0]),
  ];
  assert.throws(() => {
    validateAssembly(system);
  });
  const { project, system: valid } = fixture();
  valid.inputs.push({
    name: 'double',
    type: 'boolean',
    unit: 'scalar',
    default: true,
  });
  const face = required(required(valid.components)[1]);
  face.assembly.inputs.push({
    name: 'double',
    type: 'boolean',
    unit: 'scalar',
  });
  face.bindings.double = 'double';
  required(face.assembly.outputs[0]).formula =
    'if(double, length * height * 2, length * height)';
  validateProject(project);
  near(calculateProject(project).outputs[1]?.baseAmount, 480);
  required(valid.inputs.find((input) => input.name === 'double')).type =
    'number';
  assert.throws(() => {
    validateAssembly(valid);
  });
});
void test('system snapshots and imported/global copies are isolated with stable unique output ids', () => {
  const source = starter('drywall-face');
  const system = createSystemAssembly({
    id: 's',
    name: 'Wall',
    inputs: [],
    components: [
      { id: 'face/a', assembly: source, bindings: {} },
      { id: 'face', assembly: source, bindings: {} },
    ],
  });
  required(source.outputs[0]).formula = '0';
  const copy = copyAssembly(system, 'imported');
  required(
    required(required(system.components)[0]).assembly.outputs[0],
  ).formula = '1';
  assert.equal(
    required(required(required(copy.components)[0]).assembly.outputs[0])
      .formula,
    '(length * height - deduction) * layers',
  );
  assert.equal(
    required(required(required(system.components)[1]).assembly.outputs[0])
      .formula,
    '(length * height - deduction) * layers',
  );
  assert.notEqual(
    componentOutputId('face/a', 'b'),
    componentOutputId('face', 'a/b'),
  );
  const { project, system: wall } = fixture();
  const before = calculateProject(project).outputs.map(
    (output) => output.outputId,
  );
  required(wall.components).reverse();
  assert.deepEqual(
    calculateProject(project)
      .outputs.map((output) => output.outputId)
      .sort(),
    before.sort(),
  );
  wall.components = [];
  assert.throws(() => {
    validateAssembly(wall);
  }, /need components/);
  assert.throws(() => calculateProject(project), /need components/);
});
