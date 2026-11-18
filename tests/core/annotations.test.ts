import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  annotationKinds,
  type SheetAnnotation,
} from '../../src/core/annotations';
import { importFixture } from '../fixtures/quantity-project';
import { estiMakerTakeoff } from '../../src/core/quantity-presentation';
import { validateProject } from '../../src/core/commands';
import { ProjectSession } from '../../src/core/session';

void test('sheet annotations retain authorship across commands, scoped reads, atomic saves and history', async () => {
  const project = importFixture();
  const session = new ProjectSession(project, {
    save: () => Promise.resolve(),
  });
  const run = (
    name: string,
    payload: unknown = {},
    origin = 'cli',
    takeoffId = 'main',
  ) =>
    session.dispatch({
      name,
      payload,
      origin,
      takeoffId,
      ...session.observation,
    });
  await run('takeoff.create', { id: 'phase', kind: 'phase', name: 'Phase' });
  await run('takeoff.create', { id: 'co', kind: 'change-order', name: 'CO' });
  const cache = session.calculation;
  const phaseCache = session.calculationFor('phase');
  const estimateRows = estiMakerTakeoff(session.project, cache).rows;
  assert.ok(estimateRows.length);
  const exportRows = async () => {
    const csv = (await run('quantities.export', { format: 'csv' })).data;
    assert.equal(typeof csv, 'string');
    // Every saved edit advances the revision embedded in each CSV row.
    return (csv as string).replaceAll(
      `"${project.id}","${String(session.observation.expectedRevision)}",`,
      '',
    );
  };
  const exports = await exportRows();
  const points = [
    { x: 4, y: 9 },
    { x: 23, y: 45 },
  ];
  const freehand = {
    name: 'annotation.add',
    payload: { sheetId: 's', kind: 'freehand', points },
  };
  for (const name of ['batch', 'preview']) {
    await assert.rejects(run(name, { commands: [freehand] }), /Freehand/);
    const preview = await run('preview', {
      commands: [
        {
          name: 'annotation.add',
          payload: { sheetId: 's', kind: 'line', points },
        },
      ],
    });
    assert.equal((preview.data as SheetAnnotation[])[0]?.author, 'agent');
    assert.deepEqual(preview.quantityChanges, []);
  }
  const stale = session.observation;
  for (const kind of annotationKinds) {
    const fields = {
      kind,
      sheetId: 's',
      ...(kind === 'text'
        ? { text: 'Confirm beam', points: points.slice(0, 1) }
        : { points }),
    };
    const created = await run(
      'batch',
      { commands: [{ name: 'annotation.add', payload: fields }] },
      kind === 'freehand' ? 'ui' : 'cli',
      'phase',
    );
    assert.equal(
      (created.data as SheetAnnotation[])[0]?.author,
      kind === 'freehand' ? 'user' : 'agent',
    );
  }
  const records = (await run('annotation.list', { sheetId: 's' }, 'cli', 'co'))
    .data as SheetAnnotation[];
  assert.equal(records.length, 7);
  const entry = records.find((a) => a.kind === 'text');
  assert.ok(entry);
  const edit = {
    name: 'annotation.update',
    payload: { id: entry.id, text: 'Verified' },
  };
  await assert.rejects(session.dispatch({ ...edit, ...stale }), {
    code: 'PROJECT_CONFLICT',
  });
  assert.deepEqual((await run(edit.name, edit.payload, 'ui')).data, {
    ...entry,
    text: 'Verified',
  });
  await assert.rejects(
    run(edit.name, { ...edit.payload, author: 'agent' }),
    /Unknown field/,
  );
  await run('annotation.delete', { id: entry.id });
  await run('history.undo');
  assert.deepEqual((await run('annotation.inspect', { id: entry.id })).data, {
    ...entry,
    text: 'Verified',
  });
  await run('history.redo');
  assert.equal(session.calculation, cache);
  assert.equal(session.calculationFor('phase'), phaseCache);
  assert.equal(await exportRows(), exports);
  assert.deepEqual(
    estiMakerTakeoff(session.project, session.calculation).rows,
    estimateRows,
  );
  const before = session.project.annotations;
  await run('sheet.delete', { id: 's' });
  assert.deepEqual(session.project.annotations, {});
  await run('history.undo');
  assert.deepEqual(session.project.annotations, before);
  assert.throws(() => {
    validateProject({ ...project, formatVersion: 9 });
  }, /Unsupported project format/);
  for (const [command, payload] of [
    ['project.category.put', { name: 'Custom', color: '#9e174d' }],
    [
      'group.put',
      { id: 'g', name: 'Group', geometryIds: [], color: '#9E174D' },
    ],
  ] as const)
    await assert.rejects(run(command, payload), /reserved/);
});
