import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Application } from '../../src/app/application';
import { dispatchCli } from '../../src/app/cli';
import { ProjectSession } from '../../src/core/session';
import { importFixture } from '../fixtures/quantity-project';

function fixture() {
  const app = new Application(false);
  app.session = new ProjectSession(importFixture(), {
    save: () => Promise.resolve(),
  });
  const cli = (name: string, payload: object = {}, envelope: object = {}) =>
    dispatchCli(app, [name], JSON.stringify({ payload, ...envelope }));
  return { app, cli };
}

void test('preview reports draft completeness and diagnostics with an optional project', async () => {
  const { app, cli } = fixture();
  const commands = [
    { name: 'project.rename', payload: { name: 'Draft' } },
    { name: 'notes.read' },
  ];
  const compact = await cli('preview', { commands });
  assert.equal(compact.exitCode, 0);
  assert.ok('data' in compact.response);
  const data = compact.response.data as {
    diagnostics: { assignmentId: string; outputId: string; message: string }[];
    data: unknown[];
    quantityChanges: unknown[];
    calculationComplete: boolean;
    constructionComplete: boolean;
  };
  assert.equal('project' in data, false);
  assert.equal(data.data.length, 2);
  assert.deepEqual(data.quantityChanges, []);
  assert.equal(data.calculationComplete, false);
  assert.equal(data.constructionComplete, true);
  assert.ok(
    data.diagnostics.some(
      (d) =>
        d.assignmentId === 'finish' &&
        d.outputId === 'gyp' &&
        d.message.includes('height'),
    ),
  );
  const full = await cli('preview', { commands, includeProject: true });
  assert.ok('data' in full.response && app.session);
  assert.deepEqual(full.response.data, {
    ...data,
    project: { ...app.session.project, name: 'Draft' },
  });
  assert.equal(app.project?.name, 'Quantity contract');
});

void test('mutation conflicts distinguish missing guards, stale edits and another project', async () => {
  const { app, cli } = fixture();
  const observed = app.observe();
  const cases: [object, RegExp][] = [
    [{}, /Missing projectId and expectedRevision/],
    [{ projectId: observed.projectId }, /Missing expectedRevision/],
    [{ expectedRevision: 0 }, /Missing projectId/],
    [
      { ...observed, expectedRevision: -1 },
      /Stale expectedRevision.*Reread the records.*merge/,
    ],
    [
      { projectId: 'other' },
      /requested projectId other.*Stop and reconnect to the intended project/,
    ],
  ];
  for (const [envelope, message] of cases) {
    const result = await cli('project.rename', { name: 'Edit' }, envelope);
    assert.equal(result.exitCode, 3);
    assert.ok('error' in result.response);
    assert.equal(result.response.error.code, 'PROJECT_CONFLICT');
    assert.match(result.response.error.message, message);
    assert.equal(result.response.projectId, observed.projectId);
    assert.equal(result.response.revision, observed.expectedRevision);
  }
  assert.equal(app.project?.name, 'Quantity contract');
});

void test('project reads and file commands honor each optional observation guard at execution', async () => {
  const { app, cli } = fixture();
  const { projectId, expectedRevision } = app.observe();
  const calls: [string, object][] = [
    ['connect', {}],
    ['project.inspect', {}],
    ['takeoff.list', {}],
    ['sheet.naming.read', {}],
    ['preview', { commands: [] }],
    ['quantities.export', { format: 'json' }],
    ['quantities.exportEstiMaker', { path: 'estimate.json' }],
    ['project.backup', { path: 'copy.bluewing' }],
    ['sheet.render', { sheetId: 's', path: 'plan.png' }],
    ['snippet.render', { id: 'snippet', path: 'detail.png' }],
    ['construction.render', { path: 'model.png' }],
    ['performance.export', { path: 'report.json' }],
  ];
  for (const [name, payload] of calls) {
    for (const envelope of [
      { projectId: 'wrong' },
      { expectedRevision: expectedRevision + 1 },
    ]) {
      const { response, exitCode } = await cli(name, payload, envelope);
      assert.equal(exitCode, 3, name);
      assert.ok('error' in response);
      assert.equal(response.error.code, 'PROJECT_CONFLICT');
      assert.equal(response.projectId, projectId);
      assert.equal(response.revision, expectedRevision);
    }
  }
  for (const envelope of [{}, { projectId }, { expectedRevision }])
    assert.equal((await cli('sheet.naming.read', {}, envelope)).exitCode, 0);
  const edit = cli('project.rename', { name: 'Later' }, app.observe());
  const read = cli('takeoff.list', {}, { expectedRevision });
  assert.equal((await edit).exitCode, 0);
  assert.equal((await read).exitCode, 3);
});

void test('batch identifies an invalid, unknown or standalone child and rolls back', async () => {
  const { app, cli } = fixture();
  const first = { name: 'project.rename', payload: { name: 'Unsaved' } };
  const cases: [object, RegExp][] = [
    [
      { name: 'geometry.move', payload: {} },
      /commands\[1\] \(geometry.move\).*required/,
    ],
    [
      { name: 'geometry.move', payload: 1 },
      /commands\[1\] \(geometry.move\).*must be an object/,
    ],
    [
      { name: 'geometry.delete', payload: { id: 'absent' } },
      /commands\[1\] \(geometry.delete\).*not found/,
    ],
    [{ name: 'invented' }, /commands\[1\] \(invented\).*Unknown command/],
    [
      { name: 'assembly.import' },
      /commands\[1\] \(assembly.import\).*on its own before the batch/,
    ],
  ];
  for (const [child, message] of cases) {
    const { response, exitCode } = await cli(
      'batch',
      { commands: [first, child] },
      app.observe(),
    );
    assert.equal(exitCode, 1);
    assert.ok('error' in response);
    assert.match(response.error.message, message);
    assert.equal(app.project?.name, 'Quantity contract');
    assert.equal(app.session?.canUndo, false);
  }
});

void test('opening a project is not blocked by a guard from the previous project', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: { invoke: () => Promise.resolve(null) } },
  });
  try {
    const app = new Application(true);
    const project = importFixture();
    Object.assign(app.storage, {
      open: () => Promise.resolve(),
      load: () => Promise.resolve(project),
    });
    const opened = await dispatchCli(
      app,
      ['project.open'],
      JSON.stringify({
        payload: { path: 'job' },
        projectId: 'previous-project',
        expectedRevision: 9,
      }),
    );
    assert.equal(opened.exitCode, 0);
    assert.equal(app.project?.id, project.id);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
