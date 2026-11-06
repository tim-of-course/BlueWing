import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../../src/core/geometry';
import { validateProject } from '../../src/core/commands';
import { ProjectSession } from '../../src/core/session';
import { searchNotes } from '../../src/core/notes';
import { inspectReview } from '../../src/core/review';
import type { CommandCall } from '../../src/core/types';

void test('scratchpad literal search preserves multiline Unicode and original line numbers', () => {
  assert.deepEqual(
    searchNotes('Ä detail.* detail.*\r\n\n😀 ä DETAIL.*', 'detail.*'),
    {
      lines: [
        { line: 1, text: 'Ä detail.* detail.*' },
        { line: 3, text: '😀 ä DETAIL.*' },
      ],
      totalMatches: 3,
    },
  );
  assert.equal(searchNotes('Ä\nä', 'ä').totalMatches, 2);
  assert.equal(searchNotes('abc', '[').totalMatches, 0);
  assert.throws(() => searchNotes('', ''), /empty/);
});

void test('notes save atomically, retain cache/review, and share history', async () => {
  const project = createProject('Notes');
  let fail = true;
  const session = new ProjectSession(project, {
    save: () =>
      fail ? Promise.reject(new Error('disk full')) : Promise.resolve(),
  });
  const call = (command: CommandCall) =>
    session.dispatch({ ...command, ...session.observation });
  const cache = session.calculation;
  const review = inspectReview(project);
  assert.deepEqual((await call({ name: 'notes.read' })).data, { markdown: '' });
  const write = {
    name: 'notes.write',
    payload: { markdown: '# Notes\n😀 detail.*' },
  };
  await assert.rejects(call(write), /disk full/);
  assert.equal(session.project.notes, undefined);
  assert.equal(session.canUndo, false);
  assert.equal(session.calculation, cache);
  fail = false;
  const stale = session.observation;
  await call(write);
  await assert.rejects(session.dispatch({ ...write, ...stale }), /conflict/);
  assert.equal(session.project.notes, '# Notes\n😀 detail.*');
  assert.deepEqual(inspectReview(session.project), review);
  assert.equal(session.calculation, cache);
  await call({ name: 'history.undo' });
  assert.equal(session.project.notes, undefined);
  assert.equal(session.calculation, cache);
  await call({ name: 'history.redo' });
  assert.equal(session.project.notes, '# Notes\n😀 detail.*');
  assert.equal(session.calculation, cache);
  const revision = session.project.revision;
  await call({
    name: 'preview',
    payload: {
      commands: [
        write,
        { name: 'notes.write', payload: { markdown: 'Preview' } },
        { name: 'notes.read' },
      ],
    },
  });
  assert.equal(session.project.revision, revision);
  assert.equal(session.project.notes, '# Notes\n😀 detail.*');
  await call({
    name: 'batch',
    payload: {
      commands: [
        { name: 'notes.write', payload: { markdown: 'Batch' } },
        { name: 'notes.read' },
      ],
    },
  });
  assert.equal(session.project.revision, revision + 1);
  await call({ name: 'history.undo' });
  assert.equal(session.project.notes, '# Notes\n😀 detail.*');
  await call({ name: 'notes.write', payload: { markdown: '' } });
  assert.equal(session.project.notes, undefined);
  assert.equal(session.calculation, cache);
  assert.throws(() => {
    validateProject({ ...project, formatVersion: 4 });
  }, /Unsupported/);
  assert.throws(() => {
    validateProject({ ...project, formatVersion: 3 });
  }, /Unsupported/);
  assert.throws(() => {
    validateProject({ ...project, formatVersion: 6 });
  }, /Unsupported/);
});
