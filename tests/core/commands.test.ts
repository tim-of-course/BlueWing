import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  commandRegistry,
  executeCommand,
  validateCommand,
} from '../../src/core/commands';
import { createProject } from '../../src/core/geometry';
import { calculateProject } from '../../src/core/calculations';
import { starterAssemblies } from '../../src/core/assemblies';
import { ProjectSession } from '../../src/core/session';

void test('registry examples validate and mutating examples execute in an open project', async () => {
  const project = createProject('Command help');
  // An imported sheet, an area trace, and three already-imported library templates.
  project.sheets['sheet-2'] = {
    id: 'sheet-2',
    name: 'Ceiling plan',
    assetId: 'asset-1',
    pageIndex: 1,
    width: 800,
    height: 600,
    calibration: { metresPerUnit: 0.02 },
  };
  project.geometries['room-1'] = {
    id: 'room-1',
    sheetId: 'sheet-2',
    name: 'Office',
    kind: 'area',
    points: [
      { x: 10, y: 10 },
      { x: 210, y: 10 },
      { x: 210, y: 160 },
      { x: 10, y: 160 },
    ],
  };
  const starters = starterAssemblies();
  for (const id of ['steel-box-header', 'steel-wall', 'ceiling-grid-2x4']) {
    const assembly = starters[id];
    assert.ok(assembly, id);
    project.recipes[id] = assembly;
  }
  const session = new ProjectSession(project, {
    save: () => Promise.resolve(),
  });
  const pending = new Set<string>();
  for (const definition of commandRegistry) {
    assert.ok(definition.description);
    assert.ok(definition.examples.length, definition.name);
    for (const example of definition.examples)
      assert.equal(validateCommand(example).name, definition.name);
    if (definition.mutates) pending.add(definition.name);
  }

  const run = async (...names: string[]) => {
    for (const name of names) {
      const definition = commandRegistry.find((entry) => entry.name === name);
      assert.ok(definition, name);
      for (const example of definition.examples) {
        const request = {
          ...session.observation,
          ...example,
          ...(name === 'takeoff.copyItems' ? { takeoffId: 'co-id' } : {}),
        };
        await assert.doesNotReject(session.dispatch(request), name);
      }
      pending.delete(name);
    }
  };
  await run(
    'project.rename',
    'notes.write',
    'project.category.put',
    'sheet.put',
    'sheet.naming.apply',
    'sheet.scale',
    'sheet.calibrate',
  );
  await run(
    'construction.alignment.put',
    'construction.alignment.match',
    'construction.alignment.delete',
  );
  await run(
    'geometry.put',
    'geometry.move',
    'geometry.copy',
    'group.put',
    'group.members',
    'assignment.put',
    'group.copy',
  );
  await run('recipe.put', 'recipe.delete', 'assembly.put', 'assembly.delete');
  await run(
    'level.put',
    'placement.put',
    'wall.put',
    'header.put',
    'opening.put',
    'ceiling.put',
  );
  assert.deepEqual(session.calculation.model.diagnostics, []);
  await run(
    'header.fromAssembly',
    'wall.fromAssembly',
    'ceiling.fromAssembly',
    'wall.reset',
    'ceiling.reset',
    'snippet.put',
    'review.mark',
  );
  await run(
    'takeoff.create',
    'takeoff.rename',
    'takeoff.copyItems',
    'takeoff.delete',
  );
  await run(
    'snippet.delete',
    'opening.delete',
    'header.delete',
    'wall.delete',
    'ceiling.delete',
    'placement.delete',
    'level.delete',
  );
  await run(
    'assignment.delete',
    'group.delete',
    'geometry.delete',
    'sheet.delete',
    'batch',
    'history.undo',
    'history.redo',
  );
  assert.deepEqual(
    [...pending],
    [],
    'Each mutating command must exercise its published examples',
  );
});

function drawing() {
  let project = createProject('Example');
  project = executeCommand(project, {
    name: 'sheet.put',
    payload: {
      id: 'sheet',
      name: 'Plan',
      assetId: 'pdf',
      pageIndex: 0,
      width: 100,
      height: 100,
    },
  }).project;
  project = executeCommand(project, {
    name: 'geometry.put',
    payload: {
      id: 'wall',
      name: 'Wall',
      sheetId: 'sheet',
      kind: 'path',
      points: [
        { x: 0, y: 0 },
        { x: 24, y: 0 },
      ],
    },
  }).project;
  return executeCommand(project, {
    name: 'group.put',
    payload: { id: 'walls', name: 'Walls', geometryIds: ['wall'] },
  }).project;
}

void test('deletion cascades memberships but deleting groups retains geometry', () => {
  const project = drawing();
  const deleted = executeCommand(project, {
    name: 'geometry.delete',
    payload: { id: 'wall' },
  }).project;
  assert.deepEqual(deleted.groups.walls?.geometryIds, []);
  assert.ok(project.geometries.wall);
  const ungrouped = executeCommand(project, {
    name: 'group.delete',
    payload: { id: 'walls' },
  }).project;
  assert.ok(ungrouped.geometries.wall);
  assert.equal(ungrouped.groups.walls, undefined);
});

void test('groups reject duplicate or dangling memberships and edits remain independent', () => {
  const project = drawing();
  assert.throws(
    () =>
      executeCommand(project, {
        name: 'group.members',
        payload: { id: 'walls', geometryIds: ['wall', 'wall'] },
      }),
    /unique/,
  );
  assert.throws(
    () =>
      executeCommand(project, {
        name: 'group.members',
        payload: { id: 'walls', geometryIds: ['missing'] },
      }),
    /not found/,
  );
  const copy = executeCommand(project, {
    name: 'geometry.copy',
    payload: { id: 'wall', newId: 'copy', dx: 10 },
  }).project;
  const moved = executeCommand(copy, {
    name: 'geometry.move',
    payload: { ids: ['wall'], dx: 1, dy: 2 },
  }).project;
  assert.deepEqual(moved.geometries.copy?.points[0], { x: 10, y: 0 });
  assert.deepEqual(moved.geometries.wall?.points[0], { x: 1, y: 2 });
  assert.deepEqual(moved.groups.walls?.geometryIds, ['wall', 'copy']);
});

void test('payload schemas reject invalid input and retain boolean recipe declarations', () => {
  assert.throws(
    () => validateCommand({ name: 'project.rename', payload: { name: 1 } }),
    /string/,
  );
  assert.throws(
    () =>
      validateCommand({
        name: 'project.rename',
        payload: { name: 'Name', extra: true },
      }),
    /Unknown field/,
  );
  const project = executeCommand(createProject('Boolean'), {
    name: 'recipe.put',
    payload: {
      id: 'boolean',
      name: 'Conditional',
      geometryKinds: ['count'],
      inputs: [
        { name: 'enabled', type: 'boolean', unit: 'scalar', default: true },
      ],
      outputs: [
        {
          id: 'output',
          name: 'Count',
          materialId: 'items',
          unit: 'ea',
          formula: 'count',
          allowance: { wastePercent: 0 },
        },
      ],
    },
  }).project;
  assert.equal(project.recipes.boolean?.inputs[0]?.default, true);
});

void test('editing a project recipe updates existing assignments and undo restores quantities', async () => {
  let project = drawing();
  project = executeCommand(project, {
    name: 'sheet.calibrate',
    payload: {
      id: 'sheet',
      start: { x: 0, y: 0 },
      end: { x: 24, y: 0 },
      distance: { value: 24, unit: 'ft' },
    },
  }).project;
  project = executeCommand(project, {
    name: 'assignment.put',
    payload: {
      id: 'finish',
      groupId: 'walls',
      recipeId: 'wall-area',
      inputs: { height: 8, layers: 2 },
      allowances: {},
    },
  }).project;
  assert.ok(
    Math.abs((calculateProject(project).outputs[0]?.baseAmount ?? 0) - 384) <
      1e-9,
  );
  const saves: number[] = [];
  const session = new ProjectSession(project, {
    save: (_previous, next) => {
      saves.push(next.revision);
      return Promise.resolve();
    },
  });
  const recipe = structuredClone(project.recipes['wall-area']);
  assert.ok(recipe);
  assert.ok(recipe.outputs[0]);
  recipe.outputs[0].formula = 'length * height';
  await session.dispatch({
    projectId: project.id,
    expectedRevision: 0,
    name: 'recipe.put',
    payload: recipe,
  });
  assert.ok(
    Math.abs(
      (calculateProject(session.project).outputs[0]?.baseAmount ?? 0) - 192,
    ) < 1e-9,
  );
  await session.dispatch({
    projectId: project.id,
    expectedRevision: 1,
    name: 'history.undo',
  });
  assert.ok(
    Math.abs(
      (calculateProject(session.project).outputs[0]?.baseAmount ?? 0) - 384,
    ) < 1e-9,
  );
  assert.deepEqual(saves, [1, 2]);
});

void test('public command snapshots, results, payloads, and registry data are isolated', () => {
  const project = drawing();
  const inspected = executeCommand(project, { name: 'project.inspect' });
  const inspectedPoint = (inspected.data as typeof project).geometries.wall
    ?.points[0];
  assert.ok(inspectedPoint);
  inspectedPoint.x = 99;
  assert.equal(inspected.project.geometries.wall?.points[0]?.x, 0);
  const resultPoint = inspected.project.geometries.wall.points[0];
  assert.ok(resultPoint);
  resultPoint.x = 50;
  assert.equal(project.geometries.wall?.points[0]?.x, 0);

  const payload = { id: 'wall', newId: 'copy', dx: 10 };
  const copied = executeCommand(project, { name: 'geometry.copy', payload });
  const copiedPoint = (copied.data as { geometry: { points: { x: number }[] } })
    .geometry.points[0];
  assert.ok(copiedPoint);
  copiedPoint.x = 100;
  assert.equal(copied.project.geometries.copy?.points[0]?.x, 10);
  const group = { id: 'other', name: 'Other', geometryIds: ['wall'] };
  const added = executeCommand(project, { name: 'group.put', payload: group });
  group.geometryIds.length = 0;
  assert.deepEqual(added.project.groups.other?.geometryIds, ['wall']);

  const listed = executeCommand(project, { name: 'commands.list' });
  const definitions = listed.data as { name: string }[];
  assert.ok(definitions[0]);
  definitions[0].name = 'tampered';
  assert.equal(commandRegistry[0]?.name, 'commands.list');
});
