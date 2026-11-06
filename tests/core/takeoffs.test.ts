import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import { ProjectSession } from '../../src/core/session';
import {
  calculateProject,
  exportQuantities,
} from '../../src/core/calculations';
import { takeoffProject, required } from '../../src/core/takeoffs';
import { resolveConstruction } from '../../src/core/applied-assemblies';
import { estiMakerTakeoff } from '../../src/core/quantity-presentation';
import { executeCommand } from '../../src/core/commands';
import { importFixture } from '../fixtures/quantity-project';
import type { CommandCall } from '../../src/core/types';

function fixture() {
  const project = createProject('Job');
  project.sheets.s = {
    id: 's',
    name: 'Plan',
    assetId: 'pdf',
    pageIndex: 0,
    width: 100,
    height: 100,
    calibration: { metresPerUnit: 1 },
  };
  project.geometries.g = {
    id: 'g',
    name: 'Wall',
    sheetId: 's',
    kind: 'path',
    points: [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ],
  };
  project.groups.group = { id: 'group', name: 'Walls', geometryIds: ['g'] };
  project.recipes.r = {
    id: 'r',
    name: 'Length',
    geometryKinds: ['path'],
    inputs: [],
    outputs: [
      {
        id: 'o',
        name: 'Length',
        materialId: 'steel',
        unit: 'm',
        formula: 'length',
        allowance: { wastePercent: 10, packageSize: 2 },
      },
    ],
  };
  project.assignments.a = {
    id: 'a',
    groupId: 'group',
    recipeId: 'r',
    inputs: {},
    allowances: {},
  };
  let fail = false;
  const session = new ProjectSession(project, {
    save: () =>
      fail ? Promise.reject(new Error('disk full')) : Promise.resolve(),
  });
  const call = (command: CommandCall) =>
    session.dispatch({ ...command, ...session.observation });
  const report = (id: string) =>
    calculateProject(takeoffProject(session.project, id));
  const create = (id = 'co', kind = 'change-order') =>
    call({ name: 'takeoff.create', payload: { id, name: id, kind } });
  const copy = (direction = 'deduct', geometryIds = ['g']) =>
    call({
      name: 'takeoff.copyItems',
      takeoffId: 'co',
      payload: { sourceTakeoffId: 'main', geometryIds, direction },
    });
  return {
    session,
    call,
    report,
    create,
    copy,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}
void test('signed takeoff projection preserves intentional counts and missing-dimension zero rows', () => {
  let project = importFixture();
  project = executeCommand(project, {
    name: 'takeoff.create',
    payload: { id: 'co', name: 'CO count', kind: 'change-order' },
  }).project;
  project = executeCommand(project, {
    name: 'takeoff.copyItems',
    takeoffId: 'co',
    payload: {
      sourceTakeoffId: 'main',
      geometryIds: Object.keys(project.geometries),
      direction: 'deduct',
    },
  }).project;
  const view = takeoffProject(project, 'co');
  const result = estiMakerTakeoff(view, calculateProject(view));
  const count = required(result.rows.find((row) => row.unit === 'count'));
  assert.equal(count.quantity, -75);
  assert.equal(count.grossQuantity, 75);
  assert.equal(count.direction, 'deduct');
  const missing = required(
    result.rows.find((row) => row.description.includes('(missing quantity)')),
  );
  assert.equal(missing.quantity, 0);
  assert.equal(missing.grossQuantity, 0);
  assert.equal(missing.provenance.originalAmount, null);
  assert.equal(missing.direction, 'deduct');
  assert.equal(result.calculationComplete, false);
  assert.ok(!('skipped' in result));
  assert.equal(
    estiMakerTakeoff(project, calculateProject(project)).rows.find(
      (row) => row.unit === 'count',
    )?.quantity,
    75,
  );
});

void test('takeoffs start empty; independent copies round positive purchases before sign and preserve gross zero-net detail', async () => {
  const f = fixture();
  await f.create();
  assert.equal(f.report('co').outputs.length, 0);
  const main = takeoffProject(f.session.project, 'main');
  await f.copy();
  await f.copy('add');
  const result = f.report('co');
  assert.equal(result.outputs.length, 2);
  assert.deepEqual(
    result.outputs.map((o) => [
      o.baseAmount,
      o.packageCount,
      o.purchasedAmount,
      o.direction,
    ]),
    [
      [3, 2, 4, 'deduct'],
      [3, 2, 4, 'add'],
    ],
  );
  assert.deepEqual(
    result.totals.map((t) => [t.amount, t.additions, t.deductions]),
    [[0, 4, 4]],
  );
  assert.equal(result.context?.takeoffId, 'co');
  const purchase = estiMakerTakeoff(
    takeoffProject(f.session.project, 'co'),
    result,
  );
  assert.equal(purchase.takeoff.id, 'co');
  assert.equal(purchase.rows.length, 2);
  assert.equal(purchase.rows[0]?.direction, 'deduct');
  assert.equal(purchase.rows[0].quantity, -4 / 0.3048);
  assert.equal(purchase.rows[0].grossQuantity, 4 / 0.3048);
  const target = takeoffProject(f.session.project, 'co');
  assert.match(exportQuantities(target, 'csv'), /"co","co","deduct"/);
  const g = required(Object.values(target.geometries)[0]);
  await f.call({
    name: 'geometry.move',
    takeoffId: 'co',
    payload: { ids: [g.id], dx: 10, dy: 4 },
  });
  const r = required(Object.values(target.recipes)[0]);
  await f.call({
    name: 'recipe.put',
    takeoffId: 'co',
    payload: {
      ...r,
      name: 'Edited',
      outputs: r.outputs.map((o) => ({ ...o, formula: 'length * 2' })),
    },
  });
  await f.call({
    name: 'sheet.calibrate',
    takeoffId: 'co',
    payload: {
      id: 's',
      start: { x: 0, y: 0 },
      end: { x: 1, y: 0 },
      distance: { value: 2, unit: 'm' },
    },
  });
  const after = takeoffProject(f.session.project, 'main');
  assert.deepEqual(after.geometries, main.geometries);
  assert.deepEqual(after.recipes, main.recipes);
  assert.deepEqual(after.sheets, main.sheets);
  assert.equal(f.report('main').totals[0]?.amount, 4);
  await assert.rejects(f.copy(), /Conflicting/);
});

void test('returning local calibration to Main scale invalidates quantities and undo restores the local result', async () => {
  const f = fixture();
  await f.create();
  await f.copy();
  const sheet = required(f.session.project.sheets.s);
  const putScale = (metresPerUnit: number) =>
    f.call({
      name: 'sheet.put',
      takeoffId: 'co',
      payload: { ...sheet, calibration: { metresPerUnit } },
    });
  await putScale(2);
  assert.equal(f.session.calculationFor('co').totals[0]?.amount, -8);
  await putScale(1);
  assert.equal(f.session.calculationFor('co').totals[0]?.amount, -4);
  await f.call({ name: 'history.undo' });
  assert.equal(f.session.calculationFor('co').totals[0]?.amount, -8);
  await f.call({ name: 'history.redo' });
  assert.equal(f.session.calculationFor('co').totals[0]?.amount, -4);
  assert.equal(f.session.calculationFor('main').totals[0]?.amount, 4);
});

void test('ownership rejects cross-takeoff writes/references and phases reject deductions', async () => {
  const f = fixture();
  await f.create();
  await f.create('phase', 'phase');
  for (const command of [
    { name: 'geometry.move', payload: { ids: ['g'], dx: 1, dy: 0 } },
    { name: 'geometry.put', payload: f.session.project.geometries.g },
    {
      name: 'group.put',
      payload: { id: 'foreign', name: 'Foreign', geometryIds: ['g'] },
    },
    {
      name: 'assignment.put',
      payload: {
        id: 'bad',
        groupId: 'group',
        recipeId: 'r',
        inputs: {},
        allowances: {},
      },
    },
  ])
    await assert.rejects(f.call({ ...command, takeoffId: 'co' }));
  await assert.rejects(
    f.call({
      name: 'takeoff.copyItems',
      takeoffId: 'phase',
      payload: {
        sourceTakeoffId: 'main',
        geometryIds: ['g'],
        direction: 'deduct',
      },
    }),
    /Only change orders/,
  );
  await assert.rejects(
    f.call({ name: 'takeoff.delete', payload: { id: 'main' } }),
    /Main/,
  );
  await f.call({
    name: 'sheet.put',
    takeoffId: 'co',
    payload: {
      ...f.session.project.sheets.s,
      calibration: { metresPerUnit: 2 },
      name: 'Shared name',
    },
  });
  assert.equal(f.session.project.sheets.s?.calibration?.metresPerUnit, 1);
  assert.equal(
    takeoffProject(f.session.project, 'co').sheets.s?.calibration
      ?.metresPerUnit,
    2,
  );
  assert.equal(f.session.project.sheets.s.name, 'Shared name');
  assert.equal(f.session.project.geometries.g?.points[0]?.x, 0);
});

void test('copy/delete, failed saves, batch preview and undo/redo stay atomic in one project revision queue', async () => {
  const f = fixture();
  await f.create();
  const before = f.session.project;
  const grossPreview = await f.call({
    name: 'preview',
    takeoffId: 'co',
    payload: {
      commands: ['deduct', 'add'].map((direction) => ({
        name: 'takeoff.copyItems',
        payload: { sourceTakeoffId: 'main', geometryIds: ['g'], direction },
      })),
    },
  });
  assert.equal(grossPreview.quantityChanges?.[0]?.delta, 0);
  assert.equal(grossPreview.quantityChanges[0].additionDelta, 4);
  assert.equal(grossPreview.quantityChanges[0].deductionDelta, 4);
  await assert.rejects(f.copy('deduct', ['g', 'missing']));
  assert.deepEqual(f.session.project, before);
  f.fail(true);
  await assert.rejects(f.copy(), /disk full/);
  assert.deepEqual(f.session.project, before);
  f.fail(false);
  await f.copy();
  assert.equal(f.report('co').totals[0]?.amount, -4);
  const copied = f.session.project;
  assert.equal(copied.revision, before.revision + 1);
  await f.call({ name: 'history.undo' });
  assert.equal(f.report('co').outputs.length, 0);
  await f.call({ name: 'history.redo' });
  assert.equal(f.report('co').totals[0]?.amount, -4);
  const preview = await f.call({
    name: 'preview',
    takeoffId: 'co',
    payload: {
      commands: [
        {
          name: 'takeoff.copyItems',
          payload: {
            sourceTakeoffId: 'main',
            geometryIds: ['g'],
            direction: 'add',
          },
        },
        { name: 'quantities.inspect' },
      ],
    },
  });
  assert.equal(
    calculateProject(takeoffProject(preview.project, 'co')).totals[0]?.amount,
    0,
  );
  assert.equal(f.report('co').totals[0]?.amount, -4);
  f.fail(true);
  await assert.rejects(
    f.call({ name: 'takeoff.delete', payload: { id: 'co' } }),
  );
  assert.ok(f.session.project.takeoffs.co);
  f.fail(false);
  await f.call({ name: 'takeoff.delete', payload: { id: 'co' } });
  assert.equal(Object.keys(f.session.project.geometries).length, 1);
  await f.call({ name: 'history.undo' });
  assert.equal(f.report('co').totals[0]?.amount, -4);
  const reopened = new ProjectSession(f.session.project, {
    save: () => Promise.resolve(),
  });
  assert.equal(
    calculateProject(takeoffProject(reopened.project, 'co')).totals[0]?.amount,
    -4,
  );
});

void test('copied modeled walls remap openings and applied IDs; unresolved deductions stay incomplete', async () => {
  const f = fixture();
  await f.call({
    name: 'level.put',
    payload: { id: 'floor', name: 'Floor', elevation: 0 },
  });
  await f.call({
    name: 'placement.put',
    payload: {
      id: 'place',
      sheetId: 's',
      pageOrigin: { x: 0, y: 0 },
      worldOffset: { x: 1, y: 2, z: 0 },
      rotation: 0,
    },
  });
  await f.call({
    name: 'wall.put',
    payload: {
      id: 'wall',
      geometryId: 'g',
      levelId: 'floor',
      baseElevation: 0,
      height: 3,
      studSpacing: 0.5,
      stud: { materialId: 'stud', width: 0.04, depth: 0.09 },
      track: { materialId: 'track', width: 0.04, depth: 0.09 },
    },
  });
  await f.call({
    name: 'opening.put',
    payload: {
      id: 'door',
      wallId: 'wall',
      distance: 1,
      width: 1,
      sill: 0,
      height: 2,
      jambCount: 1,
    },
  });
  const baseline = f.report('main');
  await f.create();
  await f.copy();
  const co = takeoffProject(f.session.project, 'co');
  const walls = resolveConstruction(co).walls;
  const opening = required(
    Object.values(required(co.construction).openings)[0],
  );
  assert.notEqual(opening.id, 'door');
  assert.notEqual(opening.wallId, 'wall');
  assert.ok(walls[opening.wallId]);
  assert.ok(f.report('co').model.pieces.every((p) => p.direction === 'deduct'));
  await f.copy('add');
  assert.equal(
    Object.keys(
      required(takeoffProject(f.session.project, 'co').construction).placements,
    ).length,
    1,
  );
  const recipe = required(
    Object.values(co.recipes).find((r) => r.id !== 'r' && r.wallTemplate),
  );
  const template = { ...required(recipe.wallTemplate) };
  delete template.height;
  await f.call({
    name: 'recipe.put',
    takeoffId: 'co',
    payload: { ...recipe, wallTemplate: template },
  });
  assert.equal(f.report('co').complete, false);
  assert.deepEqual(f.report('main').outputs, baseline.outputs);
});

void test('takeoff caches never cross contexts, invalid deductions stay incomplete, and batch contexts cannot change', async () => {
  const f = fixture();
  await f.create();
  await f.copy();
  const main = f.session.calculationFor('main');
  const co = f.session.calculationFor('co');
  assert.equal(main.totals[0]?.amount, 4);
  assert.equal(co.totals[0]?.amount, -4);
  assert.equal(f.session.calculationFor('co'), co);
  await assert.rejects(
    f.call({
      name: 'batch',
      takeoffId: 'co',
      payload: {
        commands: [{ name: 'quantities.inspect', takeoffId: 'main' }],
      },
    }),
  );
  const view = takeoffProject(f.session.project, 'co');
  const recipe = required(Object.values(view.recipes)[0]);
  await f.call({
    name: 'recipe.put',
    takeoffId: 'co',
    payload: {
      ...recipe,
      outputs: recipe.outputs.map((o) => ({ ...o, formula: 'length / 0' })),
    },
  });
  const incomplete = f.session.calculationFor('co');
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.outputs[0]?.direction, 'deduct');
  assert.throws(
    () => estiMakerTakeoff(takeoffProject(f.session.project, 'co'), incomplete),
    /Cannot export/,
  );
  assert.equal(f.session.calculationFor('main').totals[0]?.amount, 4);
});
