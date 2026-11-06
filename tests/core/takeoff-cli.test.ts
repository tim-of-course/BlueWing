import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from '../../src/app/application';
import { ProjectSession } from '../../src/core/session';
import { createProject } from '../../src/core/geometry';
import { parseCli } from '../../src/app/cli';

void test('CLI requires explicit takeoff context, ignores active UI selection and keeps Main scale isolated', async () => {
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
  await assert.rejects(
    app.dispatch(parseCli(['quantities.inspect'])),
    /Explicit takeoffId/,
  );
  await assert.rejects(
    app.dispatch({
      ...app.observe(),
      name: 'sheet.put',
      payload: project.sheets.s,
      origin: 'cli',
    }),
    /Explicit takeoffId/,
  );
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
  assert.equal(app.session.project.sheets.s?.calibration?.metresPerUnit, 1);
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
});
