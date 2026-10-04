import type { PlanSnippet } from '../core/review';
import type { DisplayMode, SceneCamera } from '../three/scene';
import type { DrawingTool, WorkspaceContext } from './contracts';

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
}
export interface ModelView {
  kind: '3d';
  camera: SceneCamera;
  displayMode?: DisplayMode;
  geometryIds?: string[];
  levelId?: string;
  materialId?: string;
  role?: string;
  selectedGeometryIds?: string[];
  selectedPieceId?: string | null;
  selectedOnly?: boolean;
}
export type WingmanView = PlanView | ModelView;
export interface WingmanVisual {
  projectId: string;
  revision: number;
  view: WingmanView;
  caption?: string;
}
export interface WorkspaceViewSnapshot {
  projectId: string;
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
  publish(visual: WingmanVisual): void;
  inspect(): unknown;
  flash(): void;
  annotate(
    annotations: PlanSnippet['annotations'],
    highlightIds?: string[],
  ): void;
}
