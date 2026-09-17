import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  commandRegistry,
  executeCommand,
  validateCommand,
} from '../../src/core/commands';
import { createProject } from '../../src/core/geometry';
import { calculateProject } from '../../src/core/calculations';
import { ProjectSession } from '../../src/core/session';

void test('registry examples all match their discoverable schemas', () => {
  for (const definition of commandRegistry) {
    assert.ok(definition.description);
    for (const example of definition.examples)
      assert.equal(validateCommand(example).name, definition.name);
  }
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
  assert.deepEqual(moved.groups.walls?.geometryIds, ['wall']);
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
