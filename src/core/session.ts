import { executeCommand, validateCommand, validateProject } from './commands';
import type {
  CommandCall,
  CommandRequest,
  CommandResult,
  PersistencePort,
  Project,
} from './types';

const collections = [
  'sheets',
  'geometries',
  'groups',
  'recipes',
  'assignments',
] as const;
type Collection = (typeof collections)[number];
type Entity = Project[Collection][string];
interface RecordChange {
  collection: Collection;
  id: string;
  before: Entity | undefined;
  after: Entity | undefined;
}
interface HistoryEntry {
  label: string;
  origin: string;
  beforeName: string;
  afterName: string;
  records: RecordChange[];
}
export interface HistoryItem {
  label: string;
  origin: string;
}

export class ProjectConflictError extends Error {
  readonly code = 'PROJECT_CONFLICT';
  constructor(
    readonly projectId: string,
    readonly revision: number,
  ) {
    super(
      `Project conflict: inspect project ${projectId} at revision ${String(revision)} and retry.`,
    );
    this.name = 'ProjectConflictError';
  }
}

function difference(
  before: Project,
  after: Project,
  request: CommandRequest,
): HistoryEntry {
  const records: RecordChange[] = [];
  for (const collection of collections) {
    const previous = before[collection];
    const next = after[collection];
    for (const id of new Set([
      ...Object.keys(previous),
      ...Object.keys(next),
    ])) {
      if (JSON.stringify(previous[id]) !== JSON.stringify(next[id])) {
        records.push({
          collection,
          id,
          before: structuredClone(previous[id]),
          after: structuredClone(next[id]),
        });
      }
    }
  }
  return {
    label: request.name,
    origin: request.origin ?? 'ui',
    beforeName: before.name,
    afterName: after.name,
    records,
  };
}

function restore(
  project: Project,
  entry: HistoryEntry,
  direction: 'before' | 'after',
): Project {
  const next = structuredClone(project);
  next.name = direction === 'before' ? entry.beforeName : entry.afterName;
  for (const change of entry.records) {
    const records: Record<string, Entity> = next[change.collection];
    const entity = change[direction];
    if (entity === undefined) Reflect.deleteProperty(records, change.id);
    else records[change.id] = structuredClone(entity);
  }
  return next;
}

/** Owns accepted state; drafts and source asset bytes belong outside this session. */
export class ProjectSession {
  #project: Project;
  #queue: Promise<void> = Promise.resolve();
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  #listeners = new Set<(project: Project) => void>();
  readonly #persistence: PersistencePort;
  readonly #historyLimit: number;

  constructor(
    project: Project,
    persistence: PersistencePort,
    historyLimit = 50,
  ) {
    validateProject(project);
    if (!Number.isInteger(historyLimit) || historyLimit < 0)
      throw new Error('History limit must be a nonnegative integer');
    this.#project = structuredClone(project);
    this.#persistence = persistence;
    this.#historyLimit = historyLimit;
  }

  get project(): Project {
    return structuredClone(this.#project);
  }
  get canUndo(): boolean {
    return this.#undo.length > 0;
  }
  get canRedo(): boolean {
    return this.#redo.length > 0;
  }
  get history(): { undo: HistoryItem[]; redo: HistoryItem[] } {
    const metadata = ({ label, origin }: HistoryEntry): HistoryItem => ({
      label,
      origin,
    });
    return { undo: this.#undo.map(metadata), redo: this.#redo.map(metadata) };
  }
  subscribe(listener: (project: Project) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  dispatch(request: CommandRequest): Promise<CommandResult> {
    const captured = structuredClone(request);
    const operation = this.#queue.then(() => this.#execute(captured));
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #execute(request: CommandRequest): Promise<CommandResult> {
    if (
      request.projectId !== this.#project.id ||
      request.expectedRevision !== this.#project.revision
    ) {
      throw new ProjectConflictError(this.#project.id, this.#project.revision);
    }
    validateCommand(request);
    if (request.name === 'history.undo' || request.name === 'history.redo')
      return this.#travel(request.name === 'history.undo');

    let next = this.#project;
    let changed = false;
    let data: unknown;
    const preview = request.name === 'preview';
    if (request.name === 'batch' || preview) {
      const payload = request.payload as { commands: CommandCall[] };
      const results: unknown[] = [];
      for (const call of payload.commands) {
        if (
          ['batch', 'preview', 'history.undo', 'history.redo'].includes(
            call.name,
          )
        )
          throw new Error(
            'Batches and previews cannot contain session control commands',
          );
        const result = executeCommand(next, call, false);
        next = result.project;
        changed ||= result.changed;
        results.push(result.data);
      }
      validateProject(next);
      data = results;
    } else {
      const result = executeCommand(next, request);
      next = result.project;
      changed = result.changed;
      data = result.data;
    }
    if (preview || !changed)
      return {
        project: structuredClone(next),
        data: structuredClone(data),
        changed,
        preview,
      };

    const entry = difference(this.#project, next, request);
    await this.#save(next);
    this.#undo.push(entry);
    if (this.#undo.length > this.#historyLimit) this.#undo.shift();
    this.#redo = [];
    this.#publish();
    return {
      project: this.project,
      data: structuredClone(data),
      changed: true,
      preview: false,
    };
  }

  async #travel(undo: boolean): Promise<CommandResult> {
    const source = undo ? this.#undo : this.#redo;
    const destination = undo ? this.#redo : this.#undo;
    const entry = source.at(-1);
    if (!entry) throw new Error(undo ? 'Nothing to undo' : 'Nothing to redo');
    const next = restore(this.#project, entry, undo ? 'before' : 'after');
    validateProject(next);
    await this.#save(next);
    source.pop();
    destination.push(entry);
    this.#publish();
    return {
      project: this.project,
      data: { label: entry.label, origin: entry.origin },
      changed: true,
      preview: false,
    };
  }

  async #save(next: Project): Promise<void> {
    next.revision = this.#project.revision + 1;
    // Adapter code receives copies so it cannot alter accepted state or a pending history entry.
    await this.#persistence.save(this.project, structuredClone(next));
    this.#project = next;
  }
  #publish(): void {
    for (const listener of this.#listeners) {
      try {
        listener(this.project);
      } catch {
        /* A subscriber cannot turn an already committed save into a failed command. */
      }
    }
  }
}
