import type {
  ConstructionContext,
  ConstructionResult,
  Wall,
  Ceiling,
  ConstructionSource,
} from './construction-types';
import type { ReviewData } from './review';
import type { quantityChanges } from './quantity-changes';
import type { MaterialTemplate } from './material-layout';

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
  order?: number;
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
  default?: number | boolean;
  minimum?: number;
}
export interface OutputAllowance {
  wastePercent: number;
  packageSize?: number;
}
export interface LengthFormula {
  formula: string;
  unit: LengthUnit;
}
export interface RecipeOutput {
  id: string;
  name: string;
  materialId: string;
  unit: Unit;
  formula: string;
  allowance: OutputAllowance;
  /** Piece outputs use ea, with an integer quantity and positive lengths. */
  piece?: {
    role: string;
    cutLength: LengthFormula;
    stockLength?: LengthFormula;
  };
}
export type WallTemplate = Omit<
  Wall,
  | 'id'
  | 'geometryId'
  | 'levelId'
  | 'topProfile'
  | 'conditions'
  | keyof ConstructionSource
>;
export type CeilingTemplate = Omit<
  Ceiling,
  'id' | 'geometryId' | 'levelId' | keyof ConstructionSource
>;
export type MaterialOverrides<T> = {
  [K in keyof T]?: NonNullable<T[K]> extends readonly unknown[]
    ? T[K]
    : NonNullable<T[K]> extends object
      ? MaterialOverrides<NonNullable<T[K]>>
      : T[K] | null;
};
export type WallOverrides = MaterialOverrides<
  Omit<Wall, 'id' | 'geometryId' | keyof ConstructionSource>
>;
export type CeilingOverrides = MaterialOverrides<
  Omit<Ceiling, 'id' | 'geometryId' | keyof ConstructionSource>
>;
export type LayoutOverrides = MaterialOverrides<
  Omit<MaterialTemplate, 'kind'> & { levelId?: string }
>;

export interface Recipe {
  id: string;
  name: string;
  category?: string;
  description?: string;
  reference?: string;
  librarySource?: { id: string; name: string };
  geometryKinds: GeometryKind[];
  inputs: RecipeInput[];
  outputs: RecipeOutput[];
  /** Systems have components and no direct outputs. Nested systems are unsupported. */
  components?: AssemblyComponent[];
  /** Typed material generator. Applications resolve these defaults on every calculation. */
  wallTemplate?: WallTemplate;
  ceilingTemplate?: CeilingTemplate;
  materialTemplate?: MaterialTemplate;
}
export interface AssemblyComponent {
  /** Stable identity within the system, independent of the snapshot's recipe id. */
  id: string;
  assembly: Recipe;
  /** Component input name -> shared system input name. Unbound inputs use defaults. */
  bindings: Record<string, string>;
}
/** Assemblies extend the existing project recipe records without duplicating calculations. */
export type Assembly = Recipe;
export interface AssemblyLibrary {
  version: 2;
  revision: number;
  assemblies: Record<string, Assembly>;
}
export interface Assignment {
  id: string;
  groupId: string;
  recipeId: string;
  inputs: Record<string, number | boolean>;
  allowances: Record<string, OutputAllowance>;
  geometryInputs?: Record<string, Record<string, number | boolean>>;
  wallOverrides?: WallOverrides;
  ceilingOverrides?: CeilingOverrides;
  materialOverrides?: LayoutOverrides;
  geometryDetails?: Record<
    string,
    {
      id?: string;
      wall?: WallOverrides;
      ceiling?: CeilingOverrides;
      material?: LayoutOverrides;
    }
  >;
}
export interface Project {
  formatVersion: 4;
  id: string;
  name: string;
  revision: number;
  sheets: Record<string, Sheet>;
  geometries: Record<string, Geometry>;
  groups: Record<string, Group>;
  recipes: Record<string, Recipe>;
  assignments: Record<string, Assignment>;
  construction?: ConstructionContext;
  review?: ReviewData;
}
export interface Measurement {
  length?: Quantity;
  area?: Quantity;
  perimeter?: Quantity;
  count?: Quantity;
  diagnostic?: string;
}
export interface CalculationSource {
  pieceId?: string;
  surfaceId?: string;
  pieceRole?: string;
  geometryId: string;
  inputs: Record<string, number | boolean>;
  value: number | null;
  diagnostic?: string;
  cutLength?: Quantity;
  stockLength?: Quantity;
}
export interface CalculationOutput {
  /** Formula estimates have no invented material geometry. */
  modeling: 'modeled' | 'estimate' | 'unresolved';
  groupId: string;
  assignmentId: string;
  recipeId: string;
  outputId: string;
  materialId: string;
  name: string;
  unit: Unit;
  sources: CalculationSource[];
  role?: string;
  cutLength?: Quantity;
  stockLength?: Quantity;
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
  cutLength?: Quantity;
  stockLength?: Quantity;
  materialId: string;
  unit: Unit;
  amount: number;
  complete: boolean;
}
export interface CalculationResult {
  model: ConstructionResult;
  coverage: {
    modeledOutputs: number;
    estimateOutputs: number;
    complete: boolean;
  };
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
  quantityChanges?: ReturnType<typeof quantityChanges>;
}
