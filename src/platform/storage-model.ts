import { validateProject } from '../core/commands';
import type { PersistencePort, Project } from '../core/types';

export interface Asset {
  id: string;
  name: string;
  data: Uint8Array;
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
  return collections.flatMap((collection) =>
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
