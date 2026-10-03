import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { NativeStorage } from '../../src/platform/storage';
import type { NativeInvoke } from '../../src/platform/storage';
import type { Statement } from '../../src/platform/storage-model';
import type { Project } from '../../src/core/types';

function fixture() {
  const database = new DatabaseSync(':memory:');
  const transactions: Statement[][] = [];
  const snapshots = new Map<string, Uint8Array>();
  let fail = false;
  let failBackup = false;
  const backups: string[] = [];
  const call: NativeInvoke = <T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    try {
      let result: unknown;
      if (command === 'database_backup') {
        if (failBackup) throw new Error('backup disk full');
        backups.push((args?.path as string | null) ?? 'test.backup.bluewing');
        result = backups.at(-1);
      }
      if (command === 'database_query') {
        const { sql, params } = args as { sql: string; params: string[] };
        result = database
          .prepare(sql)
          .all(...params)
          .map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key,
                value instanceof Uint8Array
                  ? { blob: Buffer.from(value).toString('base64') }
                  : value,
              ]),
            ),
          );
      }
      if (command === 'database_read_blob') {
        const { rowId, offset, length } = args as {
          rowId: number;
          offset: number;
          length: number;
        };
        const row = database
          .prepare('SELECT substr(data,?,?) AS chunk FROM assets WHERE rowid=?')
          .get(offset + 1, length, rowId);
        if (!(row?.chunk instanceof Uint8Array))
          throw new Error('Missing blob');
        result = row.chunk;
      }
      if (command === 'database_transaction') {
        const { statements } = args as { statements: Statement[] };
        transactions.push(statements);
        database.exec('BEGIN');
        try {
          for (const statement of statements) {
            const inserted = database
              .prepare(statement.sql)
              .run(
                ...statement.params.map((value) =>
                  typeof value === 'object' && value !== null
                    ? Buffer.from(value.blob, 'base64')
                    : typeof value === 'boolean'
                      ? Number(value)
                      : value,
                ),
              );
            if (statement.blob) {
              const bytes = snapshots.get(statement.blob.token);
              if (!bytes) throw new Error('Missing snapshot');
              database
                .prepare('UPDATE assets SET data=? WHERE rowid=?')
                .run(bytes, inserted.lastInsertRowid);
            }
          }
          if (fail) throw new Error('disk full');
          database.exec('COMMIT');
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      }
      return Promise.resolve(result as T);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };
  return {
    storage: new NativeStorage(call),
    transactions,
    snapshots,
    setFailure: (value: boolean) => {
      fail = value;
    },
    database,
    backups,
    setBackupFailure: (value: boolean) => {
      failBackup = value;
    },
  };
}
const project = (): Project => ({
  formatVersion: 4,
  id: 'p',
  name: 'Test',
  revision: 0,
  sheets: {},
  geometries: {},
  groups: {},
  recipes: {},
  assignments: {},
});

void test('SQLite persists changed records only and rejects stale revisions atomically', async () => {
  const { storage, transactions, database } = fixture();
  await storage.open('test', true);
  const initial = project();
  await storage.initialize(initial);
  const next = structuredClone(initial);
  next.revision = 1;
  next.groups.g = { id: 'g', name: 'First', geometryIds: [] };
  await storage.save(initial, next);
  assert.deepEqual(await storage.load(), next);
  assert.equal(transactions.at(-1)?.length, 2);
  await assert.rejects(
    storage.save(initial, { ...next, name: 'Stale' }),
    /CHECK/,
  );
  assert.deepEqual(await storage.load(), next);
  await assert.rejects(storage.initialize(initial));
  database.close();
});

void test('PDF bytes and records roll back together; staged bytes survive a failed save', async () => {
  const { storage, transactions, setFailure, database } = fixture();
  await storage.open('test', true);
  const initial = project();
  await storage.initialize(initial);
  const bytes = new Uint8Array([0, 255, 128]);
  storage.stageAsset({ id: 'pdf', name: 'plan.pdf', data: bytes });
  bytes[0] = 99;
  const next = {
    ...initial,
    revision: 1,
    sheets: {
      s: {
        id: 's',
        name: 'Sheet',
        assetId: 'pdf',
        pageIndex: 0,
        width: 100,
        height: 100,
      },
    },
  };
  setFailure(true);
  await assert.rejects(storage.save(initial, next), /disk full/);
  assert.deepEqual(await storage.load(), initial);
  await assert.rejects(storage.readAsset('pdf'), /Missing/);
  setFailure(false);
  await storage.save(initial, next);
  assert.deepEqual(
    await storage.readAsset('pdf'),
    new Uint8Array([0, 255, 128]),
  );
  await storage.save(next, { ...next, revision: 2, name: 'Renamed' });
  assert.equal(transactions.at(-1)?.length, 1);
  database.close();
});

void test('format 4 saves assembly fields atomically and retains them on reopen', async () => {
  const { storage, database, setFailure } = fixture();
  await storage.open('assemblies', true);
  const initial = project();
  await storage.initialize(initial);
  assert.equal((await storage.load()).formatVersion, 4);
  const next: Project = {
    ...initial,
    revision: 1,
    recipes: {
      header: {
        id: 'header',
        name: 'Project header',
        reference: '5/A6.2',
        category: 'Framing',
        librarySource: { id: 'global', name: 'Source' },
        geometryKinds: ['count'],
        inputs: [{ name: 'width', type: 'number', unit: 'ft' }],
        outputs: [
          {
            id: 'p',
            name: 'Header',
            materialId: 'specified-track',
            unit: 'ea',
            formula: 'count * 2',
            allowance: { wastePercent: 0 },
            piece: {
              role: 'Header',
              cutLength: { formula: 'width', unit: 'ft' },
            },
          },
        ],
      },
    },
  };
  setFailure(true);
  await assert.rejects(storage.save(initial, next), /disk full/);
  assert.deepEqual(await storage.load(), initial);
  setFailure(false);
  await storage.save(initial, next);
  assert.deepEqual(await storage.load(), next);
  assert.equal(
    database.prepare('SELECT format_version FROM project').get()
      ?.format_version,
    4,
  );
  database.close();
});

void test('old project formats are rejected without changing the saved file', async () => {
  const { storage, database, backups } = fixture();
  await storage.open('unsupported', true);
  await storage.initialize(project());
  for (const version of [1, 2, 3]) {
    database.prepare('UPDATE project SET format_version=?').run(version);
    await assert.rejects(storage.load(), /format|version/i);
    assert.equal(
      database.prepare('SELECT format_version FROM project').get()
        ?.format_version,
      version,
    );
  }
  assert.deepEqual(backups, []);
  database.close();
});

void test('format 4 extensions survive reopen and backups run only when requested', async () => {
  const { storage, database, backups, setBackupFailure } = fixture();
  await storage.open('detailed', true);
  const initial = project();
  await storage.initialize(initial);
  const next: Project = {
    ...initial,
    revision: 1,
    review: { snippets: {}, marks: {} },
  };
  setBackupFailure(true);
  await storage.save(initial, next);
  assert.deepEqual(backups, []);
  assert.deepEqual(await storage.load(), next);
  await assert.rejects(storage.backup('recovery.bluewing'), /backup disk full/);
  assert.deepEqual(await storage.load(), next);
  setBackupFailure(false);
  assert.equal(await storage.backup('recovery.bluewing'), 'recovery.bluewing');
  assert.equal(await storage.backup(), 'test.backup.bluewing');
  assert.deepEqual(backups, ['recovery.bluewing', 'test.backup.bluewing']);
  database.close();
});

void test('native snapshots insert with project metadata atomically without base64 payloads', async () => {
  const { storage, database, snapshots, transactions, setFailure } = fixture();
  await storage.open('snapshot', true);
  const initial = project();
  await storage.initialize(initial);
  const source = new Uint8Array([1, 2, 3, 255]);
  snapshots.set('source-token', source.slice());
  storage.stageAsset({
    id: 'snapshot-asset',
    name: 'plan.pdf',
    data: source,
    nativeSource: { token: 'source-token', length: 4 },
  });
  source.fill(0);
  const next = { ...initial, revision: 1, name: 'Imported' };
  setFailure(true);
  await assert.rejects(storage.save(initial, next), /disk full/);
  assert.deepEqual(await storage.load(), initial);
  await assert.rejects(storage.readAsset('snapshot-asset'), /Missing/);
  setFailure(false);
  await storage.save(initial, next);
  assert.deepEqual(
    await storage.readAsset('snapshot-asset'),
    new Uint8Array([1, 2, 3, 255]),
  );
  const write = transactions.at(-1)?.find((statement) => statement.blob);
  assert.equal(write?.blob?.token, 'source-token');
  assert.deepEqual(write.params, ['snapshot-asset', 'plan.pdf', 4]);
  assert.deepEqual(await storage.load(), next);
  database.close();
});
