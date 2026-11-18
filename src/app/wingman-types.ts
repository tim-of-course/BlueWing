import type { PlanSnippet } from '../core/review';
import type { DisplayMode, SceneCamera } from '../three/scene';
import type { DrawingTool, WorkspaceContext } from './contracts';
import type { CategoryFilter } from '../core/categories';

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PlanView {
  kind: 'plan';
  sheetId: string;
  bounds: ViewBounds;
  mode?: 'plan' | 'takeoff' | 'combined';
  highlightIds?: string[];
  annotations?: PlanSnippet['annotations'];
  visibleGeometryIds?: string[];
  categories?: CategoryFilter;
}
export interface ModelView {
  kind: '3d';
  camera: SceneCamera;
  sheetIds?: string[];
  alignment?: 'saved' | 'none';
  pageMode?: 'current' | 'combined' | 'explicit';
  displayMode?: DisplayMode;
  showPlan?: boolean;
  geometryIds?: string[];
  levelId?: string;
  materialId?: string;
  role?: string;
  selectedGeometryIds?: string[];
  selectedPieceId?: string | null;
  selectedOnly?: boolean;
  categories?: CategoryFilter;
}
export type WingmanView = PlanView | ModelView;
export interface WingmanVisual {
  projectId: string;
  takeoffId: string;
  revision: number;
  view: WingmanView;
  caption?: string;
}
export type ActivityCategory = 'Looked at' | 'Read' | 'Changed' | 'Rendered';
export const constructionTargets = {
  wall: 'walls',
  opening: 'openings',
  header: 'headers',
  ceiling: 'ceilings',
  level: 'levels',
  placement: 'placements',
} as const;
export interface ActivityTarget {
  kind:
    | 'sheet'
    | 'geometry'
    | 'group'
    | 'takeoff'
    | 'assembly'
    | 'snippet'
    | keyof typeof constructionTargets;
  id: string;
  label: string;
}
export interface WingmanActivity {
  id: string;
  startedAt: number;
  turnStartedAt?: number;
  afterMessageId: number;
  command: string;
  category: ActivityCategory;
  description: string;
  outcome: 'working' | 'succeeded' | 'failed';
  takeoffId?: string;
  takeoffName?: string;
  visual?: WingmanVisual;
  targets?: ActivityTarget[];
}

export interface WorkspaceViewSnapshot {
  projectId: string;
  takeoffId: string;
  mode: 'plan' | '3d' | 'split';
  plan: PlanView | null;
  model: ModelView | null;
  context: WorkspaceContext;
  quantities: boolean;
  tool: DrawingTool;
}
export interface ViewportPort<T> {
  read(): T | null;
  apply(view: T): void;
}
/** Presentation is local UI state; publishing it never edits the takeoff. */
export interface WingmanPresentation {
  hasMessageDraft(): boolean;
  /** False when the user is viewing another project or takeoff, so nothing is shown. */
  publish(visual: WingmanVisual): boolean;
  inspect(): unknown;
  flash(): void;
  annotate(
    annotations: PlanSnippet['annotations'],
    highlightIds?: string[],
  ): void;
}
