import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calibrationFromDistance,
  convertQuantity,
  createProject,
  hitTestGeometry,
  measureGeometry,
  snapPoint,
  validateGeometry,
} from '../../src/core/geometry';
import type { Geometry } from '../../src/core/types';

function fixture() {
  const project = createProject('Geometry');
  project.sheets.plan = {
    id: 'plan',
    name: 'Plan',
    assetId: 'pdf',
    pageIndex: 0,
    width: 1000,
    height: 1000,
    calibration: calibrationFromDistance(
      { x: 0, y: 0 },
      { x: 24, y: 0 },
      { value: 24, unit: 'ft' },
    ),
  };
  const path: Geometry = {
    id: 'wall',
    name: 'Wall',
    sheetId: 'plan',
    kind: 'path',
    points: [
      { x: 0, y: 0 },
      { x: 24, y: 0 },
    ],
  };
  const area: Geometry = {
    ...path,
    id: 'floor',
    kind: 'area',
    points: [
      { x: 0, y: 0 },
      { x: 24, y: 0 },
      { x: 24, y: 15 },
      { x: 0, y: 15 },
    ],
  };
  return { project, path, area };
}
void test('physical measurements independently match 24 feet, 360 square feet, and 78 foot perimeter', () => {
  const { project, path, area } = fixture();
  const measuredLength = measureGeometry(project, path).length;
  const measuredArea = measureGeometry(project, area);
  assert.ok(measuredLength);
  assert.ok(measuredArea.area);
  assert.ok(measuredArea.perimeter);
  assert.ok(Math.abs(convertQuantity(measuredLength, 'ft').value - 24) < 1e-10);
  assert.ok(
    Math.abs(convertQuantity(measuredArea.area, 'ft2').value - 360) < 1e-10,
  );
  assert.ok(
    Math.abs(convertQuantity(measuredArea.perimeter, 'ft').value - 78) < 1e-10,
  );
});
void test('uncalibrated physical measurements are unavailable while three markers remain three', () => {
  const { project, path } = fixture();
  const sheet = project.sheets.plan;
  assert.ok(sheet);
  delete sheet.calibration;
  assert.equal(measureGeometry(project, path).length, undefined);
  assert.match(
    measureGeometry(project, path).diagnostic ?? '',
    /not calibrated/,
  );
  assert.deepEqual(
    measureGeometry(project, {
      ...path,
      kind: 'count',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ],
    }),
    { count: { value: 3, unit: 'ea' } },
  );
});
void test('invalid geometry and calibration report diagnostics, not zero', () => {
  const { project, path, area } = fixture();
  assert.throws(() => {
    validateGeometry({
      ...area,
      points: [
        { x: 0, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
        { x: 20, y: 0 },
      ],
    });
  });
  assert.throws(() => {
    validateGeometry({
      ...area,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
        { x: 0, y: 5 },
      ],
    });
  }, /overlap|intersect/);
  const invalid = measureGeometry(project, {
    ...path,
    points: [
      { x: NaN, y: 0 },
      { x: 1, y: 1 },
    ],
  });
  assert.equal(invalid.length, undefined);
  assert.match(invalid.diagnostic ?? '', /finite/);
  assert.throws(() =>
    calibrationFromDistance(
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { value: 1, unit: 'm' },
    ),
  );
  assert.throws(
    () => convertQuantity({ value: 1, unit: 'm2' }, 'm'),
    /Cannot convert/,
  );
  const sheet = project.sheets.plan;
  assert.ok(sheet);
  sheet.calibration = { metresPerUnit: -1 };
  assert.equal(measureGeometry(project, path).length, undefined);
  assert.match(measureGeometry(project, path).diagnostic ?? '', /positive/);
  assert.match(
    measureGeometry(project, { ...path, sheetId: 'missing' }).diagnostic ?? '',
    /unavailable/,
  );
});
void test('snapping returns copied page coordinates and hit tests handle boundaries and interiors', () => {
  const { path, area } = fixture();
  assert.deepEqual(snapPoint({ x: 10, y: 0.5 }, [path], 1), { x: 10, y: 0 });
  assert.equal(hitTestGeometry(area, { x: 12, y: 5 }, 0), true);
  assert.equal(hitTestGeometry(area, { x: 24, y: 10 }, 0), true);
  assert.equal(hitTestGeometry(path, { x: 10, y: 2 }, 1), false);
  const snapped = snapPoint({ x: 0, y: 0 }, [path], 1);
  snapped.x = 99;
  assert.equal(path.points[0]?.x, 0);
});
void test('projects own fresh starter recipe copies and stable UUID identity', () => {
  const a = createProject('A');
  const b = createProject('B');
  assert.notEqual(a.id, b.id);
  assert.match(a.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(a.recipes, b.recipes);
  assert.equal(a.formatVersion, 1);
  assert.equal(a.revision, 0);
});
