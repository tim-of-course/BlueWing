import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import { visibleDrawingIds } from '../../src/app/visibility';

void test('visibility respects sheet-local groups, shared objects, and ungrouped drawing', () => {
  const project = createProject('Visibility');
  for (const [id, sheetId] of [
    ['shared', 'first'],
    ['only-a', 'first'],
    ['ungrouped', 'first'],
    ['other-sheet', 'second'],
  ] as const)
    project.geometries[id] = {
      id,
      sheetId,
      name: id,
      kind: 'count',
      points: [{ x: 10, y: 10 }],
    };
  project.groups.a = {
    id: 'a',
    name: 'A',
    geometryIds: ['shared', 'only-a', 'other-sheet'],
  };
  project.groups.b = { id: 'b', name: 'B', geometryIds: ['shared'] };
  const original = structuredClone(project);
  const visible = (
    hiddenSheets: string[],
    hiddenGroups: Record<string, string[]>,
  ) => [...visibleDrawingIds(project, { hiddenSheets, hiddenGroups })].sort();
  assert.deepEqual(visible([], { first: ['a'] }), [
    'other-sheet',
    'shared',
    'ungrouped',
  ]);
  assert.deepEqual(visible([], { first: ['a', 'b'] }), [
    'other-sheet',
    'ungrouped',
  ]);
  assert.deepEqual(visible(['first'], {}), ['other-sheet']);
  assert.deepEqual(visible([], {}), [
    'only-a',
    'other-sheet',
    'shared',
    'ungrouped',
  ]);
  assert.deepEqual(project, original);
});
