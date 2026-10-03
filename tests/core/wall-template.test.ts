import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import {
  executeCommand,
  validateAssembly,
  validateProject,
} from '../../src/core/commands';
import { copyAssembly, validateLibrary } from '../../src/core/assemblies';
import { generateConstruction } from '../../src/core/construction';
import { resolveConstruction } from '../../src/core/applied-assemblies';
import { calculateProject } from '../../src/core/calculations';
import { wallTemplateFromWall } from '../../src/core/wall-template';
import type { Recipe } from '../../src/core/types';
import type { Wall } from '../../src/core/construction-types';
import { ProjectSession } from '../../src/core/session';
import type { CommandCall, Project } from '../../src/core/types';

function fixture() {
  const project = createProject('Wall templates');
  project.sheets.s = {
    id: 's',
    name: 'Plan',
    assetId: 'pdf',
    pageIndex: 0,
    width: 100,
    height: 100,
    calibration: { metresPerUnit: 1 },
  };
  for (const id of ['a', 'b'])
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
  const wall: Wall = {
    id: 'source',
    geometryId: 'a',
    levelId: 'level',
    baseElevation: 0,
    height: 3,
    topProfile: {
      mode: 'linear',
      points: [
        { distance: 0, height: 3 },
        { distance: 4, height: 4 },
      ],
    },
    conditions: [
      {
        id: 'joint',
        distance: 0,
        kind: 'junction',
        count: 1,
        ownerWallId: 'other',
      },
    ],
    studSpacing: 1,
    stud: { materialId: 'stud', width: 0.04, depth: 0.09, stockLength: 4 },
    track: { materialId: 'track', width: 0.04, depth: 0.09, stockLength: 5 },
    finishes: [{ id: 'front', materialId: 'board', face: 'front', layers: 1 }],
    backing: [
      {
        id: 'blocking',
        height: 1,
        member: { materialId: 'backing', width: 0.04, depth: 0.09 },
      },
    ],
  };
  const assembly: Recipe = {
    id: 'template',
    name: 'Wall template',
    geometryKinds: ['path'],
    inputs: [],
    outputs: [],
    wallTemplate: wallTemplateFromWall(wall),
  };
  return { project, assembly, wall };
}

void test('wall definitions stay independent from the library while applied walls follow project edits', () => {
  const { project, assembly, wall } = fixture();
  assert.ok(assembly.wallTemplate);
  for (const key of ['id', 'geometryId', 'levelId', 'topProfile', 'conditions'])
    assert.equal(key in assembly.wallTemplate, false);
  wall.stud.width = 0.1;
  assert.equal(assembly.wallTemplate.stud.width, 0.04);
  validateLibrary({
    version: 2,
    revision: 0,
    assemblies: { template: assembly },
  });
  const imported = copyAssembly(assembly, 'imported');
  let next = executeCommand(project, {
    name: 'assembly.put',
    payload: imported,
  }).project;
  assert.equal(next.formatVersion, 4);
  next = executeCommand(next, {
    name: 'wall.fromAssembly',
    payload: { assemblyId: 'imported', id: 'first', geometryId: 'a' },
  }).project;
  next = executeCommand(next, {
    name: 'wall.fromAssembly',
    payload: {
      assemblyId: 'imported',
      id: 'second',
      geometryId: 'b',
      height: 2.5,
    },
  }).project;
  assembly.wallTemplate.stud.materialId = 'global edit';
  assert.ok(imported.wallTemplate);
  assert.equal(imported.wallTemplate.stud.materialId, 'stud');
  imported.wallTemplate.stud.materialId = 'project edit';
  imported.wallTemplate.height = 3.5;
  next = executeCommand(next, {
    name: 'assembly.put',
    payload: imported,
  }).project;
  const first = resolveConstruction(next).walls.first;
  const second = resolveConstruction(next).walls.second;
  assert.ok(first && second);
  assert.equal(first.stud.materialId, 'project edit');
  assert.equal(first.height, 3.5);
  assert.equal(second.height, 2.5);
  first.stud.width = 0.06;
  assert.equal(second.stud.width, 0.04);
  assert.equal(resolveConstruction(next).walls.first?.stud.width, 0.04);
  const restored = JSON.parse(JSON.stringify(next)) as typeof next;
  validateProject(restored);
  const generated = generateConstruction(
    restored,
    resolveConstruction(restored),
  );
  assert.ok(
    generated.pieces.some(
      (piece) =>
        piece.wallId === 'first' &&
        piece.materialId === 'project edit' &&
        Math.abs(piece.cutLength - 3.5) < 1e-8,
    ),
  );
  assert.ok(
    generated.pieces.some(
      (piece) =>
        piece.wallId === 'second' &&
        piece.materialId === 'project edit' &&
        Math.abs(piece.cutLength - 2.5) < 1e-8,
    ),
  );
  assert.ok(generated.pieces.some((piece) => piece.materialId === 'backing'));
  assert.ok(
    generated.surfaces.some((surface) => surface.materialId === 'board'),
  );
  assert.equal(
    generated.surfaces
      .filter((surface) => surface.wallId === 'first')
      .reduce((sum, surface) => sum + surface.area, 0),
    14,
  );
  assert.equal(
    generated.surfaces
      .filter((surface) => surface.wallId === 'second')
      .reduce((sum, surface) => sum + surface.area, 0),
    10,
  );
  assert.equal(Object.keys(restored.assignments).length, 2);
  assert.equal(
    calculateProject(restored).outputs.some(
      (output) =>
        output.recipeId === 'imported' && output.modeling === 'modeled',
    ),
    true,
  );
});

void test('template commands persist and undo through the shared session', async () => {
  const { project, assembly } = fixture();
  const saved: Project[] = [];
  const session = new ProjectSession(project, {
    save: (_, next) => {
      validateProject(next);
      saved.push(structuredClone(next));
      return Promise.resolve();
    },
  });
  const call = (command: CommandCall) =>
    session.dispatch({
      ...command,
      projectId: session.project.id,
      expectedRevision: session.project.revision,
    });
  await call({ name: 'assembly.put', payload: assembly });
  await call({
    name: 'wall.fromAssembly',
    payload: { assemblyId: assembly.id, geometryId: 'a', id: 'wall' },
  });
  assert.equal(saved.length, 2);
  const persisted = saved[1];
  assert.ok(persisted);
  assert.equal(resolveConstruction(persisted).walls.wall?.height, 3);
  await call({ name: 'history.undo' });
  assert.equal(
    Object.keys(resolveConstruction(session.project).walls).length,
    0,
  );
  await call({ name: 'history.redo' });
  assert.equal(resolveConstruction(session.project).walls.wall?.height, 3);
});

void test('template validation applies to commands, library and persisted projects', () => {
  const { project, assembly } = fixture();
  for (const patch of [
    { geometryKinds: ['area'] },
    { components: [] },
    { inputs: [{ name: 'height', type: 'number', unit: 'm' }] },
    {
      outputs: [
        {
          id: 'out',
          name: 'Count',
          materialId: 'x',
          formula: '1',
          unit: 'ea',
          allowance: { wastePercent: 0 },
        },
      ],
    },
    { wallTemplate: { ...assembly.wallTemplate, levelId: 'foreign' } },
    { wallTemplate: { ...assembly.wallTemplate, studSpacing: 0 } },
    {
      wallTemplate: {
        ...assembly.wallTemplate,
        finishes: [
          { id: 'f', materialId: 'board', face: 'front', layers: 1.5 },
        ],
      },
    },
  ]) {
    const invalid = { ...assembly, ...patch };
    assert.throws(() => {
      validateAssembly(invalid);
    });
    assert.throws(() =>
      executeCommand(project, { name: 'assembly.put', payload: invalid }),
    );
    assert.throws(() => {
      validateProject({
        ...project,
        recipes: { template: invalid },
      });
    });
    assert.throws(() => {
      validateLibrary({
        version: 2,
        revision: 0,
        assemblies: { template: invalid },
      });
    });
  }
  assert.throws(() => {
    validateAssembly({
      id: 'system',
      name: 'System',
      geometryKinds: ['path'],
      inputs: [],
      outputs: [],
      components: [{ id: 'wall', assembly, bindings: {} }],
    });
  });
  const next = executeCommand(project, {
    name: 'assembly.put',
    payload: assembly,
  }).project;
  next.groups.g = { id: 'g', name: 'Group', geometryIds: ['a'] };
  const assigned = executeCommand(next, {
    name: 'assignment.put',
    payload: {
      id: 'assignment',
      groupId: 'g',
      recipeId: 'template',
      inputs: {},
      allowances: {},
    },
  }).project;
  assert.equal(resolveConstruction(assigned).walls['assignment/a']?.height, 3);
  assert.throws(
    () =>
      executeCommand(next, {
        name: 'wall.fromAssembly',
        payload: { assemblyId: 'missing', id: 'wall', geometryId: 'a' },
      }),
    /not found/,
  );
  assert.throws(
    () =>
      executeCommand(next, {
        name: 'wall.fromAssembly',
        payload: { assemblyId: 'template', id: 'wall', geometryId: 'missing' },
      }),
    /geometry/i,
  );
});

void test('group and local heights drive both framing and finishes, with reset returning to shared values', () => {
  const { project, assembly } = fixture();
  project.recipes[assembly.id] = assembly;
  project.groups.g = { id: 'g', name: 'Walls', geometryIds: ['a', 'b'] };
  project.assignments.assignment = {
    id: 'assignment',
    groupId: 'g',
    recipeId: assembly.id,
    inputs: {},
    allowances: {},
    wallOverrides: { height: 3.5 },
    geometryDetails: { b: { wall: { height: 2.5 } } },
  };
  validateProject(project);
  const initial = calculateProject(project);
  assert.equal(
    initial.model.pieces.filter((piece) => piece.role === 'stud').length,
    10,
  );
  assert.equal(
    initial.model.surfaces.reduce((sum, surface) => sum + surface.area, 0),
    24,
  );
  let next = executeCommand(project, {
    name: 'wall.reset',
    payload: { id: 'assignment/b' },
  }).project;
  assert.equal(resolveConstruction(next).walls['assignment/b']?.height, 3.5);
  assert.equal(
    calculateProject(next).model.surfaces.reduce(
      (sum, surface) => sum + surface.area,
      0,
    ),
    28,
  );
  next = executeCommand(next, {
    name: 'assignment.put',
    payload: { ...next.assignments.assignment, wallOverrides: {} },
  }).project;
  assert.equal(resolveConstruction(next).walls['assignment/a']?.height, 3);
  assert.equal(resolveConstruction(next).walls['assignment/b']?.height, 3);
  assert.equal(
    calculateProject(next).model.surfaces.reduce(
      (sum, surface) => sum + surface.area,
      0,
    ),
    24,
  );
});

void test('reapplying a wall template preserves floor and authored profile, with an explicit height override', () => {
  const { project, wall, assembly } = fixture();
  let next = executeCommand(project, {
    name: 'assembly.put',
    payload: assembly,
  }).project;
  next = executeCommand(next, {
    name: 'level.put',
    payload: { id: 'level', name: 'Upper floor', elevation: 4 },
  }).project;
  next = executeCommand(next, {
    name: 'wall.put',
    payload: { ...wall, conditions: [] },
  }).project;
  next = executeCommand(next, {
    name: 'wall.fromAssembly',
    payload: {
      id: wall.id,
      geometryId: wall.geometryId,
      assemblyId: assembly.id,
    },
  }).project;
  const instance = resolveConstruction(next).walls[wall.id];
  assert.equal(instance?.levelId, 'level');
  assert.deepEqual(instance.topProfile, wall.topProfile);
  next = executeCommand(next, {
    name: 'wall.fromAssembly',
    payload: {
      id: wall.id,
      geometryId: wall.geometryId,
      assemblyId: assembly.id,
      height: 2.5,
    },
  }).project;
  assert.equal(resolveConstruction(next).walls[wall.id]?.height, 2.5);
  assert.equal(resolveConstruction(next).walls[wall.id]?.topProfile, undefined);
  assert.equal(resolveConstruction(next).walls[wall.id]?.levelId, 'level');
});
