/** Coordinates are unzoomed PDF viewport units (72/in), origin top-left, +y down. */
export interface Point {
  x: number;
  y: number;
}
export type LengthUnit = 'm' | 'mm' | 'ft' | 'in';
export type Unit = LengthUnit | 'm2' | 'ft2' | 'ea' | 'scalar';
export interface Quantity {
  value: number;
  unit: Unit;
}
export interface Calibration {
  metresPerUnit: number;
}
export interface Sheet {
  id: string;
  name: string;
  assetId: string;
  pageIndex: number;
  width: number;
  height: number;
  rotation?: number;
  pdfToPage?: [number, number, number, number, number, number];
  calibration?: Calibration;
}
export type GeometryKind = 'path' | 'area' | 'count';
export interface Geometry {
  id: string;
  sheetId: string;
  name: string;
  kind: GeometryKind;
  points: Point[];
}
export interface Group {
  id: string;
  name: string;
  geometryIds: string[];
  color?: string;
}
export interface RecipeInput {
  name: string;
  type: 'number' | 'boolean';
  unit: Unit;
  default: number | boolean;
}
export interface OutputAllowance {
  wastePercent: number;
  packageSize?: number;
}
export interface RecipeOutput {
  id: string;
  name: string;
  materialId: string;
  unit: Unit;
  formula: string;
  allowance: OutputAllowance;
}
export interface Recipe {
  id: string;
  name: string;
  geometryKinds: GeometryKind[];
  inputs: RecipeInput[];
  outputs: RecipeOutput[];
}
export interface Assignment {
  id: string;
  groupId: string;
  recipeId: string;
  inputs: Record<string, number | boolean>;
  allowances: Record<string, OutputAllowance>;
}
export interface Project {
  formatVersion: 1;
  id: string;
  name: string;
  revision: number;
  sheets: Record<string, Sheet>;
  geometries: Record<string, Geometry>;
  groups: Record<string, Group>;
  recipes: Record<string, Recipe>;
  assignments: Record<string, Assignment>;
}
export interface Measurement {
  length?: Quantity;
  area?: Quantity;
  perimeter?: Quantity;
  count?: Quantity;
  diagnostic?: string;
}
export interface CalculationSource {
  geometryId: string;
  inputs: Record<string, number | boolean>;
  value: number | null;
  diagnostic?: string;
}
export interface CalculationOutput {
  groupId: string;
  assignmentId: string;
  recipeId: string;
  outputId: string;
  materialId: string;
  name: string;
  unit: Unit;
  sources: CalculationSource[];
  baseAmount: number;
  wastePercent: number;
  wasteAmount: number;
  adjustedAmount: number;
  packageCount: number | null;
  purchasedAmount: number;
  complete: boolean;
  diagnostics: string[];
}
export interface QuantityTotal {
  outputId: string;
  materialId: string;
  unit: Unit;
  amount: number;
  complete: boolean;
}
export interface CalculationResult {
  outputs: CalculationOutput[];
  totals: QuantityTotal[];
  complete: boolean;
}
export interface PersistencePort {
  save(previousProject: Project, nextProject: Project): Promise<void>;
}
export interface CommandCall {
  name: string;
  payload?: unknown;
}
export interface CommandRequest extends CommandCall {
  projectId: string;
  expectedRevision: number;
  origin?: string;
}
export interface CommandResult {
  project: Project;
  data: unknown;
  changed: boolean;
  preview: boolean;
}
