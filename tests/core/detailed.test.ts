import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../../src/core/geometry';
import { ProjectSession } from '../../src/core/session';
import { executeCommand } from '../../src/core/commands';
import { generateConstruction } from '../../src/core/construction';
import { resolveConstruction } from '../../src/core/applied-assemblies';
import { inspectReview, reviewFingerprint } from '../../src/core/review';
import { exportConstruction } from '../../src/core/detailed-commands';
import type { CommandCall } from '../../src/core/types';

function fixture() {
  const project = createProject('Detailed');
  project.sheets.s = {
    id: 's',
    name: 'Plan',
    assetId: 'pdf',
    pageIndex: 0,
    width: 100,
    height: 100,
    calibration: { feetPerUnit: 1 },
  };
  project.geometries.g = {
    id: 'g',
    sheetId: 's',
    name: 'Wall',
    kind: 'path',
    points: [
      { x: 10, y: 10 },
      { x: 16, y: 10 },
    ],
  };
  const saves: unknown[] = [];
  const session = new ProjectSession(project, {
    save: (_, next) => {
      saves.push(next);
      return Promise.resolve();
    },
  });
  const call = (command: CommandCall) =>
    session.dispatch({
      ...command,
      projectId: session.project.id,
      expectedRevision: session.project.revision,
    });
  const wall = {
    id: 'w',
    geometryId: 'g',
    baseElevation: 0,
    height: 3,
    studSpacing: 0.5,
    stud: { materialId: 'stud', width: 0.04, depth: 0.09, stockLength: 3 },
    track: { materialId: 'track', width: 0.04, depth: 0.09, stockLength: 3 },
    finishes: [{ id: 'board', materialId: 'board', face: 'front', layers: 2 }],
  };
  return { session, call, wall, saves };
}

void test('construction commands save, preview, undo and redo without changing authored plan coordinates', async () => {
  const { session, call, wall, saves } = fixture();
  const points = session.project.geometries.g?.points;
  await call({ name: 'wall.put', payload: wall });
  assert.equal(session.project.formatVersion, 7);
  const result = generateConstruction(
    session.project,
    resolveConstruction(session.project),
  );
  assert.equal(result.pieces.filter((p) => p.role === 'stud').length, 13);
  assert.equal(
    result.surfaces.reduce((sum, s) => sum + s.area, 0),
    36,
  );
  const preview = await call({
    name: 'preview',
    payload: {
      commands: [{ name: 'wall.put', payload: { ...wall, height: 2.5 } }],
    },
  });
  assert.equal(preview.preview, true);
  assert.equal(preview.previewStatus?.constructionComplete, true);
  const incomplete = await call({
    name: 'preview',
    payload: {
      commands: [
        {
          name: 'opening.put',
          payload: {
            id: 'door',
            wallId: 'w',
            distance: 1,
            width: 1,
            height: 2,
            sill: 0,
            jambCount: 2,
          },
        },
      ],
    },
  });
  assert.equal(incomplete.previewStatus?.calculationComplete, false);
  assert.equal(incomplete.previewStatus.constructionComplete, false);
  assert.ok(
    incomplete.previewStatus.diagnostics.some((d) =>
      d.message.includes('explicit header'),
    ),
  );
  assert.equal(resolveConstruction(session.project).walls.w?.height, 3);
  assert.equal(saves.length, 1);
  await call({ name: 'history.undo' });
  assert.equal(Object.hasOwn(session.project, 'construction'), false);
  await call({ name: 'history.redo' });
  assert.equal(resolveConstruction(session.project).walls.w?.height, 3);
  assert.deepEqual(session.project.geometries.g?.points, points);
});

void test('review remains valid after rename and detects relevant dimension or snippet changes, including undo', async () => {
  const { session, call, wall } = fixture();
  await call({ name: 'wall.put', payload: wall });
  await call({
    name: 'review.mark',
    payload: {
      id: 'r',
      target: { kind: 'wall', id: 'w' },
      status: 'reviewed',
      note: 'Checked detail',
    },
  });
  assert.equal(
    inspectReview(session.project).marks[0]?.effectiveStatus,
    'reviewed',
  );
  await call({ name: 'project.rename', payload: { name: 'Renamed' } });
  assert.equal(
    inspectReview(session.project).marks[0]?.effectiveStatus,
    'reviewed',
  );
  await call({ name: 'wall.put', payload: { ...wall, height: 3.2 } });
  assert.equal(
    inspectReview(session.project).marks[0]?.effectiveStatus,
    'changed',
  );
  await call({ name: 'history.undo' });
  assert.equal(
    inspectReview(session.project).marks[0]?.effectiveStatus,
    'reviewed',
  );
  await call({
    name: 'snippet.put',
    payload: {
      id: 'detail',
      name: 'Header',
      sheetId: 's',
      bounds: { x: 5, y: 5, width: 20, height: 20 },
      geometryIds: ['g'],
      sources: [{ kind: 'wall', id: 'w' }],
      annotations: [],
      note: 'Verify bearing',
    },
  });
  assert.equal(
    inspectReview(session.project).marks[0]?.effectiveStatus,
    'changed',
  );
});

void test('invalid snippets and batched openings roll back, while geometry deletion prunes and undo restores dependents', async () => {
  const { session, call, wall } = fixture();
  await call({ name: 'wall.put', payload: wall });
  await assert.rejects(
    call({
      name: 'snippet.put',
      payload: {
        id: 'bad',
        name: 'Bad',
        sheetId: 's',
        bounds: { x: 99, y: 0, width: 20, height: 20 },
        geometryIds: [],
        sources: [],
        annotations: [],
        note: '',
      },
    }),
    /bounds/,
  );
  assert.equal(session.project.review, undefined);
  await assert.rejects(
    call({
      name: 'batch',
      payload: {
        commands: [
          { name: 'wall.put', payload: { ...wall, height: 4 } },
          {
            name: 'opening.put',
            payload: {
              id: 'o',
              wallId: 'w',
              distance: 1,
              width: 2,
              sill: 0,
              height: 2,
              jambCount: 1.5,
            },
          },
        ],
      },
    }),
    /jamb count/,
  );
  assert.equal(resolveConstruction(session.project).walls.w?.height, 3);
  await call({
    name: 'opening.put',
    payload: {
      id: 'o',
      wallId: 'w',
      distance: 1,
      width: 1,
      sill: 0,
      height: 2,
      jambCount: 1,
    },
  });
  await call({ name: 'geometry.delete', payload: { id: 'g' } });
  assert.deepEqual(resolveConstruction(session.project).walls, {});
  assert.deepEqual(session.project.construction?.openings, {});
  await call({ name: 'history.undo' });
  assert.ok(session.project.construction.openings.o);
});

void test('duplicating geometry copies its construction and openings as independent unreviewed records', async () => {
  const { session, call, wall } = fixture();
  await call({
    name: 'wall.put',
    payload: {
      ...wall,
      conditions: [
        { id: 'end', kind: 'end', distance: 0, count: 1, ownerWallId: 'w' },
      ],
    },
  });
  await call({
    name: 'header.put',
    payload: {
      id: 'h',
      name: 'Door header',
      components: [
        {
          id: 'web',
          role: 'header',
          member: wall.track,
          startExtension: 0,
          endExtension: 0,
          verticalOffset: 0.05,
          faceOffset: 0,
        },
      ],
    },
  });
  await call({
    name: 'opening.put',
    payload: {
      id: 'o',
      wallId: 'w',
      distance: 1,
      width: 1,
      sill: 1,
      height: 1,
      jambCount: 1,
      headerId: 'h',
    },
  });
  await call({
    name: 'snippet.put',
    payload: {
      id: 'detail',
      name: 'Door',
      sheetId: 's',
      bounds: { x: 0, y: 0, width: 20, height: 20 },
      geometryIds: ['g'],
      sources: [{ kind: 'wall', id: 'w' }],
      annotations: [],
      note: 'Door detail',
    },
  });
  await call({
    name: 'review.mark',
    payload: {
      id: 'r',
      target: { kind: 'wall', id: 'w' },
      status: 'reviewed',
      note: 'Checked',
    },
  });
  await call({ name: 'notes.write', payload: { markdown: 'Door verified' } });
  const before = structuredClone(session.project);
  const result = await call({
    name: 'geometry.copy',
    payload: { id: 'g', newId: 'g2', dx: 0, dy: 5 },
  });
  const copied = Object.values(resolveConstruction(session.project).walls).find(
    (w) => w.geometryId === 'g2',
  );
  assert.ok(copied);
  const copiedOpenings = Object.values(
    session.project.construction?.openings ?? {},
  ).filter((o) => o.wallId === copied.id);
  assert.equal(copiedOpenings.length, 1);
  const copiedOpening = copiedOpenings[0];
  assert.ok(copiedOpening?.headerId);
  assert.notEqual(copiedOpening.id, 'o');
  assert.notEqual(copiedOpening.headerId, 'h');
  const header = session.project.construction?.headers[copiedOpening.headerId];
  assert.deepEqual(
    header?.components,
    before.construction?.headers.h?.components,
  );
  const condition = copied.conditions?.[0];
  assert.ok(condition);
  assert.notEqual(condition.id, 'end');
  assert.equal(condition.ownerWallId, copied.id);
  assert.deepEqual(result.data, {
    geometry: session.project.geometries.g2,
    groupIds: [copied.groupId],
    assignmentIds: [copied.assignmentId],
    applicationIds: [copied.id],
    openingIds: [copiedOpening.id],
    headerIds: [copiedOpening.headerId],
    conditionIds: [condition.id],
  });
  assert.deepEqual(session.project.review, before.review);
  assert.equal(session.project.notes, before.notes);
  const model = generateConstruction(
    session.project,
    resolveConstruction(session.project),
  );
  const schedule = (wallId: string) =>
    model.pieces
      .filter((piece) => piece.wallId === wallId)
      .map(({ materialId, role, cutLength }) => [materialId, role, cutLength]);
  assert.ok(schedule('w').length);
  assert.deepEqual(schedule(copied.id), schedule('w'));
  assert.deepEqual(
    inspectReview(session.project)
      .unreviewed.filter((target) => target.kind === 'wall')
      .map((target) => target.id),
    [copied.id],
  );
  const exported = executeCommand(session.project, {
    name: 'construction.export',
    payload: { format: 'csv', schedule: 'pieces' },
  }).data;
  assert.equal(typeof exported, 'string');
  assert.match(String(exported), /cutLength_ft/);
  await call({
    name: 'opening.put',
    payload: { ...copiedOpening, width: 1.5 },
  });
  assert.deepEqual(
    session.project.construction?.openings.o,
    before.construction?.openings.o,
  );
  await call({
    name: 'header.put',
    payload: { ...header, name: 'Changed copy' },
  });
  assert.deepEqual(
    session.project.construction?.headers.h,
    before.construction?.headers.h,
  );
  await call({ name: 'history.undo' });
  await call({ name: 'history.undo' });
  await call({ name: 'history.undo' });
  assert.deepEqual(session.project, {
    ...before,
    revision: session.project.revision,
  });
});

void test('copied junctions count members only when their owner is on the copied trace', async () => {
  for (const sameTrace of [false, true]) {
    const { session, call, wall } = fixture();
    const junction = {
      id: 'shared',
      kind: 'junction',
      distance: 0,
      count: 2,
      memberOffsets: [
        { along: 0, face: 0 },
        { along: 0.1, face: 0 },
      ],
    };
    await call({
      name: 'wall.put',
      payload: { ...wall, conditions: [junction] },
    });
    const geometryId = sameTrace ? 'g' : 'dependent-trace';
    if (!sameTrace)
      await call({
        name: 'geometry.put',
        payload: { ...session.project.geometries.g, id: geometryId },
      });
    await call({
      name: 'wall.put',
      payload: {
        ...wall,
        id: 'dependent',
        geometryId,
        conditions: [{ ...junction, ownerWallId: 'w' }],
      },
    });
    const before = resolveConstruction(session.project);
    const beforeModel = generateConstruction(session.project, before);
    assert.equal(beforeModel.complete, true);
    await call({
      name: 'geometry.copy',
      payload: { id: geometryId, newId: 'copy', dx: 17 },
    });
    const after = resolveConstruction(session.project);
    const model = generateConstruction(session.project, after);
    assert.equal(model.complete, true);
    for (const id of ['w', 'dependent']) {
      assert.deepEqual(after.walls[id], before.walls[id]);
      assert.deepEqual(
        model.pieces.filter((p) => p.wallId === id),
        beforeModel.pieces.filter((p) => p.wallId === id),
      );
    }
    const copies = Object.values(after.walls).filter(
      (w) => w.geometryId === 'copy',
    );
    const dependent = copies.find(
      (w) => w.assignmentId === before.walls.dependent?.assignmentId,
    );
    assert.ok(dependent);
    const condition = dependent.conditions?.[0];
    const studs = (geometry: string) =>
      model.pieces.filter(
        (p) =>
          p.geometryId === geometry && p.materialId === wall.stud.materialId,
      ).length;
    if (sameTrace) {
      const owner = copies.find(
        (w) => w.assignmentId === before.walls.w?.assignmentId,
      );
      assert.ok(owner);
      assert.ok(condition);
      assert.notEqual(condition.id, 'shared');
      assert.equal(condition.ownerWallId, owner.id);
      assert.equal(condition.id, owner.conditions?.[0]?.id);
      assert.equal(condition.count, 2);
      assert.equal(studs('copy'), studs(geometryId));
    } else {
      // Away from the wall that supplied its end members, the copy stands
      // free and frames that end with its own stud.
      assert.equal(condition, undefined);
      assert.equal(studs('copy'), studs(geometryId) + 1);
    }
  }
});

void test('ordinary quantities, exact piece exports and preview deltas share positioned results', async () => {
  const { session, call, wall } = fixture();
  await call({ name: 'wall.put', payload: wall });
  const { calculateProject, pieceSchedule } =
    await import('../../src/core/calculations');
  const { quantityChanges } = await import('../../src/core/quantity-changes');
  const before = calculateProject(session.project);
  assert.equal(
    before.totals.find((total) => total.materialId === 'stud')?.amount,
    13,
  );
  assert.ok(
    Math.abs(
      (before.totals.find((total) => total.materialId === 'board')?.amount ??
        0) - 36,
    ) < 1e-7,
  );
  assert.equal(
    pieceSchedule(session.project).filter((row) => row.role === 'stud').length,
    13,
  );
  await call({ name: 'wall.put', payload: { ...wall, height: 2.5 } });
  const changes = quantityChanges(before, calculateProject(session.project));
  assert.ok(
    Math.abs(
      (changes.find((change) => change.materialId === 'board')?.delta ?? 0) + 6,
    ) < 1e-7,
  );
});

void test('review follows linked header evidence and relevant levels, independent of record insertion order', async () => {
  const { session, call, wall } = fixture();
  await call({
    name: 'level.put',
    payload: { id: 'first', name: 'First floor', elevation: 0 },
  });
  await call({
    name: 'level.put',
    payload: { id: 'second', name: 'Second floor', elevation: 4 },
  });
  await call({ name: 'wall.put', payload: { ...wall, levelId: 'first' } });
  await call({
    name: 'header.put',
    payload: {
      id: 'h',
      name: 'H1',
      components: [
        {
          id: 'web',
          role: 'header',
          member: wall.stud,
          startExtension: 0,
          endExtension: 0,
          verticalOffset: 0.05,
          faceOffset: 0,
        },
      ],
    },
  });
  await call({
    name: 'opening.put',
    payload: {
      id: 'o',
      wallId: 'w',
      distance: 1,
      width: 1,
      sill: 0,
      height: 2,
      jambCount: 1,
      headerId: 'h',
    },
  });
  const target = { kind: 'wall' as const, id: 'w' };
  await call({
    name: 'review.mark',
    payload: { id: 'checked', target, status: 'reviewed', note: 'Checked' },
  });
  await call({
    name: 'level.put',
    payload: { id: 'second', name: 'Second floor', elevation: 5 },
  });
  assert.equal(
    inspectReview(session.project).marks[0]?.effectiveStatus,
    'reviewed',
  );
  for (const id of ['z', 'a'])
    await call({
      name: 'snippet.put',
      payload: {
        id,
        name: id,
        sheetId: 's',
        bounds: { x: 0, y: 0, width: 20, height: 20 },
        geometryIds: [],
        sources: [{ kind: 'header', id: 'h' }],
        annotations: [],
        note: '',
      },
    });
  assert.equal(
    inspectReview(session.project).marks[0]?.effectiveStatus,
    'changed',
  );
  const reordered = structuredClone(session.project);
  assert.ok(reordered.review);
  reordered.review.snippets = Object.fromEntries(
    Object.entries(reordered.review.snippets).reverse(),
  );
  assert.equal(
    reviewFingerprint(reordered, target),
    reviewFingerprint(session.project, target),
  );
  await call({
    name: 'review.mark',
    payload: {
      id: 'checked',
      target,
      status: 'reviewed',
      note: 'Updated detail checked',
    },
  });
  await call({
    name: 'level.put',
    payload: { id: 'first', name: 'First floor', elevation: 0.1 },
  });
  assert.equal(
    inspectReview(session.project).marks[0]?.effectiveStatus,
    'changed',
  );
});

void test('reviewed shared members become changed when their owner moves, changes scale or changes level', async () => {
  const { session, call, wall } = fixture();
  const sheet = session.project.sheets.s;
  assert.ok(sheet);
  await call({
    name: 'sheet.put',
    payload: { ...sheet, id: 'dependent-sheet' },
  });
  await call({
    name: 'level.put',
    payload: { id: 'owner-level', name: 'Owner level', elevation: 0 },
  });
  const condition = { id: 'shared', distance: 0, kind: 'junction', count: 1 };
  await call({
    name: 'wall.put',
    payload: { ...wall, levelId: 'owner-level', conditions: [condition] },
  });
  await call({
    name: 'geometry.put',
    payload: {
      id: 'dependent-trace',
      sheetId: 'dependent-sheet',
      name: 'Dependent wall',
      kind: 'path',
      points: [
        { x: 10, y: 10 },
        { x: 10, y: 16 },
      ],
    },
  });
  await call({
    name: 'wall.put',
    payload: {
      ...wall,
      id: 'dependent',
      geometryId: 'dependent-trace',
      conditions: [{ ...condition, ownerWallId: 'w' }],
    },
  });
  await call({
    name: 'review.mark',
    payload: {
      id: 'checked',
      target: { kind: 'wall', id: 'dependent' },
      status: 'reviewed',
      note: 'Shared junction checked',
    },
  });
  const model = () =>
    generateConstruction(session.project, resolveConstruction(session.project));
  assert.equal(model().complete, true);
  const changes: CommandCall[] = [
    { name: 'geometry.move', payload: { ids: ['g'], dx: 1, dy: 0 } },
    {
      name: 'sheet.put',
      payload: { ...sheet, calibration: { feetPerUnit: 2 } },
    },
    {
      name: 'level.put',
      payload: { id: 'owner-level', name: 'Owner level', elevation: 1 },
    },
  ];
  for (const change of changes) {
    await call(change);
    assert.ok(
      model().diagnostics.some(
        (diagnostic) =>
          diagnostic.wallId === 'dependent' &&
          diagnostic.code === 'shared-member-mismatch',
      ),
    );
    assert.equal(
      inspectReview(session.project).marks[0]?.effectiveStatus,
      'changed',
      change.name,
    );
    await call({ name: 'history.undo' });
    assert.equal(
      inspectReview(session.project).marks[0]?.effectiveStatus,
      'reviewed',
    );
  }
});

void test('construction material CSV includes every displayed surface and preserves finish purchasing', async () => {
  const { session, call, wall } = fixture();
  await call({
    name: 'wall.put',
    payload: {
      ...wall,
      finishes: [{ ...wall.finishes[0], wastePercent: 10, packageSize: 4 }],
    },
  });
  await call({
    name: 'geometry.put',
    payload: {
      id: 'ceiling-area',
      name: 'Ceiling',
      sheetId: 's',
      kind: 'area',
      points: [
        { x: 20, y: 20 },
        { x: 22, y: 20 },
        { x: 22, y: 22 },
        { x: 20, y: 22 },
      ],
    },
  });
  await call({
    name: 'ceiling.put',
    payload: {
      id: 'ceiling',
      geometryId: 'ceiling-area',
      elevation: 2.7,
      materialId: 'ceiling-tile',
      layers: 1,
    },
  });
  const exported = exportConstruction(session.project, 'csv', 'materials');
  assert.ok(exported.includes('"board","ft2","","36","40","10","true"'));
  assert.ok(
    exportConstruction(session.project, 'csv', 'materials').includes(
      '"ceiling-tile","ft2","","4","4","","true"',
    ),
  );
});

void test('review tracks live assembly changes without invalidating another trace for a local override', async () => {
  const { session, call, wall } = fixture();
  await call({ name: 'wall.put', payload: wall });
  const applied = resolveConstruction(session.project).walls.w;
  assert.ok(applied?.assignmentId && applied.groupId && applied.recipeId);
  await call({
    name: 'geometry.put',
    payload: {
      ...session.project.geometries.g,
      id: 'second-trace',
      points: [
        { x: 10, y: 15 },
        { x: 16, y: 15 },
      ],
    },
  });
  await call({
    name: 'group.members',
    payload: { id: applied.groupId, geometryIds: ['g', 'second-trace'] },
  });
  const secondId = `${applied.assignmentId}/second-trace`;
  for (const id of ['w', secondId])
    await call({
      name: 'review.mark',
      payload: {
        id,
        target: { kind: 'wall', id },
        status: 'reviewed',
        note: '',
      },
    });
  const assignment = session.project.assignments[applied.assignmentId];
  assert.ok(assignment);
  await call({
    name: 'assignment.put',
    payload: {
      ...assignment,
      geometryDetails: {
        ...assignment.geometryDetails,
        'second-trace': { wall: { height: 2.5 } },
      },
    },
  });
  const status = (id: string) =>
    inspectReview(session.project).marks.find((mark) => mark.target.id === id)
      ?.effectiveStatus;
  assert.equal(status('w'), 'reviewed');
  assert.equal(status(secondId), 'changed');
  const recipe = session.project.recipes[applied.recipeId];
  assert.ok(recipe?.wallTemplate);
  await call({
    name: 'assembly.put',
    payload: {
      ...recipe,
      wallTemplate: { ...recipe.wallTemplate, height: 2.8 },
    },
  });
  assert.equal(resolveConstruction(session.project).walls.w?.height, 2.8);
  assert.equal(
    resolveConstruction(session.project).walls[secondId]?.height,
    2.5,
  );
  assert.equal(status('w'), 'changed');
});
