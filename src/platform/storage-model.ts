import { validateProject } from '../core/commands';
import type { PersistencePort, Project } from '../core/types';

/** Random access to a source asset without transferring its complete contents. */
export interface AssetRange {
  length: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface Asset {
  id: string;
  name: string;
  data: Uint8Array;
  /** Immutable native tempfile; data is empty. Released after import or failure. */
  nativeSource?: { token: string; length: number };
}
export interface ProjectStorage extends PersistencePort {
  open(path: string, create: boolean): Promise<void>;
  load(): Promise<Project>;
  initialize(project: Project): Promise<void>;
  stageAsset(asset: Asset): void;
  discardStagedAssets(): void;
  readAsset(id: string): Promise<Uint8Array>;
  close(): Promise<void>;
}
export const collections = [
  'sheets',
  'geometries',
  'groups',
  'recipes',
  'assignments',
] as const;
export type SqlValue = string | number | boolean | null | { blob: string };
export interface Statement {
  sql: string;
  params: SqlValue[];
  /** Stream into the BLOB of the row just inserted, inside the same transaction. */
  blob?: { token: string; table: string; column: string };
}
export function metadata(project: Project) {
  return {
    formatVersion: project.formatVersion,
    id: project.id,
    name: project.name,
    revision: project.revision,
  };
}
export function recordChanges(previous: Project | undefined, next: Project) {
  const records: { collection: string; id: string; value: unknown }[] =
    collections.flatMap((collection) =>
      [
        ...new Set([
          ...Object.keys(previous?.[collection] ?? {}),
          ...Object.keys(next[collection]),
        ]),
      ].flatMap((id) => {
        const value = next[collection][id];
        return JSON.stringify(previous?.[collection][id]) ===
          JSON.stringify(value)
          ? []
          : [{ collection, id, value }];
      }),
    );
  for (const id of ['construction', 'review'] as const)
    if (JSON.stringify(previous?.[id]) !== JSON.stringify(next[id]))
      records.push({ collection: 'extensions', id, value: next[id] });
  return records;
}
export function checkSave(previous: Project, next: Project): void {
  validateProject(next);
  if (previous.id !== next.id || next.revision !== previous.revision + 1)
    throw new Error(
      'Save must retain project identity and advance revision by one',
    );
}
export abstract class StagedStorage {
  protected staged = new Map<string, Asset>();
  stageAsset(asset: Asset): void {
    if (!asset.id) throw new Error('Asset ID is required');
    this.staged.set(asset.id, { ...asset, data: asset.data.slice() });
  }
  discardStagedAssets(): void {
    this.staged.clear();
  }
}
