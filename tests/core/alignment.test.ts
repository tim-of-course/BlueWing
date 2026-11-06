import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchSheetAlignment } from '../../src/core/alignment';
import { executeCommand, validateProject } from '../../src/core/commands';
import { calculateSnapshot } from '../../src/core/calculation-state';
import { ProjectSession } from '../../src/core/session';
import { reviewFingerprint } from '../../src/core/review';
import type { Project } from '../../src/core/types';
import {
  constructionSceneContext,
  prepareConstructionScene,
} from '../../src/three/scene';
import type { ConstructionResult } from '../../src/core/construction-types';

function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

function fixture(): Project {
  return {
    formatVersion: 5,
    id: 'p',
    name: 'Alignment',
    revision: 0,
    sheets: Object.fromEntries(
      ['a', 'b'].map((id) => [
        id,
        {
          id,
          name: id,
          assetId: 'pdf',
          pageIndex: 0,
          width: 100,
          height: 100,
          calibration: { metresPerUnit: 0.5 },
        },
      ]),
    ),
    geometries: Object.fromEntries(
      ['a', 'b'].map((id) => [
        id,
        {
          id,
          sheetId: id,
          name: id,
          kind: 'path' as const,
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
          ],
        },
      ]),
    ),
    groups: {},
    recipes: {},
    assignments: {},
  };
}
function near(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${String(actual)} != ${String(expected)}`,
  );
}

void test('match solves independent known world transforms, placements and reference alignment', () => {
  const p = fixture();
  p.construction = {
    openings: {},
    headers: {},
    levels: {},
    placements: {
      a: {
        id: 'a',
        sheetId: 'a',
        pageOrigin: { x: 2, y: 4 },
        worldOffset: { x: 3, y: 5, z: 7 },
        rotation: Math.PI / 2,
      },
    },
  };
  required(p.sheets.b).combined3dAlignment = {
    offset: { x: 10, y: 20 },
    rotation: Math.PI / 2,
  };
  // Source world points (3,5),(3,7); reference aligned points (10,20),(12,20).
  const result = matchSheetAlignment(p, {
    sheetId: 'a',
    referenceSheetId: 'b',
    sourcePoints: [
      { x: 2, y: 4 },
      { x: 6, y: 4 },
    ],
    referencePoints: [
      { x: 0, y: 0 },
      { x: 0, y: 4 },
    ],
  });
  near(result.alignment.rotation, -Math.PI / 2);
  near(result.alignment.offset.x, 5);
  near(result.alignment.offset.y, 23);
  near(result.sourceDistance ?? NaN, 2);
  near(result.referenceDistance ?? NaN, 2);
  near(result.residual, 0);
  const mismatch = matchSheetAlignment(p, {
    sheetId: 'a',
    referenceSheetId: 'b',
    sourcePoints: [
      { x: 2, y: 4 },
      { x: 6, y: 4 },
    ],
    referencePoints: [
      { x: 0, y: 0 },
      { x: 0, y: 8 },
    ],
  });
  near(mismatch.residual, 2);
  assert.equal(p.sheets.a?.calibration?.metresPerUnit, 0.5);
});

void test('one point preserves moving rotation and invalid matches reject', () => {
  const p = fixture();
  required(p.sheets.a).combined3dAlignment = {
    offset: { x: 100, y: -20 },
    rotation: Math.PI / 2,
  };
  const payload = {
    sheetId: 'a',
    referenceSheetId: 'b',
    sourcePoints: [{ x: 2, y: 0 }],
    referencePoints: [{ x: 6, y: 0 }],
  };
  const result = matchSheetAlignment(p, payload);
  near(result.alignment.rotation, Math.PI / 2);
  near(result.alignment.offset.x, 3);
  near(result.alignment.offset.y, -1);
  assert.equal(result.sourceDistance, null);
  assert.throws(
    () => matchSheetAlignment(p, { ...payload, sourcePoints: [] }),
    /paired/,
  );
  assert.throws(
    () => matchSheetAlignment(p, { ...payload, referenceSheetId: 'a' }),
    /distinct/,
  );
  assert.throws(
    () =>
      matchSheetAlignment(p, {
        ...payload,
        sourcePoints: [{ x: Infinity, y: 0 }],
      }),
    /finite/,
  );
  assert.throws(
    () =>
      matchSheetAlignment(p, {
        ...payload,
        sourcePoints: [
          required(payload.sourcePoints[0]),
          required(payload.sourcePoints[0]),
        ],
        referencePoints: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      }),
    /coincide/,
  );
  delete required(p.sheets.b).calibration;
  assert.throws(() => matchSheetAlignment(p, payload), /calibration/);
});

void test('alignment commands preserve cached quantities and review across preview, undo and redo', async () => {
  const p = fixture();
  const fingerprint = reviewFingerprint(p, { kind: 'geometry', id: 'a' });
  const saved: Project[] = [];
  const session = new ProjectSession(p, {
    save: (_before, after) => {
      saved.push(after);
      return Promise.resolve();
    },
  });
  const calculation = session.calculation;
  const put = {
    name: 'construction.alignment.put',
    payload: { sheetId: 'a', offset: { x: 3, y: 4 }, rotation: 1 },
  };
  const preview = await session.dispatch({
    ...session.observation,
    name: 'preview',
    payload: { commands: [put] },
  });
  assert.equal(preview.project.sheets.a?.combined3dAlignment?.rotation, 1);
  assert.equal(session.project.sheets.a?.combined3dAlignment, undefined);
  assert.deepEqual(preview.quantityChanges, []);
  assert.equal(saved.length, 0);
  await session.dispatch({ ...session.observation, ...put });
  assert.equal(session.calculation, calculation);
  assert.equal(
    reviewFingerprint(session.project, { kind: 'geometry', id: 'a' }),
    fingerprint,
  );
  await assert.rejects(
    session.dispatch({ projectId: 'p', expectedRevision: 0, ...put }),
    /conflict/i,
  );
  for (const name of ['history.undo', 'history.redo']) {
    await session.dispatch({ ...session.observation, name });
    assert.equal(session.calculation, calculation);
    assert.equal(
      structuredClone(session.project).sheets.a?.combined3dAlignment?.rotation,
      name === 'history.undo' ? undefined : 1,
    );
  }
  await session.dispatch({
    ...session.observation,
    name: 'sheet.put',
    payload: {
      ...session.project.sheets.a,
      combined3dAlignment: { offset: { x: 8, y: 9 }, rotation: 2 },
    },
  });
  assert.equal(session.calculation, calculation);
  await session.dispatch({
    ...session.observation,
    name: 'construction.alignment.match',
    payload: {
      sheetId: 'a',
      referenceSheetId: 'b',
      sourcePoints: [{ x: 0, y: 0 }],
      referencePoints: [{ x: 2, y: 2 }],
    },
  });
  assert.equal(session.calculation, calculation);
  await session.dispatch({
    ...session.observation,
    name: 'construction.alignment.delete',
    payload: { sheetId: 'a' },
  });
  assert.equal(session.project.sheets.a?.combined3dAlignment, undefined);
  assert.equal(session.calculation, calculation);
  assert.equal(saved.at(-1)?.revision, session.project.revision);
  assert.throws(
    () =>
      executeCommand(p, { ...put, payload: { ...put.payload, rotation: NaN } }),
    /valid range/,
  );
  const invalid = fixture();
  required(invalid.sheets.a).combined3dAlignment = {
    offset: { x: Infinity, y: 0 },
    rotation: 0,
  };
  assert.throws(() => {
    validateProject(invalid);
  });
});

void test('scene scope intersects filters, aligns copies and keeps frame when material filtering', () => {
  const p = fixture();
  required(p.sheets.a).combined3dAlignment = {
    offset: { x: 10, y: 20 },
    rotation: Math.PI / 2,
  };
  const model = structuredClone(
    calculateSnapshot(p).model,
  ) as ConstructionResult;
  model.pieces.push({
    id: 'member',
    geometryId: 'a',
    materialId: 'steel',
    role: 'stud',
    start: { x: 1, y: 2, z: 3 },
    end: { x: 1, y: 2, z: 5 },
    cutLength: 2,
    sectionRotation: 0,
    width: 0.1,
    depth: 0.2,
    widthAxis: { x: 1, y: 0, z: 0 },
  });
  model.surfaces.push({
    id: 'surface',
    geometryId: 'b',
    materialId: 'board',
    face: 'ceiling',
    layers: 1,
    area: 0.5,
    geometricArea: 0.5,
    points: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 0, y: 1, z: 1 },
    ],
  });
  Object.freeze(model.pieces[0]?.start);
  Object.freeze(model.pieces[0]);
  const prepared = prepareConstructionScene(
    constructionSceneContext(p),
    model,
    { materialId: 'steel' },
  );
  const member = prepared.scene.members[0];
  assert.ok(member);
  near(member.start.x, 8);
  near(member.start.y, 21);
  assert.equal(member.start.z, 3);
  near(member.widthAxis?.x ?? NaN, 0);
  near(member.widthAxis?.y ?? NaN, 1);
  assert.deepEqual(model.pieces[0]?.start, { x: 1, y: 2, z: 3 });
  assert.deepEqual(prepared.sheetIds, ['a', 'b']);
  assert.ok(prepared.scene.bounds.min.x > 7);
  for (const options of [{ sheetIds: ['a'] }, { alignment: 'none' as const }]) {
    const single = prepareConstructionScene(
      constructionSceneContext(p),
      model,
      options,
    );
    assert.deepEqual(single.scene.members[0]?.start, { x: 1, y: 2, z: 3 });
    assert.deepEqual(single.appliedAlignments, {});
  }
  assert.equal(
    prepareConstructionScene(constructionSceneContext(p), model, {
      sheetIds: [],
    }).scene.count,
    0,
  );
  assert.equal(
    prepareConstructionScene(constructionSceneContext(p), model, {
      sheetIds: ['a', 'gone'],
      geometryIds: ['b'],
    }).scene.count,
    0,
  );
  assert.equal(
    prepareConstructionScene(constructionSceneContext(p), model, {
      sheetIds: ['a', 'b'],
      levelGeometryIds: ['b'],
      materialId: 'steel',
    }).scene.count,
    0,
  );
  assert.equal(
    prepareConstructionScene(constructionSceneContext(p), model, {
      sheetIds: ['a'],
      role: 'finish',
    }).scene.count,
    0,
  );
  required(p.sheets.b).combined3dAlignment = {
    offset: { x: -2, y: 7 },
    rotation: Math.PI,
  };
  const surface = prepareConstructionScene(constructionSceneContext(p), model)
    .scene.surfaces[0];
  assert.ok(surface);
  near(surface.points[1]?.x ?? NaN, -3);
  near(surface.points[1]?.y ?? NaN, 7);
});
