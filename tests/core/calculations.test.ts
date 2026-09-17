import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateProject,
  exportQuantities,
  starterRecipes,
} from '../../src/core/calculations';
import {
  evaluateFormula,
  formulaOutput,
  formulaQuantity,
} from '../../src/core/formula';
import type { Geometry, Project } from '../../src/core/types';

function fixture(
  kind: Geometry['kind'],
  points: Geometry['points'],
  recipeId: string,
): Project {
  return {
    formatVersion: 1,
    id: 'project',
    name: 'Estimate',
    revision: 0,
    sheets: {
      sheet: {
        id: 'sheet',
        name: 'Sheet',
        assetId: 'pdf',
        pageIndex: 0,
        width: 100,
        height: 100,
        calibration: { metresPerUnit: 0.3048 },
      },
    },
    geometries: {
      drawing: {
        id: 'drawing',
        name: 'Drawing',
        sheetId: 'sheet',
        kind,
        points,
      },
    },
    groups: { group: { id: 'group', name: 'Group', geometryIds: ['drawing'] } },
    recipes: starterRecipes(),
    assignments: {
      assignment: {
        id: 'assignment',
        groupId: 'group',
        recipeId,
        inputs: {},
        allowances: {},
      },
    },
  };
}
function wall() {
  return fixture(
    'path',
    [
      { x: 0, y: 0 },
      { x: 24, y: 0 },
    ],
    'wall-area',
  );
}
function near(actual: number | undefined, expected: number) {
  assert.ok(
    actual !== undefined && Math.abs(actual - expected) < 1e-8,
    `${String(actual)} != ${String(expected)}`,
  );
}

void test('24ft wall times 8ft height and two layers yields 384 square feet', () => {
  const project = wall();
  const assignment = project.assignments.assignment;
  assert.ok(assignment);
  assignment.inputs = { height: 8, layers: 2 };
  const result = calculateProject(project);
  near(result.outputs[0]?.baseAmount, 384);
  assert.equal(result.complete, true);
  assert.deepEqual(result.outputs[0]?.sources[0]?.inputs, {
    height: 8,
    layers: 2,
  });
});
void test('rectangle and marker examples retain their physical units', () => {
  const area = fixture(
    'area',
    [
      { x: 0, y: 0 },
      { x: 24, y: 0 },
      { x: 24, y: 15 },
      { x: 0, y: 15 },
    ],
    'floor-area',
  );
  near(calculateProject(area).outputs[0]?.baseAmount, 360);
  const counts = fixture(
    'count',
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
    'count',
  );
  const sheet = counts.sheets.sheet;
  assert.ok(sheet);
  delete sheet.calibration;
  near(calculateProject(counts).outputs[0]?.baseAmount, 3);
});
void test('aggregate first, then add waste and round packages', () => {
  const project = fixture(
    'area',
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 0, y: 5 },
    ],
    'floor-area',
  );
  const drawing = project.geometries.drawing;
  const group = project.groups.group;
  const assignment = project.assignments.assignment;
  assert.ok(drawing && group && assignment);
  project.geometries.second = { ...structuredClone(drawing), id: 'second' };
  group.geometryIds.push('second');
  assignment.allowances['floor-area'] = { wastePercent: 10, packageSize: 32 };
  const output = calculateProject(project).outputs[0];
  near(output?.baseAmount, 100);
  near(output?.adjustedAmount, 110);
  near(output?.packageCount ?? undefined, 4);
  near(output?.purchasedAmount, 128);
});
void test('shared membership in separate groups intentionally contributes twice', () => {
  const project = wall();
  const assignment = project.assignments.assignment;
  assert.ok(assignment);
  project.groups.second = {
    id: 'second',
    name: 'Second finish',
    geometryIds: ['drawing'],
  };
  project.assignments.second = {
    ...structuredClone(assignment),
    id: 'second',
    groupId: 'second',
  };
  near(calculateProject(project).totals[0]?.amount, 384);
});
void test('unavailable measurement and invalid dimensions keep totals incomplete', () => {
  const project = wall();
  const sheet = project.sheets.sheet;
  const recipe = project.recipes['wall-area'];
  assert.ok(sheet && recipe);
  delete sheet.calibration;
  const result = calculateProject(project);
  assert.equal(result.complete, false);
  assert.equal(result.totals[0]?.complete, false);
  assert.equal(result.outputs[0]?.sources[0]?.value, null);
  sheet.calibration = { metresPerUnit: 0.3048 };
  const output = recipe.outputs[0];
  assert.ok(output);
  output.formula = 'length + height';
  assert.match(
    calculateProject(project).outputs[0]?.sources[0]?.diagnostic ?? '',
    /dimension/,
  );
  output.formula = 'length / 0';
  assert.equal(calculateProject(project).complete, false);
});
void test('recipe edits and multiple outputs preserve output and material identities', () => {
  const project = wall();
  const recipe = project.recipes['wall-area'];
  const output = recipe?.outputs[0];
  assert.ok(recipe && output);
  output.formula = 'length * height * 2';
  recipe.outputs.push({ ...output, id: 'second', materialId: 'other' });
  const result = calculateProject(project);
  near(result.outputs[0]?.baseAmount, 384);
  assert.equal(result.totals.length, 2);
  assert.equal(result.outputs[1]?.materialId, 'other');
  const json: unknown = JSON.parse(exportQuantities(project, 'json'));
  assert.deepEqual(json, result);
  assert.match(exportQuantities(project, 'csv'), /"outputId"/);
});
void test('constrained formulas support arithmetic, conditions, rounding and unit checks', () => {
  const variables = {
    length: formulaQuantity({ value: 24, unit: 'ft' }),
    spacing: formulaQuantity({ value: 16, unit: 'in' }),
    enabled: true,
  };
  near(
    formulaOutput(
      evaluateFormula('if(enabled, ceil(length / spacing) + 1, 0)', variables),
      'ea',
    ),
    19,
  );
  near(
    formulaOutput(evaluateFormula('max(2, min(4, round(3.2)))', {}), 'scalar'),
    3,
  );
  assert.throws(() => evaluateFormula('length + 1', variables), /dimensions/);
  assert.throws(
    () => evaluateFormula('globalThis.process.exit()', {}),
    /Invalid/,
  );
  assert.throws(() => evaluateFormula('missing', {}), /Unavailable/);
  assert.throws(
    () =>
      formulaOutput(evaluateFormula('if(enabled, length, 0)', variables), 'ea'),
    /dimension/,
  );
});

void test('conditional and boolean guards skip inactive expressions', () => {
  near(formulaOutput(evaluateFormula('if(false, 1 / 0, 1)', {}), 'scalar'), 1);
  near(
    formulaOutput(
      evaluateFormula('if(true, count, length)', {
        count: formulaQuantity({ value: 3, unit: 'ea' }),
      }),
      'ea',
    ),
    3,
  );
  assert.equal(evaluateFormula('false && missing', {}), false);
  assert.equal(evaluateFormula('true || (1 / 0 > 0)', {}), true);
  assert.throws(() => evaluateFormula('true && 1', {}), /boolean/);
  assert.throws(() => evaluateFormula('if(true, 1 / 0, 1)', {}), /nonfinite/);
});

void test('a tiny positive quantity still requires one package', () => {
  const project = wall();
  const assignment = project.assignments.assignment;
  assert.ok(assignment);
  assignment.allowances['wall-area'] = { wastePercent: 0, packageSize: 1e20 };
  const result = calculateProject(project).outputs[0];
  assert.equal(result?.packageCount, 1);
  assert.equal(result.purchasedAmount, 1e20);
});
