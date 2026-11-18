import {
  executeCommandOnDraft,
  validateCommand,
  validateProject,
} from './commands';
import {
  calculateSnapshot,
  changesCalculation,
  type CalculationSnapshot,
} from './calculation-state';
import { quantityChanges } from './quantity-changes';
import { mainId, takeoffProject } from './takeoffs';
import type {
  CommandCall,
  CommandRequest,
  CommandResult,
  PersistencePort,
  Project,
} from './types';

const collections = [
  'takeoffs',
  'sheets',
  'annotations',
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
interface ExtensionChange<T> {
  before: T;
  after: T;
}
interface HistoryEntry {
  label: string;
  origin: string;
  beforeName: string;
  afterName: string;
  records: RecordChange[];
  construction: ExtensionChange<Project['construction']> | undefined;
  review: ExtensionChange<Project['review']> | undefined;
  allowSpecialOrderStuds: ExtensionChange<boolean> | undefined;
  standardSizes: ExtensionChange<Project['standardSizes']> | undefined;
  categoryColors: ExtensionChange<Project['categoryColors']> | undefined;
  notes: ExtensionChange<Project['notes']> | undefined;
  calculationChanged: boolean;
}
export interface HistoryItem {
  label: string;
  origin: string;
}

export class ProjectConflictError extends Error {
  readonly code = 'PROJECT_CONFLICT';
  constructor(
    readonly projectId: string | null,
    readonly revision: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectConflictError';
  }
}

type Observation = Pick<CommandRequest, 'projectId' | 'expectedRevision'>;

export class BatchChildError extends Error {
  constructor(
    readonly index: number,
    readonly command: string,
    reason: string,
  ) {
    super(`commands[${String(index)}] (${command}): ${reason}`);
  }
}

export function checkObservation(
  current: Observation | undefined,
  request: Partial<Observation>,
  required = true,
) {
  if (!current) {
    if (
      request.projectId !== undefined ||
      request.expectedRevision !== undefined
    )
      throw new ProjectConflictError(
        null,
        null,
        'No project is open. Stop and reconnect to the intended project.',
      );
    if (required) throw new Error('Open or create a project first');
    return;
  }
  const { projectId, expectedRevision } = current;
  let message: string;
  if (request.projectId !== undefined && request.projectId !== projectId)
    message = `The requested projectId ${request.projectId} differs from the open project ${projectId}. Stop and reconnect to the intended project.`;
  else if (
    required &&
    (request.projectId === undefined || request.expectedRevision === undefined)
  ) {
    const missing = [
      ...(request.projectId === undefined ? ['projectId'] : []),
      ...(request.expectedRevision === undefined ? ['expectedRevision'] : []),
    ];
    message = `Missing ${missing.join(' and ')}. Supply the missing request fields from your observation of the intended project.`;
  } else if (
    request.expectedRevision !== undefined &&
    request.expectedRevision !== expectedRevision
  )
    message = `Stale expectedRevision ${String(request.expectedRevision)}. Reread the records you are editing at revision ${String(expectedRevision)}, merge your changes, and submit the updated request.`;
  else return;
  throw new ProjectConflictError(projectId, expectedRevision, message);
}

function difference(
  before: Project,
  after: Project,
  request: CommandRequest,
  calculationChanged: boolean,
): HistoryEntry {
  const records: RecordChange[] = [];
  for (const collection of collections) {
    const previous = before[collection];
    const next = after[collection];
    if (previous === next) continue;
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
    calculationChanged,
    construction: extensionChange(before.construction, after.construction),
    review: extensionChange(before.review, after.review),
    allowSpecialOrderStuds: extensionChange(
      before.allowSpecialOrderStuds,
      after.allowSpecialOrderStuds,
    ),
    standardSizes: extensionChange(before.standardSizes, after.standardSizes),
    categoryColors: extensionChange(
      before.categoryColors,
      after.categoryColors,
    ),
    notes: extensionChange(before.notes, after.notes),
  };
}

function extensionChange<T>(
  before: T,
  after: T,
): ExtensionChange<T> | undefined {
  if (before === after || JSON.stringify(before) === JSON.stringify(after))
    return undefined;
  return { before: structuredClone(before), after: structuredClone(after) };
}

function restore(
  project: Project,
  entry: HistoryEntry,
  direction: 'before' | 'after',
): Project {
  const next = structuredClone(project);
  next.name = direction === 'before' ? entry.beforeName : entry.afterName;
  if (entry.allowSpecialOrderStuds)
    next.allowSpecialOrderStuds = entry.allowSpecialOrderStuds[direction];
  if (entry.standardSizes)
    next.standardSizes = structuredClone(entry.standardSizes[direction]);
  if (entry.categoryColors) {
    const colors = entry.categoryColors[direction];
    if (colors) next.categoryColors = structuredClone(colors);
    else delete next.categoryColors;
  }
  if (entry.construction) {
    const construction = entry.construction[direction];
    if (construction) next.construction = structuredClone(construction);
    else delete next.construction;
  }
  if (entry.review) {
    const review = entry.review[direction];
    if (review) next.review = structuredClone(review);
    else delete next.review;
  }
  if (entry.notes) {
    const notes = entry.notes[direction];
    if (notes === undefined) delete next.notes;
    else next.notes = notes;
  }
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
  #calculation: CalculationSnapshot | undefined;
  #takeoffCalculations = new Map<string, CalculationSnapshot>();
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
  /** One immutable result for the current calculation inputs, shared by all readers. */
  get calculation(): CalculationSnapshot {
    return (this.#calculation ??= calculateSnapshot(this.#project));
  }
  calculationFor(id: string): CalculationSnapshot {
    if (id === mainId(this.#project)) return this.calculation;
    let result = this.#takeoffCalculations.get(id);
    if (!result) {
      result = calculateSnapshot(takeoffProject(this.#project, id));
      this.#takeoffCalculations.set(id, result);
    }
    return result;
  }
  takeoffName(id: string): string | undefined {
    return this.#project.takeoffs[id]?.name;
  }
  /** Command metadata does not need a copy of the project's drawing and recipes. */
  get observation(): Pick<CommandRequest, 'projectId' | 'expectedRevision'> {
    return {
      projectId: this.#project.id,
      expectedRevision: this.#project.revision,
    };
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
    if (captured.name === 'takeoff.copyItems' && !captured.takeoffId)
      return Promise.reject(
        new Error('copyItems requires a destination takeoffId'),
      );
    const operation = this.#queue.then(() => this.#execute(captured));
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async #execute(request: CommandRequest): Promise<CommandResult> {
    checkObservation(this.observation, request);
    const definition = validateCommand(request);
    if (request.name === 'history.undo' || request.name === 'history.redo')
      return this.#travel(request.name === 'history.undo');

    let next = this.#project;
    let changed = false;
    let data: unknown;
    const preview = request.name === 'preview';
    const scoped =
      request.takeoffId !== undefined &&
      request.takeoffId !== mainId(this.#project);
    const beforePreview = preview
      ? scoped
        ? calculateSnapshot(takeoffProject(this.#project, request.takeoffId))
        : this.calculation
      : undefined;
    let calculation = scoped
      ? this.#takeoffCalculations.get(request.takeoffId ?? '')
      : this.#calculation;
    let calculationChanged = false;
    const readCalculation = () =>
      (calculation ??= calculateSnapshot(
        takeoffProject(next, request.takeoffId),
      ));
    const execute = (call: CommandCall, validateResult: boolean) => {
      if (
        validateCommand(call).mutates &&
        changesCalculation(takeoffProject(next, call.takeoffId), call)
      ) {
        calculationChanged = true;
        calculation = undefined;
      }
      return executeCommandOnDraft(
        next,
        call,
        validateResult,
        readCalculation,
        request.origin,
      );
    };
    if (request.name === 'batch' || preview) {
      next = structuredClone(next);
      const payload = request.payload as { commands: CommandCall[] };
      const results: unknown[] = [];
      for (const [index, call] of payload.commands.entries()) {
        try {
          if (
            ['batch', 'preview', 'history.undo', 'history.redo'].includes(
              call.name,
            )
          )
            throw new Error(
              'Batches and previews cannot contain session control commands',
            );
          if (call.takeoffId && call.takeoffId !== request.takeoffId)
            throw new Error('Batch commands must share the envelope takeoffId');
          const result = execute(
            {
              ...call,
              ...(request.takeoffId ? { takeoffId: request.takeoffId } : {}),
            },
            false,
          );
          changed ||= result.changed;
          results.push(result.data);
        } catch (error) {
          throw new BatchChildError(
            index,
            call.name,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      validateProject(next);
      data = results;
    } else {
      if (definition.mutates) {
        // Rename changes only top-level metadata; the other records stay private.
        next =
          request.name === 'project.rename'
            ? { ...next }
            : structuredClone(next);
      }
      const result = execute(request, true);
      changed = result.changed;
      data = result.data;
    }
    if (preview) {
      const after = readCalculation();
      return {
        project: next,
        data,
        changed,
        preview,
        previewStatus: {
          calculationComplete: after.complete,
          constructionComplete: after.model.complete,
          diagnostics: [
            ...structuredClone(after.model.diagnostics),
            ...after.outputs
              .filter(
                (output) => output.modeling === 'estimate' && !output.complete,
              )
              .flatMap((output) =>
                output.diagnostics.map((message) => ({
                  assignmentId: output.assignmentId,
                  outputId: output.outputId,
                  message,
                })),
              ),
          ],
        },
        quantityChanges: structuredClone(
          quantityChanges(beforePreview ?? this.calculation, after),
        ),
      };
    }
    if (!changed) {
      if (!scoped) this.#calculation = calculation;
      else if (calculation && request.takeoffId)
        this.#takeoffCalculations.set(request.takeoffId, calculation);
      return { project: structuredClone(next), data, changed, preview: false };
    }

    const entry =
      this.#historyLimit > 0
        ? difference(this.#project, next, request, calculationChanged)
        : undefined;
    await this.#save(
      next,
      calculationChanged,
      scoped ? undefined : calculation,
    );
    if (scoped && calculation && request.takeoffId)
      this.#takeoffCalculations.set(request.takeoffId, calculation);
    if (entry) this.#undo.push(entry);
    if (this.#undo.length > this.#historyLimit) this.#undo.shift();
    this.#redo = [];
    this.#publish();
    return {
      project: this.project,
      data,
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
    await this.#save(next, entry.calculationChanged);
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

  async #save(
    next: Project,
    calculationChanged: boolean,
    calculation?: CalculationSnapshot,
  ): Promise<void> {
    next.revision = this.#project.revision + 1;
    // Adapter code receives copies so it cannot alter accepted state or a pending history entry.
    await this.#persistence.save(this.project, structuredClone(next));
    this.#project = next;
    // A reader may have warmed the accepted cache while persistence was pending.
    if (calculationChanged) this.#takeoffCalculations.clear();
    this.#calculation = calculationChanged
      ? calculation
      : (this.#calculation ?? calculation);
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
