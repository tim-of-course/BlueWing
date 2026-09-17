import { invoke } from '@tauri-apps/api/core';
import { validateProject } from '../core/commands';
import type { Project } from '../core/types';
import { decodeBase64, encodeBase64 } from './base64';
import { BrowserStorage } from './browser-storage';

import {
  StagedStorage,
  checkSave,
  collections,
  recordChanges,
} from './storage-model';
import type { ProjectStorage, SqlValue, Statement } from './storage-model';
export type { ProjectStorage, Asset } from './storage-model';
export type NativeInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export class NativeStorage extends StagedStorage implements ProjectStorage {
  constructor(private readonly call: NativeInvoke = invoke) {
    super();
  }
  async open(path: string, create: boolean): Promise<void> {
    await this.call('database_open', { path, create });
    if (create) {
      try {
        await this.transaction([
          {
            sql: 'CREATE TABLE project (slot INTEGER PRIMARY KEY CHECK(slot=1), id TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=0), format_version INTEGER NOT NULL)',
            params: [],
          },
          {
            sql: 'CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection,id))',
            params: [],
          },
          {
            sql: 'CREATE TABLE assets (id TEXT PRIMARY KEY, name TEXT NOT NULL, data BLOB NOT NULL)',
            params: [],
          },
          { sql: 'PRAGMA user_version=1', params: [] },
        ]);
      } catch (error) {
        await this.close();
        throw error;
      }
    } else {
      try {
        const rows = await this.query('PRAGMA user_version');
        if (rows[0]?.user_version !== 1)
          throw new Error('Unsupported project storage format');
      } catch (error) {
        await this.close();
        throw error;
      }
    }
  }
  private query(sql: string, params: SqlValue[] = []) {
    return this.call<Record<string, SqlValue>[]>('database_query', {
      sql,
      params,
    });
  }
  private transaction(statements: Statement[]): Promise<void> {
    return this.call('database_transaction', { statements });
  }
  async load(): Promise<Project> {
    const [row] = await this.query('SELECT * FROM project WHERE slot=1');
    if (!row) throw new Error('Project has not been initialized');
    const project: Record<string, unknown> = {
      id: row.id,
      name: row.name,
      revision: row.revision,
      formatVersion: row.format_version,
    };
    for (const collection of collections) {
      const records = await this.query(
        'SELECT id,data FROM records WHERE collection=?',
        [collection],
      );
      project[collection] = Object.fromEntries(
        records.map((record) => {
          if (typeof record.id !== 'string' || typeof record.data !== 'string')
            throw new Error('Invalid stored record');
          return [record.id, JSON.parse(record.data) as unknown];
        }),
      );
    }
    validateProject(project);
    return project;
  }
  private writes(previous: Project | undefined, next: Project): Statement[] {
    const statements = recordChanges(previous, next).map(
      ({ collection, id, value }): Statement =>
        value === undefined
          ? {
              sql: 'DELETE FROM records WHERE collection=? AND id=?',
              params: [collection, id],
            }
          : {
              sql: 'INSERT INTO records(collection,id,data) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data',
              params: [collection, id, JSON.stringify(value)],
            },
    );
    // Source assets are retained for session undo, even when their last sheet is removed.
    for (const asset of this.staged.values())
      statements.push({
        sql: 'INSERT INTO assets(id,name,data) VALUES(?,?,?)',
        params: [asset.id, asset.name, { blob: encodeBase64(asset.data) }],
      });
    return statements;
  }
  async initialize(project: Project): Promise<void> {
    validateProject(project);
    await this.transaction([
      {
        sql: 'INSERT INTO project(slot,id,name,revision,format_version) VALUES(1,?,?,?,?)',
        params: [
          project.id,
          project.name,
          project.revision,
          project.formatVersion,
        ],
      },
      ...this.writes(undefined, project),
    ]);
    this.discardStagedAssets();
  }
  async save(previous: Project, next: Project): Promise<void> {
    checkSave(previous, next);
    // CHECK rejects stale revisions (and missing metadata) inside the same transaction.
    await this.transaction([
      {
        sql: 'INSERT INTO project(slot,id,name,revision,format_version) VALUES(1,?,?,CASE WHEN EXISTS(SELECT 1 FROM project WHERE slot=1 AND id=? AND revision=?) THEN ? ELSE -1 END,1) ON CONFLICT(slot) DO UPDATE SET name=excluded.name, revision=excluded.revision',
        params: [
          next.id,
          next.name,
          previous.id,
          previous.revision,
          next.revision,
        ],
      },
      ...this.writes(previous, next),
    ]);
    this.discardStagedAssets();
  }
  async readAsset(id: string): Promise<Uint8Array> {
    const [row] = await this.query('SELECT data FROM assets WHERE id=?', [id]);
    if (!row || typeof row.data !== 'object' || row.data === null)
      throw new Error(`Missing asset: ${id}`);
    return decodeBase64(row.data.blob);
  }
  async close(): Promise<void> {
    await this.call('database_close');
    this.discardStagedAssets();
  }
}

export function createStorage(native: boolean): ProjectStorage {
  return native ? new NativeStorage() : new BrowserStorage();
}
