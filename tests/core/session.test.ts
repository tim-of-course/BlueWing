import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProjectConflictError, ProjectSession } from '../../src/core/session';
import type { CommandCall, Project } from '../../src/core/types';

function project(): Project {
  return {
    formatVersion: 4,
    id: 'project',
    name: 'Original',
    revision: 0,
    sheets: {},
    geometries: {},
    groups: {},
    recipes: {},
    assignments: {},
  };
}
function request(session: ProjectSession, call: CommandCall) {
  return {
    ...call,
    ...session.observation,
    origin: 'cli',
  };
}
function fixture(historyLimit = 50) {
  const saves: { before: Project; after: Project }[] = [];
  let fail = false;
  const session = new ProjectSession(
    project(),
    {
      save: (before, after) => {
        if (fail) return Promise.reject(new Error('disk full'));
        saves.push({ before, after });
        return Promise.resolve();
      },
    },
    historyLimit,
  );
  return {
    session,
    saves,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

async function countProjectClones(operation: () => Promise<unknown>) {
  const clone = globalThis.structuredClone;
  let count = 0;
  globalThis.structuredClone = (value, options) => {
    if (value && typeof value === 'object' && 'formatVersion' in value) count++;
    return clone(value, options);
  };
  try {
    await operation();
    return count;
  } finally {
    globalThis.structuredClone = clone;
  }
}

void test('save precedes publication, snapshots and submitted requests are isolated', async () => {
  let release: (() => void) | undefined;
  const saving = new Promise<void>((resolve) => {
    release = resolve;
  });
  const session = new ProjectSession(project(), { save: () => saving });
  const published: string[] = [];
  session.subscribe((next) => {
    published.push(next.name);
    next.name = 'tampered';
  });
  const call = request(session, {
    name: 'project.rename',
    payload: { name: 'Saved' },
  });
  const operation = session.dispatch(call);
  call.payload = { name: 'Changed after submission' };
  await Promise.resolve();
  assert.equal(session.project.name, 'Original');
  assert.deepEqual(session.observation, {
    projectId: 'project',
    expectedRevision: 0,
  });
  assert.deepEqual(published, []);
  release?.();
  await operation;
  assert.equal(session.project.name, 'Saved');
  assert.deepEqual(session.observation, {
    projectId: 'project',
    expectedRevision: 1,
  });
  assert.deepEqual(published, ['Saved']);
  const snapshot = session.project;
  snapshot.name = 'tampered';
  assert.equal(session.project.name, 'Saved');
  const observation = session.observation;
  observation.projectId = 'tampered';
  observation.expectedRevision = 500;
  assert.deepEqual(session.observation, {
    projectId: 'project',
    expectedRevision: 1,
  });
});

void test('adapter and subscriber code cannot corrupt accepted state or report a committed edit as failed', async () => {
  const session = new ProjectSession(project(), {
    save: (before, after) => {
      before.name = 'mutated previous';
      after.name = 'mutated next';
      return Promise.resolve();
    },
  });
  session.subscribe(() => {
    throw new Error('broken subscriber');
  });
  let observed = '';
  session.subscribe((next) => {
    observed = next.name;
  });
  await session.dispatch(
    request(session, { name: 'project.rename', payload: { name: 'Accepted' } }),
  );
  assert.equal(session.project.name, 'Accepted');
  assert.equal(observed, 'Accepted');
  assert.equal(session.canUndo, true);
});

void test('queued requests check identity and revision against the latest saved state', async () => {
  const { session, saves } = fixture();
  const first = session.dispatch(
    request(session, { name: 'project.rename', payload: { name: 'First' } }),
  );
  const second = session.dispatch(
    request(session, { name: 'project.rename', payload: { name: 'Stale' } }),
  );
  await first;
  await assert.rejects(second, ProjectConflictError);
  await assert.rejects(
    session.dispatch({
      name: 'project.inspect',
      projectId: 'other',
      expectedRevision: 1,
    }),
    ProjectConflictError,
  );
  assert.equal(saves.length, 1);
  await session.dispatch(
    request(session, { name: 'project.rename', payload: { name: 'Next' } }),
  );
  assert.equal(session.project.revision, 2);
});

void test('save failure preserves state and history including failed undo and redo', async () => {
  const f = fixture();
  f.fail(true);
  await assert.rejects(
    f.session.dispatch(
      request(f.session, {
        name: 'project.rename',
        payload: { name: 'Failed' },
      }),
    ),
    /disk full/,
  );
  assert.equal(f.session.project.name, 'Original');
  assert.equal(f.session.canUndo, false);
  f.fail(false);
  await f.session.dispatch(
    request(f.session, { name: 'project.rename', payload: { name: 'Saved' } }),
  );
  f.fail(true);
  await assert.rejects(
    f.session.dispatch(request(f.session, { name: 'history.undo' })),
    /disk full/,
  );
  assert.equal(f.session.project.revision, 1);
  assert.equal(f.session.canUndo, true);
  assert.equal(f.session.canRedo, false);
  f.fail(false);
  await f.session.dispatch(request(f.session, { name: 'history.undo' }));
  assert.equal(f.session.project.name, 'Original');
  assert.equal(f.session.project.revision, 2);
  f.fail(true);
  await assert.rejects(
    f.session.dispatch(request(f.session, { name: 'history.redo' })),
    /disk full/,
  );
  assert.equal(f.session.canRedo, true);
  assert.equal(f.session.project.name, 'Original');
  f.fail(false);
  await f.session.dispatch(request(f.session, { name: 'history.redo' }));
  assert.equal(f.session.project.name, 'Saved');
  assert.equal(f.session.project.revision, 3);
  assert.deepEqual(
    f.saves.map(({ before, after }) => [before.revision, after.revision]),
    [
      [0, 1],
      [1, 2],
      [2, 3],
    ],
  );
});

void test('batch rollback, final-state validation, and one undo step', async () => {
  const { session, saves } = fixture();
  await assert.rejects(
    session.dispatch(
      request(session, {
        name: 'batch',
        payload: {
          commands: [
            { name: 'project.rename', payload: { name: 'Lost' } },
            { name: 'geometry.delete', payload: { id: 'missing' } },
          ],
        },
      }),
    ),
    /not found/,
  );
  assert.equal(session.project.name, 'Original');
  assert.equal(saves.length, 0);
  await assert.rejects(
    session.dispatch(
      request(session, {
        name: 'batch',
        payload: {
          commands: [
            {
              name: 'project.rename',
              payload: { name: 'Invalid final state' },
            },
            {
              name: 'group.put',
              payload: { id: 'g', name: 'Group', geometryIds: ['missing'] },
            },
          ],
        },
      }),
    ),
    /not found/,
  );
  assert.equal(session.project.name, 'Original');
  assert.equal(saves.length, 0);
  await session.dispatch(
    request(session, {
      name: 'batch',
      payload: {
        commands: [
          {
            name: 'group.put',
            payload: { id: 'g', name: 'Group', geometryIds: ['geom'] },
          },
          {
            name: 'geometry.put',
            payload: {
              id: 'geom',
              name: 'Markers',
              sheetId: 's',
              kind: 'count',
              points: [{ x: 0, y: 0 }],
            },
          },
          {
            name: 'sheet.put',
            payload: {
              id: 's',
              name: 'Sheet',
              assetId: 'asset',
              pageIndex: 0,
              width: 100,
              height: 100,
            },
          },
        ],
      },
    }),
  );
  assert.equal(saves.length, 1);
  assert.equal(session.project.revision, 1);
  await session.dispatch(request(session, { name: 'history.undo' }));
  assert.deepEqual(session.project.groups, {});
  assert.deepEqual(session.project.sheets, {});
  assert.deepEqual(session.project.geometries, {});
  assert.equal(session.canUndo, false);
  await session.dispatch(request(session, { name: 'history.redo' }));
  assert.deepEqual(session.project.groups.g?.geometryIds, ['geom']);
});

void test('preview computes temporary results without saving, publication, revision, or history', async () => {
  const { session, saves } = fixture();
  let notifications = 0;
  session.subscribe(() => {
    notifications++;
  });
  const result = await session.dispatch(
    request(session, {
      name: 'preview',
      payload: {
        commands: [
          { name: 'project.rename', payload: { name: 'Preview' } },
          { name: 'project.inspect' },
        ],
      },
    }),
  );
  assert.equal(result.project.name, 'Preview');
  assert.equal(result.preview, true);
  assert.equal(result.project.revision, 0);
  assert.equal(session.project.name, 'Original');
  assert.equal(saves.length, 0);
  assert.equal(session.canUndo, false);
  assert.equal(notifications, 0);
  await assert.rejects(
    session.dispatch(
      request(session, {
        name: 'batch',
        payload: { commands: [{ name: 'history.undo' }] },
      }),
    ),
    /session control/,
  );
});

void test('history is bounded, carries origin, and fresh edits clear redo', async () => {
  const { session } = fixture(1);
  for (const name of ['One', 'Two'])
    await session.dispatch(
      request(session, { name: 'project.rename', payload: { name } }),
    );
  assert.deepEqual(session.history.undo, [
    { label: 'project.rename', origin: 'cli' },
  ]);
  await session.dispatch(request(session, { name: 'history.undo' }));
  assert.equal(session.project.name, 'One');
  assert.equal(session.canUndo, false);
  await session.dispatch(
    request(session, { name: 'project.rename', payload: { name: 'Three' } }),
  );
  assert.equal(session.canRedo, false);
  const reopened = new ProjectSession(session.project, {
    save: () => Promise.resolve(),
  });
  assert.equal(reopened.canUndo, false);
  assert.equal(reopened.canRedo, false);
});

void test('batches use one draft regardless of command count and capture sequential results', async () => {
  for (const count of [1, 10, 100]) {
    const { session, saves } = fixture();
    const commands: CommandCall[] = Array.from({ length: count }, (_, i) => ({
      name: 'sheet.put',
      payload: {
        id: `sheet-${String(i)}`,
        name: 'Sheet',
        assetId: 'asset',
        pageIndex: i,
        width: 100,
        height: 100,
      },
    }));
    const clones = await countProjectClones(() =>
      session.dispatch(
        request(session, { name: 'batch', payload: { commands } }),
      ),
    );
    assert.equal(clones, 4, `project clones for ${String(count)} commands`);
    assert.equal(saves.length, 1);
    assert.equal(Object.keys(session.project.sheets).length, count);
  }

  const { session } = fixture();
  const result = await session.dispatch(
    request(session, {
      name: 'batch',
      payload: {
        commands: [
          { name: 'project.inspect' },
          {
            name: 'group.put',
            payload: { id: 'g', name: 'Before', geometryIds: [] },
          },
          { name: 'group.copy', payload: { id: 'g', newId: 'copy' } },
          {
            name: 'group.put',
            payload: { id: 'copy', name: 'After', geometryIds: [] },
          },
          { name: 'project.rename', payload: { name: 'Renamed' } },
          { name: 'project.inspect' },
        ],
      },
    }),
  );
  const results = result.data as [
    Project,
    null,
    { name: string },
    null,
    null,
    Project,
  ];
  assert.equal(results[0].name, 'Original');
  assert.deepEqual(results[0].groups, {});
  assert.equal(results[2].name, 'Before copy');
  assert.equal(results[5].name, 'Renamed');
  assert.equal(results[5].groups.copy?.name, 'After');
  assert.equal(result.project.revision, 1);
  assert.ok(results[5].groups.copy);
  results[5].groups.copy.name = 'tampered';
  assert.equal(result.project.groups.copy?.name, 'After');
  assert.equal(session.project.groups.copy?.name, 'After');
  await session.dispatch(request(session, { name: 'history.undo' }));
  assert.deepEqual(session.project.groups, {});
});

void test('read commands and metadata paths avoid draft copies and retain isolated results', async () => {
  const { session, saves } = fixture();
  const clones = await countProjectClones(async () => {
    assert.equal(session.observation.expectedRevision, 0);
    assert.equal(session.history.undo.length, 0);
    const result = await session.dispatch(
      request(session, { name: 'project.inspect' }),
    );
    const inspected = result.data as Project;
    inspected.name = 'mutated data';
    assert.equal(result.project.name, 'Original');
    result.project.name = 'mutated result';
  });
  assert.equal(clones, 2);
  assert.equal(session.project.name, 'Original');
  assert.equal(saves.length, 0);
  const renameClones = await countProjectClones(() =>
    session.dispatch(
      request(session, {
        name: 'project.rename',
        payload: { name: 'Renamed' },
      }),
    ),
  );
  assert.equal(renameClones, 3);
  assert.equal(session.project.name, 'Renamed');
});

void test('rename history skips unchanged records and extension snapshots', async () => {
  const initial = project();
  initial.construction = {
    openings: {},
    headers: {},
    levels: { floor: { id: 'floor', name: 'Floor', elevation: 0 } },
    placements: {},
  };
  initial.review = { snippets: {}, marks: {} };
  const session = new ProjectSession(initial, {
    save: () => Promise.resolve(),
  });
  const clone = globalThis.structuredClone;
  const stringify = JSON.stringify;
  let reviewCopies = 0;
  let constructionCopies = 0;
  let comparisons = 0;
  globalThis.structuredClone = (value, options) => {
    if (value && typeof value === 'object') {
      if ('snippets' in value && 'marks' in value) reviewCopies++;
      if ('openings' in value && 'levels' in value) constructionCopies++;
    }
    return clone(value, options);
  };
  JSON.stringify = new Proxy(stringify, {
    apply(target, thisArg: unknown, args: unknown[]) {
      comparisons++;
      return Reflect.apply(target, thisArg, args) as string;
    },
  });
  try {
    await session.dispatch(
      request(session, {
        name: 'project.rename',
        payload: { name: 'Renamed' },
      }),
    );
  } finally {
    globalThis.structuredClone = clone;
    JSON.stringify = stringify;
  }
  assert.equal(comparisons, 0);
  assert.equal(reviewCopies, 0);
  // Full validation resolves construction once, then again to validate review.
  assert.equal(constructionCopies, 2);
  await session.dispatch(request(session, { name: 'history.undo' }));
  assert.deepEqual(session.project.construction, initial.construction);
  assert.deepEqual(session.project.review, initial.review);
  await session.dispatch(request(session, { name: 'history.redo' }));
  assert.equal(session.project.name, 'Renamed');
});

void test('extension history distinguishes an absent extension from an unchanged one', async () => {
  const initial = project();
  initial.sheets.s = {
    id: 's',
    name: 'Sheet',
    assetId: 'asset',
    pageIndex: 0,
    width: 100,
    height: 100,
  };
  initial.geometries.g = {
    id: 'g',
    name: 'Count',
    sheetId: 's',
    kind: 'count',
    points: [{ x: 0, y: 0 }],
  };
  const session = new ProjectSession(initial, {
    save: () => Promise.resolve(),
  });
  await session.dispatch(
    request(session, {
      name: 'level.put',
      payload: { id: 'floor', name: 'Floor', elevation: 0 },
    }),
  );
  await session.dispatch(
    request(session, { name: 'project.rename', payload: { name: 'Renamed' } }),
  );
  await session.dispatch(request(session, { name: 'history.undo' }));
  assert.equal(session.project.name, 'Original');
  assert.equal(session.project.construction?.levels.floor?.elevation, 0);
  await session.dispatch(request(session, { name: 'history.undo' }));
  assert.equal(Object.hasOwn(session.project, 'construction'), false);
  await session.dispatch(request(session, { name: 'history.redo' }));
  assert.equal(session.project.construction.levels.floor.elevation, 0);

  await session.dispatch(
    request(session, {
      name: 'review.mark',
      payload: {
        id: 'mark',
        target: { kind: 'geometry', id: 'g' },
        status: 'needs-review',
        note: 'Check',
      },
    }),
  );
  await session.dispatch(
    request(session, {
      name: 'level.put',
      payload: { id: 'floor', name: 'Floor', elevation: 2 },
    }),
  );
  await session.dispatch(request(session, { name: 'history.undo' }));
  assert.equal(session.project.review?.marks.mark?.note, 'Check');
  await session.dispatch(request(session, { name: 'history.undo' }));
  assert.equal(Object.hasOwn(session.project, 'review'), false);
  await session.dispatch(request(session, { name: 'history.redo' }));
  assert.equal(session.project.review.marks.mark.note, 'Check');
});
