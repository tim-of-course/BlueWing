import type { Accessor } from 'solid-js';
import type { Observation } from './application';
import type {
  CalculationResult,
  GeometryKind,
  Point,
  Project,
  Recipe,
  Sheet,
  Unit,
} from '../core/types';

export type DrawingTool = 'select' | 'path' | 'area' | 'count' | 'calibrate';
export interface WorkspaceController {
  project: Accessor<Project | null>;
  quantities: Accessor<CalculationResult | null>;
  activeSheetId: Accessor<string | null>;
  setActiveSheetId(id: string | null): void;
  selection: Accessor<string[]>;
  setSelection(ids: string[]): void;
  activeGroupId: Accessor<string | null>;
  setActiveGroupId(id: string | null): void;
  busy: Accessor<boolean>;
  error: Accessor<string | null>;
  dismissError(): void;
  saved: Accessor<boolean>;
  canUndo: Accessor<boolean>;
  canRedo: Accessor<boolean>;
  native: boolean;
  observe(): Observation;
  setDraftPending(pending: boolean): void;
  createProject(name: string): Promise<void>;
  openProject(): Promise<void>;
  closeProject(): Promise<void>;
  renameProject(name: string): Promise<void>;
  importPdf(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  addGeometry(
    kind: GeometryKind,
    points: Point[],
    name?: string,
    expected?: Observation,
  ): Promise<string>;
  updateGeometry(
    id: string,
    patch: { name?: string; points?: Point[] },
    expected?: Observation,
  ): Promise<void>;
  deleteSelection(): Promise<void>;
  copySelection(): Promise<void>;
  moveSelection(dx: number, dy: number, expected?: Observation): Promise<void>;
  calibrate(
    sheetId: string,
    from: Point,
    to: Point,
    length: number,
    unit: Unit,
    expected?: Observation,
  ): Promise<void>;
  createGroup(name: string, color: string): Promise<string>;
  updateGroup(
    id: string,
    patch: { name?: string; color?: string },
    expected?: Observation,
  ): Promise<void>;
  deleteGroup(id: string): Promise<void>;
  duplicateGroup(id: string): Promise<string>;
  setMembership(groupId: string, geometryIds: string[]): Promise<void>;
  assignRecipe(groupId: string, recipeId: string): Promise<string>;
  updateAssignment(
    id: string,
    inputs: Record<string, number | boolean>,
    allowances: Record<string, { wastePercent: number; packageSize?: number }>,
    expected?: Observation,
  ): Promise<void>;
  deleteAssignment(id: string): Promise<void>;
  saveRecipe(recipe: Recipe, expected?: Observation): Promise<void>;
  deleteRecipe(id: string): Promise<void>;
  renderSheet(sheet: Sheet, maxDimension?: number): Promise<HTMLCanvasElement>;
  exportQuantities(format: 'csv' | 'json'): Promise<void>;
  installWebUpdate(manifestUrl: string): Promise<string>;
  activateWebUpdate(version: string): Promise<void>;
}
