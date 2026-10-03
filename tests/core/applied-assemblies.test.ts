import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import { executeCommand } from '../../src/core/commands';
import { calculateProject } from '../../src/core/calculations';
import {
  materialSettings,
  resolveConstruction,
} from '../../src/core/applied-assemblies';
import type { CommandCall } from '../../src/core/types';

function fixture() {
  let project = createProject('Applied walls');
  const run = (call: CommandCall) => {
    project = executeCommand(project, call).project;
  };
  run({
    name: 'sheet.put',
    payload: {
      id: 's',
      name: 'Plan',
      assetId: 'pdf',
      pageIndex: 0,
      width: 100,
      height: 100,
      calibration: { metresPerUnit: 1 },
    },
  });
  for (const [id, y] of [
    ['a', 0],
    ['b', 5],
  ] as const)
    run({
      name: 'geometry.put',
      payload: {
        id,
        name: id,
        sheetId: 's',
        kind: 'path',
        points: [
          { x: 0, y },
          { x: 4, y },
        ],
      },
    });
  run({
    name: 'assembly.put',
    payload: {
      id: 'wall',
      name: 'Wall',
      geometryKinds: ['path'],
      inputs: [],
      outputs: [],
      wallTemplate: {
        height: 2,
        baseElevation: 0,
        studSpacing: 1,
        stud: { materialId: 'stud', width: 0.04, depth: 0.09, stockLength: 4 },
        track: {
          materialId: 'track',
          width: 0.09,
          depth: 0.03,
          stockLength: 4,
        },
        finishes: [
          { id: 'board', materialId: 'board', face: 'front', layers: 1 },
        ],
      },
    },
  });
  run({
    name: 'group.put',
    payload: { id: 'g', name: 'Walls', geometryIds: ['a', 'b'] },
  });
  run({
    name: 'assignment.put',
    payload: {
      id: 'use',
      groupId: 'g',
      recipeId: 'wall',
      inputs: {},
      allowances: {},
      geometryDetails: { a: { id: 'wall-a' }, b: { id: 'wall-b' } },
    },
  });
  return {
    get project() {
      return project;
    },
    run,
  };
}

void test('editing another wall field retains a deliberate override even when the current default matches it', () => {
  const f = fixture();
  const edit = (height: number) => {
    const wall = resolveConstruction(f.project).walls['wall-a'];
    assert.ok(wall);
    f.run({
      name: 'wall.put',
      payload: {
        ...materialSettings(wall),
        id: wall.id,
        geometryId: wall.geometryId,
        height,
      },
    });
  };
  edit(3);
  const assembly = structuredClone(f.project.recipes.wall);
  assert.ok(assembly?.wallTemplate);
  assembly.wallTemplate.height = 3;
  f.run({ name: 'assembly.put', payload: assembly });
  const wall = resolveConstruction(f.project).walls['wall-a'];
  assert.ok(wall);
  f.run({
    name: 'wall.put',
    payload: {
      ...materialSettings(wall),
      id: wall.id,
      geometryId: wall.geometryId,
      bottomAllowance: 0.01,
    },
  });
  assembly.wallTemplate.height = 4;
  f.run({ name: 'assembly.put', payload: assembly });
  assert.equal(resolveConstruction(f.project).walls['wall-a']?.height, 3);
  assert.equal(resolveConstruction(f.project).walls['wall-b']?.height, 4);
  f.run({ name: 'wall.reset', payload: { id: 'wall-a' } });
  assert.equal(resolveConstruction(f.project).walls['wall-a']?.height, 4);
});

void test('group copies own distinct material and opening IDs, and deleting one use preserves another assignment on its group', () => {
  const f = fixture();
  f.run({
    name: 'opening.put',
    payload: {
      id: 'window',
      wallId: 'wall-a',
      distance: 1,
      width: 1,
      sill: 0.5,
      height: 1,
      jambCount: 0,
    },
  });
  const initial = calculateProject(f.project).model;
  f.run({ name: 'group.copy', payload: { id: 'g', newId: 'copy' } });
  const copied = calculateProject(f.project).model;
  assert.equal(copied.pieces.length, initial.pieces.length * 2);
  assert.equal(
    new Set(copied.pieces.map((p) => p.id)).size,
    copied.pieces.length,
  );
  assert.equal(Object.keys(f.project.construction?.openings ?? {}).length, 2);
  f.run({
    name: 'assignment.put',
    payload: {
      id: 'area',
      groupId: 'g',
      recipeId: 'wall-area',
      inputs: { height: 8 },
      allowances: {},
    },
  });
  f.run({ name: 'wall.delete', payload: { id: 'wall-a' } });
  assert.deepEqual(f.project.groups.g?.geometryIds, ['a', 'b']);
  assert.ok(f.project.assignments.area);
  assert.equal(resolveConstruction(f.project).walls['wall-a'], undefined);
  assert.ok(resolveConstruction(f.project).walls['wall-b']);
  assert.equal(Object.keys(f.project.construction?.openings ?? {}).length, 1);
});

void test('unlocated finish deductions are rejected and incompatible model assignments stay visibly unresolved', () => {
  const f = fixture();
  const wall = resolveConstruction(f.project).walls['wall-a'];
  assert.ok(wall);
  assert.throws(() => {
    f.run({
      name: 'wall.put',
      payload: {
        ...materialSettings(wall),
        id: wall.id,
        geometryId: wall.geometryId,
        finishes: [
          {
            id: 'f',
            materialId: 'board',
            face: 'front',
            layers: 1,
            deduction: 1,
          },
        ],
      },
    });
  }, /Unknown field/);
  f.run({
    name: 'geometry.put',
    payload: {
      id: 'count',
      name: 'Count',
      sheetId: 's',
      kind: 'count',
      points: [{ x: 0, y: 0 }],
    },
  });
  f.run({
    name: 'group.put',
    payload: { id: 'g', name: 'Incompatible', geometryIds: ['count'] },
  });
  const result = calculateProject(f.project);
  assert.equal(result.complete, false);
  assert.equal(result.model.pieces.length, 0);
  assert.equal(result.outputs[0]?.modeling, 'unresolved');
});

void test('reapplying an assembly preserves a wall that owns shared junction members', () => {
  const f = fixture();
  f.run({
    name: 'geometry.put',
    payload: {
      ...f.project.geometries.b,
      points: [
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ],
    },
  });
  for (const [id, distance] of [
    ['wall-a', 4],
    ['wall-b', 0],
  ] as const) {
    const wall = resolveConstruction(f.project).walls[id];
    assert.ok(wall);
    f.run({
      name: 'wall.put',
      payload: {
        ...materialSettings(wall),
        id,
        geometryId: wall.geometryId,
        conditions: [
          {
            id: 'shared',
            kind: 'junction',
            distance,
            count: 1,
            ownerWallId: 'wall-a',
          },
        ],
      },
    });
  }
  f.run({
    name: 'wall.fromAssembly',
    payload: { assemblyId: 'wall', geometryId: 'a', id: 'wall-a' },
  });
  const data = resolveConstruction(f.project);
  assert.equal(data.walls['wall-a']?.conditions?.[0]?.ownerWallId, 'wall-a');
  assert.equal(data.walls['wall-b']?.conditions?.[0]?.ownerWallId, 'wall-a');
  assert.equal(
    calculateProject(f.project).model.pieces.filter(
      (p) => p.role === 'junction',
    ).length,
    1,
  );
  assert.throws(() => {
    f.run({ name: 'wall.delete', payload: { id: 'wall-a' } });
  }, /Reassign shared member ownership/);
});

void test('incomplete modeled applications retain their own diagnostics without invalidating unrelated quantities', () => {
  const f = fixture();
  f.run({
    name: 'geometry.put',
    payload: {
      id: 'count',
      name: 'Count',
      sheetId: 's',
      kind: 'count',
      points: [{ x: 0, y: 0 }],
    },
  });
  f.run({
    name: 'group.put',
    payload: { id: 'wrong', name: 'Wrong kind', geometryIds: ['count'] },
  });
  f.run({
    name: 'assignment.put',
    payload: {
      id: 'bad',
      groupId: 'wrong',
      recipeId: 'wall',
      inputs: {},
      allowances: {},
    },
  });
  let result = calculateProject(f.project);
  assert.ok(
    result.outputs
      .filter((output) => output.assignmentId === 'use')
      .every((output) => output.complete),
  );
  assert.equal(
    result.outputs.find((output) => output.assignmentId === 'bad')?.modeling,
    'unresolved',
  );
  f.run({ name: 'assignment.delete', payload: { id: 'bad' } });
  const assembly = structuredClone(f.project.recipes.wall);
  assert.ok(assembly?.wallTemplate);
  delete assembly.wallTemplate.height;
  f.run({ name: 'assembly.put', payload: assembly });
  result = calculateProject(f.project);
  const missing = result.outputs.filter(
    (output) => output.modeling === 'unresolved',
  );
  assert.equal(missing.length, 2);
  assert.deepEqual(
    missing
      .flatMap((output) => output.sources.map((source) => source.geometryId))
      .sort(),
    ['a', 'b'],
  );
});
