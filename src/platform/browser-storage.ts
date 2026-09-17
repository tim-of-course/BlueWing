import { validateProject } from '../core/commands';
import type { Project } from '../core/types';
import {
  StagedStorage,
  checkSave,
  collections,
  metadata,
  recordChanges,
} from './storage-model';
import type { Asset, ProjectStorage } from './storage-model';

function request<T>(operation: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => {
      resolve(operation.result);
    };
    operation.onerror = () => {
      reject(operation.error ?? new Error('IndexedDB request failed'));
    };
  });
}
function completion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error('Storage transaction aborted'));
    };
    transaction.onerror = () => {
      /* onabort reports transaction failure. */
    };
  });
}
interface StoredMetadata {
  project?: ReturnType<typeof metadata>;
}

export class BrowserStorage extends StagedStorage implements ProjectStorage {
  private database: IDBDatabase | undefined;
  private path = '';
  async open(path: string, create: boolean): Promise<void> {
    if (this.database) throw new Error('Close the current project first');
    const opening = indexedDB.open('bluewing-development', 1);
    opening.onupgradeneeded = () => {
      for (const store of ['projects', 'records', 'assets'])
        opening.result.createObjectStore(store);
    };
    const database = await request(opening);
    const transaction = database.transaction('projects', 'readwrite');
    const done = completion(transaction);
    try {
      const store = transaction.objectStore('projects');
      const existing: unknown = await request(store.get(path));
      if (create) {
        if (existing !== undefined) throw new Error('Project already exists');
        await request(store.add({}, path));
      } else if (existing === undefined)
        throw new Error('Project does not exist');
      await done;
      this.database = database;
      this.path = path;
    } catch (error) {
      transaction.abort();
      await done.catch(() => undefined);
      database.close();
      throw error;
    }
  }
  private transaction(mode: IDBTransactionMode): IDBTransaction {
    if (!this.database) throw new Error('No open project');
    return this.database.transaction(['projects', 'records', 'assets'], mode);
  }
  async load(): Promise<Project> {
    const transaction = this.transaction('readonly');
    const done = completion(transaction);
    const stored = (await request(
      transaction.objectStore('projects').get(this.path),
    )) as StoredMetadata;
    const project: Record<string, unknown> = { ...stored.project };
    for (const collection of collections) {
      const range = IDBKeyRange.bound(
        [this.path, collection, ''],
        [this.path, collection, []],
      );
      const records = (await request(
        transaction.objectStore('records').getAll(range),
      )) as { id: string }[];
      project[collection] = Object.fromEntries(
        records.map((record) => [record.id, record]),
      );
    }
    await done;
    validateProject(project);
    return project;
  }
  private async persist(
    previous: Project | undefined,
    next: Project,
  ): Promise<void> {
    validateProject(next);
    const transaction = this.transaction('readwrite');
    const done = completion(transaction);
    try {
      const projects = transaction.objectStore('projects');
      const stored = (await request(projects.get(this.path))) as StoredMetadata;
      if (
        previous
          ? stored.project?.id !== previous.id ||
            stored.project.revision !== previous.revision
          : stored.project !== undefined
      )
        throw new Error(
          previous
            ? 'Project revision conflict; reload the project'
            : 'Project already initialized',
        );
      const pending: Promise<unknown>[] = [
        request(projects.put({ project: metadata(next) }, this.path)),
      ];
      const records = transaction.objectStore('records');
      for (const change of recordChanges(previous, next)) {
        const key = [this.path, change.collection, change.id];
        pending.push(
          change.value === undefined
            ? request(records.delete(key))
            : request(records.put(change.value, key)),
        );
      }
      for (const asset of this.staged.values())
        pending.push(
          request(
            transaction.objectStore('assets').add(asset, [this.path, asset.id]),
          ),
        );
      await Promise.all(pending);
      await done;
      this.discardStagedAssets();
    } catch (error) {
      if (transaction.error === null) {
        try {
          transaction.abort();
        } catch {
          /* Already aborted. */
        }
      }
      await done.catch(() => undefined);
      throw error;
    }
  }
  initialize(project: Project): Promise<void> {
    return this.persist(undefined, project);
  }
  save(previous: Project, next: Project): Promise<void> {
    checkSave(previous, next);
    return this.persist(previous, next);
  }
  async readAsset(id: string): Promise<Uint8Array> {
    const transaction = this.transaction('readonly');
    const done = completion(transaction);
    const asset = (await request(
      transaction.objectStore('assets').get([this.path, id]),
    )) as Asset | undefined;
    await done;
    if (!asset) throw new Error(`Missing asset: ${id}`);
    return asset.data;
  }
  close(): Promise<void> {
    this.database?.close();
    this.database = undefined;
    this.discardStagedAssets();
    return Promise.resolve();
  }
}
