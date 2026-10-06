import { calculateProject } from './calculations';
import type { CalculationResult, CommandCall, Project } from './types';

type Immutable<T> = T extends object
  ? { readonly [K in keyof T]: Immutable<T[K]> }
  : T;

/** Shared within a session. Command results remain independently mutable copies. */
export type CalculationSnapshot = Immutable<CalculationResult>;
export type ConstructionSnapshot = CalculationSnapshot['model'];

function freeze<T>(value: T): Immutable<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value as Immutable<T>;
}

export function calculateSnapshot(project: Project): CalculationSnapshot {
  return freeze(calculateProject(project));
}

function sameExcept(
  previous: object | undefined,
  next: object,
  presentationFields: readonly string[],
): boolean {
  if (!previous) return false;
  const inputs = (record: object) =>
    Object.fromEntries(
      Object.entries(record).filter(
        ([key]) => !presentationFields.includes(key),
      ),
    );
  return JSON.stringify(inputs(previous)) === JSON.stringify(inputs(next));
}

/** Called before a mutation, against its current draft. New commands invalidate
 * by default. Compare only the replaced record, never the whole project.
 * Keep recipe/output names conservative: some are part of calculated labels.
 */
export function changesCalculation(
  project: Project,
  call: CommandCall,
): boolean {
  const payload = (call.payload ?? {}) as Record<string, unknown>;
  const id = payload.id as string;
  switch (call.name) {
    case 'project.rename':
    case 'snippet.put':
    case 'snippet.delete':
    case 'review.mark':
      return false;
    case 'sheet.put':
      return !sameExcept(project.sheets[id], payload, ['name', 'order']);
    case 'geometry.put':
      return !sameExcept(project.geometries[id], payload, ['name']);
    case 'group.put':
      return !sameExcept(project.groups[id], payload, ['name', 'color']);
    default:
      return true;
  }
}
