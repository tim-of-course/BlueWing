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
  let fail = false;
  const call: NativeInvoke = <T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> => {
    try {
      let result: unknown;
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
      if (command === 'database_transaction') {
        const { statements } = args as { statements: Statement[] };
        transactions.push(statements);
        database.exec('BEGIN');
        try {
          for (const statement of statements) {
            database
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
    setFailure: (value: boolean) => {
      fail = value;
    },
    database,
  };
}
const project = (): Project => ({
  formatVersion: 1,
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
