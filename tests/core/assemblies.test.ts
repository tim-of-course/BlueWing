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
  exportQuantities,
} from '../../src/core/calculations';
import { copyAssembly, starterAssemblies } from '../../src/core/assemblies';
import { registry } from '../../src/app/registry';
import { estiMakerTakeoff } from '../../src/core/quantity-presentation';
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
    calibration: { feetPerUnit: 1 },
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

void test('count markers have exact default purchases in projects and the shipped catalog', () => {
  const project = fixture('count', 'count');
  project.recipes = { ...project.recipes, ...createProject('New').recipes };
  assignment(project).inputs = {};
  near(calculateProject(project).outputs[0]?.purchasedAmount, 3);
  for (const recipe of Object.values(project.recipes)) {
    if (recipe.geometryKinds.includes('count'))
      for (const output of recipe.outputs)
        assert.equal(output.allowance.wastePercent, 0, recipe.id);
  }
});

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
void test('starters distinguish modeled material layouts from unmodeled quick estimates', () => {
  const starters = starterAssemblies();
  for (const id of ['ceiling-grid-2x2', 'ceiling-grid-2x4']) {
    const ceiling = starters[id];
    assert.ok(ceiling?.ceilingTemplate?.grid);
    assert.deepEqual(
      ceiling.outputs.map((row) => row.id),
      ['hanger-wire'],
    );
    assert.deepEqual(
      ceiling.inputs.map((input) => input.default),
      [6, 1.5, 16, 12],
    );
    near(ceiling.ceilingTemplate.elevation, 9);
    assert.match(ceiling.description ?? '', /Starter elevation is 9 ft/);
  }
  const wall = starters['steel-wall'];
  assert.ok(wall?.wallTemplate);
  assert.equal(wall.wallTemplate.height, undefined);
  assert.equal(wall.wallTemplate.finishes?.length, 2);
  for (const recipe of Object.values(starters)) {
    if (
      recipe.wallTemplate ||
      recipe.ceilingTemplate ||
      recipe.materialTemplate
    )
      continue;
    if (recipe.id === 'danback-backing')
      assert.equal(recipe.name, 'Danback backing');
    else assert.match(recipe.name, /estimate/i);
    assert.match(recipe.description ?? '', /Unmodeled/);
  }
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
  near(rows[0]?.cutLength_ft, 10 - 0.5 / 12);
  near(rows[1]?.cutLength_ft, 11 - 0.5 / 12);
  near(rows[0]?.stockLength_ft, 12);
  assert.equal(rows[1]?.location, 'Wall B');
  assert.match(exportPieces(project, 'csv'), /Wall B/);
  assert.deepEqual(
    (JSON.parse(exportPieces(project, 'json')) as { rows: unknown }).rows,
    rows,
  );
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
  near(rows[0]?.cutLength_ft, 4.5); // 4 ft + 2 * 3 in = 4.5 ft.
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
void test('Danback orders whole stud-bay pieces and exports their purchased footage', () => {
  const project = fixture('danback-backing');
  const a = project.geometries.a;
  const group = project.groups.g;
  assert.ok(a && group);
  a.points = [
    { x: 0, y: 0 },
    { x: 9 + 4 / 12, y: 0 },
  ];
  project.geometries.b = {
    ...a,
    id: 'b',
    points: [
      { x: 0, y: 0 },
      { x: 3 + 1 / 12, y: 0 },
    ],
  };
  group.geometryIds.push('b');
  const row = calculateProject(project).outputs[0];
  assert.ok(row?.complete);
  near(row.sources[0]?.value, 7);
  near(row.sources[1]?.value, 3);
  near(row.purchasedAmount, 11);
  assert.equal(row.stockLength, undefined);
  const exported = estiMakerTakeoff(project, calculateProject(project)).rows[0];
  assert.equal(exported?.unit, 'LF');
  assert.equal(exported.pieceCount, 11);
  near(exported.pieceLength?.value, 16 / 12);
  near(exported.quantity, 14 + 8 / 12);
  assignment(project).inputs.studSpacing = 24;
  near(calculateProject(project).outputs[0]?.baseAmount, 7);
  near(calculateProject(project).outputs[0]?.purchasedAmount, 8);
});

void test('the tile-only ceiling starter adds no hanger wire', () => {
  const result = calculateProject(fixture('acoustical-ceiling-tile', 'area'));
  assert.equal(
    result.outputs.some((output) => output.outputId === 'hanger-wire'),
    false,
  );
});

void test('every acoustical ceiling with grid buys whole hanger wires per traced room', () => {
  for (const id of [
    'ceiling-finish',
    'ceiling-grid-2x2',
    'ceiling-grid-2x4',
    'ceiling-grid-2x2-estimate',
    'ceiling-grid-2x4-estimate',
  ]) {
    const project = fixture(id, 'area');
    const room = project.geometries.a;
    const group = project.groups.g;
    assert.ok(room && group);
    const rectangle = (width: number) => [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: 20 },
      { x: 0, y: 20 },
    ];
    room.points = rectangle(32);
    near(ceilingAmounts(project)['hanger-wire'], 40);
    assignment(project).inputs.wireDrop = 3;
    near(ceilingAmounts(project)['hanger-wire'], 20);
    // 41 drops per room require 21 wires apiece.
    room.points = rectangle(32.5);
    project.geometries.b = { ...room, id: 'b' };
    group.geometryIds.push('b');
    near(ceilingAmounts(project)['hanger-wire'], 42);
    assignment(project).inputs.wireDrop = 14;
    near(ceilingAmounts(project)['hanger-wire'], 82);
  }
});

function ceilingAmounts(project: Project, purchased = true) {
  const result = calculateProject(project);
  assert.equal(result.complete, true, JSON.stringify(result.outputs));
  return Object.fromEntries(
    result.outputs.map((row) => [
      row.outputId,
      purchased ? row.purchasedAmount : row.baseAmount,
    ]),
  );
}
void test('2x2 and 2x4 formula estimates separate tees, main stock and wall angle stock', () => {
  // 24 x 15 ft = 360 SF, perimeter 78 LF. Standard factors:
  // each tee: 1 per 8 SF; mains: 1 LF per 4 SF; 12 ft stock.
  const square = fixture('ceiling-grid-2x2-estimate', 'area');
  assert.deepEqual(ceilingAmounts(square), {
    'ceiling-area': 360,
    'hanger-wire': 23,
    'tee-2ft': 45,
    'tee-4ft': 45,
    mains: 8,
    'wall-angle': 7,
  });
  near(ceilingAmounts(square, false).mains, 7.5);
  near(ceilingAmounts(square, false)['wall-angle'], 6.5);
  const rectangular = fixture('ceiling-grid-2x4-estimate', 'area');
  assert.deepEqual(ceilingAmounts(rectangular), {
    'ceiling-area': 360,
    'hanger-wire': 23,
    'tee-2ft': 0,
    'tee-4ft': 45,
    mains: 8,
    'wall-angle': 7,
  });
  assignment(rectangular).inputs.extraTwoFootTees = 6;
  near(ceilingAmounts(rectangular)['tee-2ft'], 6);
  // Stock estimates must not masquerade as placed-piece cut schedules.
  assert.deepEqual(pieceSchedule(square), []);
  const csv = exportQuantities(square, 'csv');
  for (const name of [
    '2 ft cross tees',
    '4 ft cross tees',
    'Main runner stock lengths',
    'Wall angle stock lengths',
  ])
    assert.ok(csv.includes(name));
});
void test('ceiling tile deductions leave grid intact; grid and perimeter adjustments are explicit', () => {
  const project = fixture('ceiling-grid-2x2-estimate', 'area');
  assignment(project).inputs = { tileDeduction: 40 };
  assert.deepEqual(ceilingAmounts(project), {
    'ceiling-area': 320,
    'hanger-wire': 23,
    'tee-2ft': 45,
    'tee-4ft': 45,
    mains: 8,
    'wall-angle': 7,
  });
  assignment(project).inputs = {
    tileDeduction: 40,
    gridDeduction: 40,
    extraWallAngle: 18,
    wallAngleDeduction: 6,
    wallAngleStockLength: 10,
  };
  assert.deepEqual(ceilingAmounts(project), {
    'ceiling-area': 320,
    'hanger-wire': 23,
    'tee-2ft': 40,
    'tee-4ft': 40,
    mains: 7,
    'wall-angle': 9,
  });
  // The stock length forms part of the product identity supplied by the estimator.
  const angle = assembly(project).outputs.find(
    (row) => row.id === 'wall-angle',
  );
  assert.ok(angle);
  angle.materialId = 'wall-angle-10ft';
  assert.ok(
    calculateProject(project).totals.some(
      (row) => row.materialId === 'wall-angle-10ft' && row.amount === 9,
    ),
  );
});
void test('ceiling stock and carton rounding follows aggregate quantities and independent waste', () => {
  const project = fixture('ceiling-grid-2x2-estimate', 'area');
  const a = project.geometries.a;
  assert.ok(a);
  project.geometries.b = { ...structuredClone(a), id: 'b', name: 'Room B' };
  const group = project.groups.g;
  assert.ok(group);
  group.geometryIds.push('b');
  // Round 7.5 + 7.5 main lengths together, rather than eight for each room.
  near(ceilingAmounts(project).mains, 15);
  near(ceilingAmounts(project)['wall-angle'], 13);
  assignment(project).geometryInputs = {
    b: { tileDeduction: 40, gridDeduction: 40 },
  };
  assignment(project).allowances = {
    'tee-2ft': { wastePercent: 10, packageSize: 60 },
    'tee-4ft': { wastePercent: 5, packageSize: 60 },
    mains: { wastePercent: 10, packageSize: 1 },
    'wall-angle': { wastePercent: 10, packageSize: 1 },
  };
  assert.deepEqual(ceilingAmounts(project), {
    'ceiling-area': 680,
    'hanger-wire': 46,
    'tee-2ft': 120,
    'tee-4ft': 120,
    mains: 16,
    'wall-angle': 15,
  });
  near(ceilingAmounts(project, false)['tee-2ft'], 85);
});
void test('ceiling estimates handle inch calibration, irregular perimeters, zero grid and invalid deductions', () => {
  const project = fixture('ceiling-grid-2x2-estimate', 'area');
  const sheet = project.sheets.s;
  const room = project.geometries.a;
  assert.ok(sheet && room);
  // Same physical room, with one drawing unit per inch.
  sheet.calibration = { feetPerUnit: 1 / 12 };
  room.points = [
    { x: 0, y: 0 },
    { x: 288, y: 0 },
    { x: 288, y: 180 },
    { x: 0, y: 180 },
  ];
  near(ceilingAmounts(project)['tee-4ft'], 45);
  near(ceilingAmounts(project).mains, 8);
  sheet.calibration = { feetPerUnit: 1 };
  // L-shaped area: 24*15 - 12*5 = 300 SF; perimeter still 78 LF.
  room.points = [
    { x: 0, y: 0 },
    { x: 24, y: 0 },
    { x: 24, y: 10 },
    { x: 12, y: 10 },
    { x: 12, y: 15 },
    { x: 0, y: 15 },
  ];
  assert.deepEqual(ceilingAmounts(project), {
    'ceiling-area': 300,
    'hanger-wire': 19,
    'tee-2ft': 38,
    'tee-4ft': 38,
    mains: 7,
    'wall-angle': 7,
  });
  assignment(project).inputs = {
    tileDeduction: 300,
    gridDeduction: 300,
    wallAngleDeduction: 78,
  };
  assert.deepEqual(ceilingAmounts(project), {
    'ceiling-area': 0,
    'tee-2ft': 0,
    'tee-4ft': 0,
    mains: 0,
    'wall-angle': 0,
    'hanger-wire': 19,
  });
  for (const inputs of [
    { tileDeduction: 301 },
    { gridDeduction: 301 },
    { wallAngleDeduction: 79 },
    { mainSpacing: 0 },
    { mainStockLength: 0 },
    { wallAngleStockLength: 0 },
  ]) {
    assignment(project).inputs = inputs;
    assert.equal(
      calculateProject(project).complete,
      false,
      JSON.stringify(inputs),
    );
  }
});
void test('inch inputs and foot inputs produce matching piece lengths', () => {
  const project = fixture('steel-straight-run');
  const height = assembly(project).inputs.find(
    (input) => input.name === 'height',
  );
  assert.ok(height);
  height.unit = 'in';
  assignment(project).inputs = { height: 120, stockLength: 10, spacing: 16 };
  near(pieceSchedule(project)[0]?.cutLength_ft, 10);
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
