import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../src/app/application';
import { ProjectSession } from '../../src/core/session';
import { createProject } from '../../src/core/geometry';
import { parseCli } from '../../src/app/cli';

void test('CLI selection persists independently of UI, supports one-request overrides and shares page scale', async () => {
  const project = createProject('Context');
  project.sheets.s = {
    id: 's',
    name: 'Plan',
    assetId: 'pdf',
    pageIndex: 0,
    width: 100,
    height: 100,
    calibration: { metresPerUnit: 1 },
  };
  const app = new Application(false);
  app.session = new ProjectSession(project, { save: () => Promise.resolve() });
  await app.dispatch({
    ...app.observe(),
    name: 'takeoff.create',
    payload: { id: 'co', name: 'CO', kind: 'change-order' },
    origin: 'cli',
  });
  app.selectTakeoff('co');
  const initial = await app.dispatch(parseCli(['quantities.inspect']));
  assert.equal(initial.takeoff?.id, 'main');
  const selected = await app.dispatch(
    parseCli(['takeoff.select', '{"payload":{"id":"co"}}']),
  );
  assert.equal(selected.takeoff?.id, 'co');
  const revision = app.observe().expectedRevision;
  app.selectTakeoff('main');
  assert.equal(
    (await app.dispatch(parseCli(['quantities.inspect']))).takeoff?.id,
    'co',
  );
  assert.equal(
    (
      await app.dispatch(
        parseCli(['quantities.inspect', '{"takeoffId":"main"}']),
      )
    ).takeoff?.id,
    'main',
  );
  assert.equal(
    (await app.dispatch(parseCli(['quantities.inspect']))).takeoff?.id,
    'co',
  );
  assert.equal(app.observe().expectedRevision, revision);
  await assert.rejects(
    app.dispatch(parseCli(['takeoff.select', '{"payload":{"id":"missing"}}'])),
  );
  assert.equal(app.cliTakeoffId, 'co');
  app.selectTakeoff('co');
  await app.dispatch({
    ...app.observe(),
    name: 'sheet.put',
    takeoffId: 'co',
    payload: {
      ...project.sheets.s,
      name: 'Shared name',
      calibration: { metresPerUnit: 2 },
    },
    origin: 'cli',
  });
  assert.equal(app.session.project.sheets.s?.calibration?.metresPerUnit, 2);
  assert.equal(app.project?.sheets.s?.calibration?.metresPerUnit, 2);
  const main = await app.dispatch(
    parseCli(['takeoff.inspect', '{"takeoffId":"main"}']),
  );
  assert.equal(main.takeoff?.id, 'main');
  assert.equal(app.activeTakeoffId, 'co');
  const co = await app.dispatch(
    parseCli(['quantities.inspect', '{"takeoffId":"co"}']),
  );
  assert.equal(co.takeoff?.id, 'co');
  app.draftPending = true;
  assert.throws(() => {
    app.selectTakeoff('main');
  }, /Finish or cancel/);
  app.draftPending = false;
  app.selectTakeoff('main');
  assert.equal(app.activeTakeoffId, 'main');
  await app.dispatch({
    ...app.observe(),
    name: 'takeoff.delete',
    payload: { id: 'co' },
    origin: 'cli',
  });
  assert.equal(
    (await app.dispatch(parseCli(['quantities.inspect']))).takeoff?.id,
    'main',
  );
});
