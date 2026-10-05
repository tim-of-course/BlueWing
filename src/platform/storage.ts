import { invoke } from '@tauri-apps/api/core';
import { validateProject } from '../core/commands';
import type { Project } from '../core/types';
import { encodeBase64 } from './base64';
import { BrowserStorage } from './browser-storage';
import { nativeRange } from './native-bytes';

import {
  StagedStorage,
  checkSave,
  collections,
  recordChanges,
} from './storage-model';
import type {
  Asset,
  AssetRange,
  ProjectStorage,
  SqlValue,
  Statement,
} from './storage-model';
export type { ProjectStorage, Asset } from './storage-model';
export type NativeInvoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

export class NativeStorage extends StagedStorage implements ProjectStorage {
  constructor(private readonly call: NativeInvoke = invoke) {
    super();
  }
  override stageAsset(asset: Asset): void {
    if (!asset.nativeSource) {
      super.stageAsset(asset);
      return;
    }
    if (
      !asset.id ||
      !asset.nativeSource.token ||
      !Number.isSafeInteger(asset.nativeSource.length) ||
      asset.nativeSource.length < 0 ||
      asset.data.length !== 0
    )
      throw new Error('Invalid native asset snapshot');
    this.staged.set(asset.id, { ...asset, data: new Uint8Array() });
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
    const extensions = await this.query(
      'SELECT id,data FROM records WHERE collection=?',
      ['extensions'],
    );
    for (const record of extensions) {
      if (
        (record.id === 'construction' || record.id === 'review') &&
        typeof record.data === 'string'
      )
        project[record.id] = JSON.parse(record.data) as unknown;
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
      statements.push(
        asset.nativeSource
          ? {
              sql: 'INSERT INTO assets(id,name,data) VALUES(?,?,zeroblob(?))',
              params: [asset.id, asset.name, asset.nativeSource.length],
              blob: {
                token: asset.nativeSource.token,
                table: 'assets',
                column: 'data',
              },
            }
          : {
              sql: 'INSERT INTO assets(id,name,data) VALUES(?,?,?)',
              params: [
                asset.id,
                asset.name,
                { blob: encodeBase64(asset.data) },
              ],
            },
      );
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
        sql: 'INSERT INTO project(slot,id,name,revision,format_version) VALUES(1,?,?,CASE WHEN EXISTS(SELECT 1 FROM project WHERE slot=1 AND id=? AND revision=?) THEN ? ELSE -1 END,?) ON CONFLICT(slot) DO UPDATE SET name=excluded.name, revision=excluded.revision, format_version=excluded.format_version',
        params: [
          next.id,
          next.name,
          previous.id,
          previous.revision,
          next.revision,
          next.formatVersion,
        ],
      },
      ...this.writes(previous, next),
    ]);
    this.discardStagedAssets();
  }
  async backup(path?: string): Promise<string> {
    return this.call('database_backup', { path: path ?? null });
  }
  async openAsset(id: string): Promise<AssetRange> {
    const [row] = await this.query(
      'SELECT rowid AS row_id,length(data) AS byte_length FROM assets WHERE id=?',
      [id],
    );
    if (
      !row ||
      typeof row.row_id !== 'number' ||
      typeof row.byte_length !== 'number'
    )
      throw new Error(`Missing asset: ${id}`);
    return nativeRange(row.byte_length, (offset, length) =>
      this.call('database_read_blob', {
        table: 'assets',
        column: 'data',
        rowId: row.row_id,
        offset,
        length,
      }),
    );
  }
  async readAsset(id: string): Promise<Uint8Array> {
    const source = await this.openAsset(id);
    return source.read(0, source.length);
  }
  async close(): Promise<void> {
    await this.call('database_close');
    this.discardStagedAssets();
  }
}

export function createStorage(native: boolean): ProjectStorage {
  return native ? new NativeStorage() : new BrowserStorage();
}
