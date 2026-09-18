import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitTestGeometrySweep } from '../../src/core/geometry';
import type { Geometry } from '../../src/core/types';

void test('a swept brush catches thin crossings and nearby markers without selecting distant objects', () => {
  const line: Geometry = {
    id: 'wall',
    sheetId: 'sheet',
    name: 'Wall',
    kind: 'path',
    points: [
      { x: 20, y: -50 },
      { x: 20, y: 50 },
    ],
  };
  assert.equal(
    hitTestGeometrySweep(line, { x: 0, y: 0 }, { x: 100, y: 0 }, 2),
    true,
  );
  const marker: Geometry = {
    ...line,
    kind: 'count',
    points: [{ x: 50, y: 5 }],
  };
  assert.equal(
    hitTestGeometrySweep(marker, { x: 0, y: 0 }, { x: 100, y: 0 }, 6),
    true,
  );
  assert.equal(
    hitTestGeometrySweep(marker, { x: 0, y: 0 }, { x: 100, y: 0 }, 4),
    false,
  );
  const area: Geometry = {
    ...line,
    kind: 'area',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  };
  assert.equal(
    hitTestGeometrySweep(area, { x: 40, y: 40 }, { x: 45, y: 45 }, 2),
    true,
  );
  assert.equal(
    hitTestGeometrySweep(line, { x: 0, y: 100 }, { x: 100, y: 100 }, 2),
    false,
  );
});
