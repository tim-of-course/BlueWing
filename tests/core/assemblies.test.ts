import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createProject,
  executeCommand,
  ProjectSession,
  validateAssembly,
  validateProject,
  validatePayload,
} from '../../src/core';
import {
  calculateProject,
  pieceSchedule,
  exportPieces,
} from '../../src/core/calculations';
import { copyAssembly, starterAssemblies } from '../../src/core/assemblies';
import { registry } from '../../src/app/registry';
import type { Assembly, Project } from '../../src/core/types';

function fixture(
  id = 'drywall-face',
  kind: 'path' | 'area' | 'count' = 'path',
): Project {
  const project = createProject('Assembly examples');
  project.sheets.s = {
    id: 's',
    name: 'A1',
    assetId: 'pdf',
    pageIndex: 0,
    width: 100,
    height: 100,
    calibration: { metresPerUnit: 0.3048 },
  };
  project.geometries.a = {
    id: 'a',
    name: 'Wall A',
    sheetId: 's',
    kind,
    points:
      kind === 'area'
        ? [
            { x: 0, y: 0 },
            { x: 24, y: 0 },
            { x: 24, y: 15 },
            { x: 0, y: 15 },
          ]
        : kind === 'count'
          ? [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 2, y: 0 },
            ]
          : [
              { x: 0, y: 0 },
              { x: 24, y: 0 },
            ],
  };
  project.groups.g = { id: 'g', name: 'Work', geometryIds: ['a'] };
  project.recipes = starterAssemblies();
  project.assignments.x = {
    id: 'x',
    groupId: 'g',
    recipeId: id,
    inputs: {},
    allowances: {},
  };
  return project;
}
function assignment(project: Project) {
  const value = project.assignments.x;
  assert.ok(value);
  return value;
}
function assembly(
  project: Project,
  id = assignment(project).recipeId,
): Assembly {
  const value = project.recipes[id];
  assert.ok(value);
  return value;
}
function near(actual: number | undefined | null, expected: number) {
  assert.ok(
    actual !== null &&
      actual !== undefined &&
      Math.abs(actual - expected) < 1e-8,
    `${String(actual)} != ${String(expected)}`,
  );
}

void test('assembly templates and all public command examples validate', () => {
  for (const value of Object.values(starterAssemblies()))
    validateAssembly(value);
  assert.equal(
    registry.find((command) => command.name === 'library.put')?.mutates,
    true,
  );
  assert.equal(
    registry.find((command) => command.name === 'library.delete')?.mutates,
    true,
  );
  for (const command of registry)
    for (const example of command.examples)
      validatePayload(command.schema, example.payload);
});
void test('drywall deductions apply per face before layers; required dimensions stay incomplete', () => {
  const project = fixture();
  assert.equal(calculateProject(project).complete, false);
  assert.match(
    calculateProject(project).outputs[0]?.diagnostics.join() ?? '',
    /Required input: height/,
  );
  assignment(project).inputs = { height: 10, layers: 2, deduction: 21 };
  near(calculateProject(project).outputs[0]?.baseAmount, 438);
  assignment(project).inputs.deduction = 241;
  assert.equal(calculateProject(project).complete, false);
});
void test('assembly defaults, group values and per-object values have explicit precedence', () => {
  const project = fixture();
  const a = project.geometries.a;
  assert.ok(a);
  project.geometries.b = { ...structuredClone(a), id: 'b', name: 'Wall B' };
  const group = project.groups.g;
  assert.ok(group);
  group.geometryIds.push('b');
  assignment(project).inputs = { height: 8 };
  assignment(project).geometryInputs = { b: { height: 10, layers: 2 } };
  const result = calculateProject(project);
  near(result.totals[0]?.amount, 672);
  assert.deepEqual(
    result.outputs[0]?.sources.map((s) => s.inputs.height),
    [8, 10],
  );
  const layers = assembly(project).inputs.find(
    (input) => input.name === 'layers',
  );
  assert.ok(layers);
  layers.default = 3;
  near(calculateProject(project).totals[0]?.amount, 1056);
  delete assignment(project).geometryInputs?.b;
  near(calculateProject(project).totals[0]?.amount, 1152);
});
void test('different materials and units stay separate; same material combines across assemblies', () => {
  const project = fixture();
  assignment(project).inputs = { height: 8 };
  const other = structuredClone(assembly(project));
  other.id = 'other';
  const out = other.outputs[0];
  assert.ok(out);
  out.id = 'different-output-name';
  project.recipes.other = other;
  project.assignments.y = {
    ...structuredClone(assignment(project)),
    id: 'y',
    recipeId: 'other',
  };
  near(calculateProject(project).totals[0]?.amount, 384);
  assert.equal(calculateProject(project).totals.length, 1);
  out.materialId = 'different-board';
  assert.equal(calculateProject(project).totals.length, 2);
});
void test('straight framing schedules preserve exact cut lengths, locations and purchasing waste', () => {
  const project = fixture('steel-straight-run');
  assignment(project).inputs = {
    height: 10,
    endAllowance: 0.5,
    stockLength: 12,
  };
  const a = project.geometries.a;
  assert.ok(a);
  project.geometries.b = { ...structuredClone(a), id: 'b', name: 'Wall B' };
  const group = project.groups.g;
  assert.ok(group);
  group.geometryIds.push('b');
  assignment(project).geometryInputs = { b: { height: 11 } };
  assignment(project).allowances.studs = { wastePercent: 10 };
  const result = calculateProject(project);
  assert.equal(result.outputs.length, 1);
  assert.equal(result.totals.length, 1); // Same stock length, different cuts.
  near(result.totals[0]?.amount, 42); // 38 required plus 10% waste -> 42 ordered.
  const rows = pieceSchedule(project);
  assert.deepEqual(
    rows.map((r) => r.quantity),
    [19, 19],
  );
  near(rows[0]?.cutLength_m, 3.048 - 0.0127);
  near(rows[1]?.cutLength_m, 3.3528 - 0.0127);
  near(rows[0]?.stockLength_m, 3.6576);
  assert.equal(rows[1]?.location, 'Wall B');
  assert.match(exportPieces(project, 'csv'), /Wall B/);
  assert.deepEqual(JSON.parse(exportPieces(project, 'json')), rows);
  assignment(project).allowances.studs = { wastePercent: 10, packageSize: 20 };
  near(calculateProject(project).totals[0]?.amount, 60); // Three bundles, not four split by cut length.
  assert.equal(
    pieceSchedule(project).reduce((sum, row) => sum + (row.quantity ?? 0), 0),
    38,
  );
  assignment(project).geometryInputs = { b: { height: 11, stockLength: 14 } };
  assert.equal(calculateProject(project).totals.length, 2);
  assert.deepEqual(
    calculateProject(project).outputs.map((output) => output.packageCount),
    [2, 2],
  );
});
void test('piece failures include short stock, negative cuts, fractional quantities and bad units', () => {
  const project = fixture('steel-straight-run');
  assignment(project).inputs = { height: 10, stockLength: 8 };
  assert.match(
    calculateProject(project).outputs[0]?.diagnostics.join() ?? '',
    /shorter/,
  );
  assignment(project).inputs = {
    height: 10,
    stockLength: 12,
    endAllowance: 121,
  };
  assert.match(
    calculateProject(project).outputs[0]?.diagnostics.join() ?? '',
    /positive/,
  );
  assignment(project).inputs = { height: 10, stockLength: 12, extraStuds: 0.5 };
  assert.match(
    calculateProject(project).outputs[0]?.diagnostics.join() ?? '',
    /whole number/,
  );
  const piece = assembly(project).outputs[0]?.piece;
  assert.ok(piece);
  assignment(project).inputs.extraStuds = 0;
  piece.cutLength.formula = 'length * height';
  assert.match(
    calculateProject(project).outputs[0]?.diagnostics.join() ?? '',
    /dimension/,
  );
});
void test('header components use entered detail dimensions and multiple outputs without inferred engineering', () => {
  const project = fixture('header-components', 'count');
  assignment(project).inputs = {
    openingWidth: 4,
    endExtension: 3,
    piecesPerOpening: 2,
    stockLength: 6,
  };
  const first = assembly(project).outputs[0];
  assert.ok(first);
  assembly(project).outputs.push({
    ...structuredClone(first),
    id: 'closure',
    name: 'Closure',
    materialId: 'closure-track',
    formula: 'count',
  });
  const rows = pieceSchedule(project);
  assert.deepEqual(
    rows.map((row) => row.quantity),
    [6, 3],
  );
  near(rows[0]?.cutLength_m, 1.3716); // 4 ft + 2 * 3 in = 4.5 ft.
  assert.equal(calculateProject(project).totals.length, 2);
});
void test('FRP, acoustical ceilings, blocking and acoustical panels have independent known quantities', () => {
  const frp = fixture('frp-face');
  assignment(frp).inputs = { height: 4, deduction: 12 };
  near(calculateProject(frp).totals[0]?.amount, 84);
  const ceiling = fixture('ceiling-finish', 'area');
  assignment(ceiling).inputs = { deduction: 20 };
  near(calculateProject(ceiling).outputs[0]?.baseAmount, 340);
  near(calculateProject(ceiling).outputs[1]?.baseAmount, 78);
  const blocking = fixture('blocking-runs');
  assignment(blocking).inputs = { rows: 2 };
  near(calculateProject(blocking).totals[0]?.amount, 48);
  const panels = fixture('acoustical-panels', 'count');
  assignment(panels).inputs = { width: 2, height: 4 };
  near(calculateProject(panels).outputs[0]?.baseAmount, 3);
  near(calculateProject(panels).outputs[1]?.baseAmount, 24);
});
void test('metric inputs and imperial inputs produce matching piece lengths', () => {
  const project = fixture('steel-straight-run');
  const height = assembly(project).inputs.find(
    (input) => input.name === 'height',
  );
  assert.ok(height);
  height.unit = 'mm';
  assignment(project).inputs = { height: 3048, stockLength: 10, spacing: 16 };
  near(pieceSchedule(project)[0]?.cutLength_m, 3.048);
  assert.equal(calculateProject(project).complete, true);
});
void test('object input validation rejects nonmembers, wrong types and values below declared minimums', () => {
  const project = fixture();
  assignment(project).geometryInputs = { missing: { height: 8 } };
  assert.throws(() => {
    validateProject(project);
  }, /belong/);
  assignment(project).geometryInputs = { a: { height: true } };
  assert.throws(() => {
    validateProject(project);
  }, /Invalid assignment input/);
  assignment(project).geometryInputs = { a: { height: -1 } };
  assert.throws(() => {
    validateProject(project);
  }, /Invalid assignment input/);
});
void test('copied definitions are independent of the library and other projects', () => {
  const global = starterAssemblies()['drywall-face'];
  assert.ok(global);
  const a = copyAssembly(global, 'a');
  const b = copyAssembly(global, 'b');
  const input = global.inputs[1];
  assert.ok(input);
  input.default = 4;
  assert.equal(a.inputs[1]?.default, 1);
  assert.equal(b.inputs[1]?.default, 1);
  const local = a.outputs[0];
  assert.ok(local);
  local.materialId = 'project-specific';
  assert.notEqual(b.outputs[0]?.materialId, local.materialId);
  assert.deepEqual(a.librarySource, { id: global.id, name: global.name });
});
void test('membership deletion prunes overrides and Undo restores them; group copies retain them', async () => {
  const project = fixture();
  assignment(project).geometryInputs = { a: { height: 10 } };
  const copied = executeCommand(project, {
    name: 'group.copy',
    payload: { id: 'g', newId: 'second' },
  }).project;
  assert.equal(
    Object.values(copied.assignments).find((a) => a.groupId === 'second')
      ?.geometryInputs?.a?.height,
    10,
  );
  const session = new ProjectSession(project, {
    save: () => Promise.resolve(),
  });
  await session.dispatch({
    name: 'geometry.delete',
    payload: { id: 'a' },
    projectId: project.id,
    expectedRevision: 0,
  });
  assert.deepEqual(session.project.assignments.x?.geometryInputs, {});
  await session.dispatch({
    name: 'history.undo',
    projectId: project.id,
    expectedRevision: 1,
  });
  assert.equal(assignment(session.project).geometryInputs?.a?.height, 10);
});
void test('assembly edits support preview, atomic rollback and undo without losing object overrides', async () => {
  const project = fixture();
  assignment(project).inputs.height = 8;
  assignment(project).geometryInputs = { a: { layers: 2 } };
  const session = new ProjectSession(project, {
    save: () => Promise.resolve(),
  });
  const changed = structuredClone(assembly(project));
  const layers = changed.inputs[1];
  assert.ok(layers);
  layers.default = 3;
  const commands = [{ name: 'assembly.put', payload: changed }];
  await session.dispatch({
    name: 'preview',
    payload: { commands },
    projectId: project.id,
    expectedRevision: 0,
  });
  assert.equal(session.project.recipes[changed.id]?.inputs[1]?.default, 1);
  await session.dispatch({
    name: 'batch',
    payload: { commands },
    projectId: project.id,
    expectedRevision: 0,
  });
  near(calculateProject(session.project).totals[0]?.amount, 384);
  await session.dispatch({
    name: 'history.undo',
    projectId: project.id,
    expectedRevision: 1,
  });
  assert.equal(session.project.recipes[changed.id]?.inputs[1]?.default, 1);
  const invalid = structuredClone(changed);
  invalid.inputs = [];
  await assert.rejects(
    session.dispatch({
      name: 'batch',
      payload: {
        commands: [
          { name: 'project.rename', payload: { name: 'Should roll back' } },
          { name: 'assembly.put', payload: invalid },
        ],
      },
      projectId: project.id,
      expectedRevision: 2,
    }),
  );
  assert.equal(session.project.name, project.name);
});
