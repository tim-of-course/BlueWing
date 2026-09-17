import assert from 'node:assert/strict';
import { test } from 'node:test';
import { executeCommand } from '../../src/core/commands';
import {
  createProject,
  convertQuantity,
  measureGeometry,
} from '../../src/core/geometry';
import { calibrationFromRatio } from '../../src/core/scale';
import { ProjectSession } from '../../src/core/session';

void test('printed architectural, metric and full-size scales use paper size', () => {
  const architectural = calibrationFromRatio({
    paper: { value: 0.25, unit: 'in' },
    real: { value: 1, unit: 'ft' },
  });
  assert.ok(Math.abs((432 * architectural.metresPerUnit) / 0.3048 - 24) < 1e-9);
  const metric = calibrationFromRatio({
    paper: { value: 1, unit: 'mm' },
    real: { value: 100, unit: 'mm' },
  });
  assert.ok(Math.abs(72 * metric.metresPerUnit - 2.54) < 1e-9);
  const full = calibrationFromRatio({
    paper: { value: 1, unit: 'mm' },
    real: { value: 1, unit: 'mm' },
  });
  assert.ok(Math.abs(72 * full.metresPerUnit - 0.0254) < 1e-9);
  for (const value of [0, -1, Infinity, NaN])
    assert.throws(() =>
      calibrationFromRatio({
        paper: { value, unit: 'in' },
        real: { value: 1, unit: 'ft' },
      }),
    );
});

void test('ratio scale changes measurements, preserves drawing and supports undo', async () => {
  let project = createProject('Scale fixture');
  project = executeCommand(project, {
    name: 'sheet.put',
    payload: {
      id: 'sheet',
      name: 'Plan',
      assetId: 'pdf',
      pageIndex: 0,
      width: 612,
      height: 792,
    },
  }).project;
  for (const [id, kind, points] of [
    [
      'wall',
      'path',
      [
        { x: 0, y: 0 },
        { x: 432, y: 0 },
      ],
    ],
    [
      'room',
      'area',
      [
        { x: 0, y: 0 },
        { x: 432, y: 0 },
        { x: 432, y: 270 },
        { x: 0, y: 270 },
      ],
    ],
    [
      'doors',
      'count',
      [
        { x: 0, y: 0 },
        { x: 432, y: 0 },
      ],
    ],
  ] as const)
    project = executeCommand(project, {
      name: 'geometry.put',
      payload: { id, name: id, sheetId: 'sheet', kind, points },
    }).project;
  const geometry = structuredClone(project.geometries);
  const session = new ProjectSession(project, {
    save: () => Promise.resolve(),
  });
  const scale = async (paper: number) =>
    session.dispatch({
      projectId: project.id,
      expectedRevision: session.project.revision,
      name: 'sheet.scale',
      payload: {
        id: 'sheet',
        paper: { value: paper, unit: 'in' },
        real: { value: 1, unit: 'ft' },
      },
    });
  const measured = (
    id: string,
    metric: 'length' | 'area' | 'count',
    unit: 'ft' | 'ft2' | 'ea',
  ) => {
    const object = session.project.geometries[id];
    assert.ok(object);
    const value = measureGeometry(session.project, object)[metric];
    assert.ok(value);
    return convertQuantity(value, unit).value;
  };
  await scale(0.25);
  assert.ok(Math.abs(measured('wall', 'length', 'ft') - 24) < 1e-9);
  assert.ok(Math.abs(measured('room', 'area', 'ft2') - 360) < 1e-9);
  await scale(0.125);
  assert.ok(Math.abs(measured('wall', 'length', 'ft') - 48) < 1e-9);
  assert.ok(Math.abs(measured('room', 'area', 'ft2') - 1440) < 1e-9);
  assert.equal(measured('doors', 'count', 'ea'), 2);
  assert.deepEqual(session.project.geometries, geometry);
  await session.dispatch({
    projectId: project.id,
    expectedRevision: session.project.revision,
    name: 'history.undo',
  });
  assert.ok(Math.abs(measured('wall', 'length', 'ft') - 24) < 1e-9);
  assert.deepEqual(session.project.geometries, geometry);
});
