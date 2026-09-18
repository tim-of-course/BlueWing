import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import { ProjectConflictError, ProjectSession } from '../../src/core/session';

void test('reviewed sheet renames save atomically, preserve sheet data, and undo together', async () => {
  const project = createProject('Plans');
  for (const [pageIndex, id] of ['one', 'two', 'unselected'].entries()) {
    project.sheets[id] = {
      id,
      assetId: 'pdf',
      pageIndex,
      name: `Page ${String(pageIndex + 1)}`,
      width: 1000,
      height: 800,
      rotation: 90,
      calibration: { metresPerUnit: 0.1 },
    };
  }
  let saves = 0;
  let fail = true;
  const session = new ProjectSession(project, {
    save: () => {
      if (fail) return Promise.reject(new Error('Disk full'));
      saves += 1;
      return Promise.resolve();
    },
  });
  const observation = {
    projectId: project.id,
    expectedRevision: project.revision,
  };
  const batch = {
    ...observation,
    name: 'batch',
    origin: 'ui',
    payload: {
      commands: [
        {
          name: 'sheet.put',
          payload: { ...project.sheets.one, name: 'A1.0 · FLOOR PLAN' },
        },
        {
          name: 'sheet.put',
          payload: { ...project.sheets.two, name: 'A2.0 · CEILING PLAN' },
        },
      ],
    },
  };
  await assert.rejects(session.dispatch(batch), /Disk full/);
  assert.deepEqual(session.project.sheets, project.sheets);
  fail = false;
  await session.dispatch(batch);
  assert.equal(saves, 1);
  assert.equal(session.project.revision, project.revision + 1);
  assert.deepEqual(session.project.sheets.one, {
    ...project.sheets.one,
    name: 'A1.0 · FLOOR PLAN',
  });
  assert.deepEqual(
    session.project.sheets.unselected,
    project.sheets.unselected,
  );
  await assert.rejects(session.dispatch(batch), ProjectConflictError);
  await session.dispatch({
    name: 'history.undo',
    projectId: project.id,
    expectedRevision: session.project.revision,
  });
  assert.deepEqual(session.project.sheets, project.sheets);
  assert.equal(session.canUndo, false);
});
