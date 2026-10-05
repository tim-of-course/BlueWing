import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import {
  modeledOutputs,
  summarizeMaterials,
} from '../../src/core/material-results';
import type {
  ConstructionResult,
  ConstructionSource,
} from '../../src/core/construction-types';

void test('quantity diagnostics keep the most specific source scope and preserve unresolved problems', () => {
  const member = (id: string, source: ConstructionSource) => ({
    ...source,
    id,
    materialId: 'stud',
    role: 'stud',
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0, y: 0, z: 3 },
    cutLength: 3,
    width: 0.04,
    depth: 0.09,
    sectionRotation: 0,
  });
  const surface = (id: string, source: ConstructionSource) => ({
    ...source,
    id,
    materialId: 'board',
    face: 'ceiling' as const,
    layers: 1,
    geometricArea: 1,
    area: 1,
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 1, z: 0 },
    ],
  });
  const firstWall = {
    wallId: 'wall-a',
    assignmentId: 'a',
    geometryId: 'trace-a',
  };
  const model: ConstructionResult = {
    pieces: [
      member('stud-a1', firstWall),
      member('stud-a2', firstWall),
      member('stud-b', {
        wallId: 'wall-b',
        assignmentId: 'b',
        geometryId: 'trace-b',
      }),
    ],
    surfaces: [
      surface('ceiling', {
        ceilingId: 'ceiling-c',
        assignmentId: 'c',
        geometryId: 'trace-c',
      }),
      surface('finish', { assignmentId: 'd', geometryId: 'trace-d' }),
    ],
    purchases: [],
    diagnostics: [
      { code: 'global', message: 'Global issue' },
      {
        code: 'wall',
        message: 'Wall issue',
        wallId: 'wall-a',
        ceilingId: 'ceiling-c',
        assignmentId: 'b',
        geometryId: 'trace-b',
      },
      {
        code: 'ceiling',
        message: 'Ceiling issue',
        ceilingId: 'ceiling-c',
        assignmentId: 'a',
        geometryId: 'trace-a',
      },
      {
        code: 'assignment',
        message: 'Assignment issue',
        assignmentId: 'd',
        geometryId: 'trace-a',
      },
      { code: 'geometry', message: 'Geometry issue', geometryId: 'trace-b' },
      {
        code: 'missing-wall',
        message: 'Unresolved wall issue',
        wallId: 'missing',
        assignmentId: 'a',
        geometryId: 'trace-a',
      },
    ],
    complete: false,
  };
  summarizeMaterials(model);
  const rows = modeledOutputs(createProject('Diagnostics'), model);
  const modeled = rows.filter((row) => row.modeling === 'modeled');
  assert.deepEqual(
    Object.fromEntries(
      modeled.map((row) => [row.assignmentId, row.diagnostics]),
    ),
    {
      a: ['Global issue', 'Wall issue'],
      b: ['Global issue', 'Geometry issue'],
      c: ['Global issue', 'Ceiling issue'],
      d: ['Global issue', 'Assignment issue'],
    },
  );
  assert.equal(modeled.find((row) => row.assignmentId === 'a')?.baseAmount, 2);
  assert.ok(modeled.every((row) => !row.complete));
  const unresolved = rows.filter((row) => row.modeling === 'unresolved');
  assert.equal(unresolved.length, 1);
  assert.deepEqual(unresolved[0]?.diagnostics, ['Unresolved wall issue']);
});
