import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssemblyLibraryStore } from '../../src/platform/assembly-library';

void test('global library persists independently, rejects stale edits and survives failed saves', async () => {
  let saved: string | null = null;
  let fail = false;
  const store = new AssemblyLibraryStore({
    read: () => Promise.resolve(saved),
    write: (data) => {
      if (fail) return Promise.reject(new Error('disk full'));
      saved = data;
      return Promise.resolve();
    },
  });
  const library = await store.read();
  const assembly = library.assemblies['drywall-face'];
  assert.ok(assembly);
  assembly.name = 'Company drywall';
  await store.save(0, assembly);
  const reopened = await store.read();
  assert.equal(reopened.revision, 1);
  assert.equal(reopened.assemblies[assembly.id]?.name, 'Company drywall');
  await assert.rejects(store.save(0, assembly), /changed/);
  fail = true;
  assembly.name = 'Not saved';
  await assert.rejects(store.save(1, assembly), /disk full/);
  assert.equal(
    (await store.read()).assemblies[assembly.id]?.name,
    'Company drywall',
  );
  fail = false;
  await store.save(1, assembly.id);
  assert.equal((await store.read()).assemblies[assembly.id], undefined);
  saved = 'broken';
  await assert.rejects(store.read());
});

void test('adding missing starters upgrades a saved library without replacing company definitions', async () => {
  let saved: string | null = null;
  let fail = false;
  const store = new AssemblyLibraryStore({
    read: () => Promise.resolve(saved),
    write: (data) => {
      if (fail) return Promise.reject(new Error('disk full'));
      saved = data;
      return Promise.resolve();
    },
  });
  const old = await store.read();
  delete old.assemblies['ceiling-grid-2x2'];
  delete old.assemblies['ceiling-grid-2x4'];
  const finish = old.assemblies['ceiling-finish'];
  assert.ok(finish);
  finish.name = 'Company finish';
  saved = JSON.stringify(old);
  fail = true;
  await assert.rejects(store.addStarters(0), /disk full/);
  assert.equal((await store.read()).assemblies['ceiling-grid-2x2'], undefined);
  fail = false;
  const upgraded = await store.addStarters(0);
  assert.equal(upgraded.revision, 1);
  assert.equal(upgraded.assemblies['ceiling-finish']?.name, 'Company finish');
  assert.ok(upgraded.assemblies['ceiling-grid-2x2']);
  assert.ok(upgraded.assemblies['ceiling-grid-2x4']);
  await assert.rejects(store.addStarters(0), /changed/);
  assert.equal((await store.addStarters(1)).revision, 1);
  await store.save(1, 'ceiling-grid-2x2');
  assert.equal((await store.read()).assemblies['ceiling-grid-2x2'], undefined);
  assert.ok((await store.addStarters(2)).assemblies['ceiling-grid-2x2']);
});
