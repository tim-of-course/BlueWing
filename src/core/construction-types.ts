import type {
  FacePackaging,
  OrderCoverage,
  SheetChoice,
} from './face-ordering';
import type { Point } from './types';
import type { CeilingGridSpec } from './ceiling-grid';
import type { MaterialApplication } from './material-layout';

/** Physical lengths are feet, rotation is radians, world Z points up. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
/** Rectangular display envelopes do not imply solid material in channel tracks. */
export interface MemberSpec {
  materialId: string;
  /** Rectangular rendered section: along-wall for verticals, face-normal for horizontals. */
  width: number;
  /** Rectangular rendered section: face-normal for verticals, vertical for horizontals. */
  depth: number;
  stockLength?: number;
  wastePercent?: number;
  packageSize?: number;
}
export interface WallKickers {
  enabled: boolean;
  spacing: number;
  cutLength?: number;
  member: MemberSpec;
}

export interface HeightPoint {
  distance: number;
  height: number;
}
export interface HeightProfile {
  mode: 'linear' | 'step';
  points: HeightPoint[];
}
export interface MemberOffset {
  along: number;
  face: number;
  rotation?: number;
}
/** Replaces the ordinary stud at this station. Only ownerWallId generates shared members. */
export interface WallCondition {
  id: string;
  distance: number;
  kind: 'end' | 'corner' | 'junction';
  count: number;
  ownerWallId?: string;
  memberOffsets?: MemberOffset[];
}
export interface WallFinish extends FacePackaging {
  id: string;
  materialId: string;
  face: 'front' | 'back';
  layers: number;
  offset?: number;
  /** Bottom above the wall base in feet. Omit to start at the base. */
  startHeight?: number;
  /** Top above the wall base in feet, clipped by the wall top. Omit to follow the wall top. */
  height?: number;
  /** Thickness of each layer. */
  thickness?: number;
  wastePercent?: number;
  /** Square feet per purchased package. */
  packageSize?: number;
}
export interface BackingRun {
  id: string;
  height: number;
  member: MemberSpec;
}
export interface Wall extends ConstructionSource {
  id: string;
  geometryId: string;
  levelId?: string;
  baseElevation: number;
  height?: number;
  topProfile?: HeightProfile;
  studSpacing: number;
  studOffset?: number;
  stud: MemberSpec;
  track: MemberSpec;
  kickers?: WallKickers;
  /** Exact vertical offset above wall base for stud/jamb bottoms; defaults to zero. */
  bottomAllowance?: number;
  /** Exact vertical deduction from local top height, also on slopes; defaults to zero. */
  topAllowance?: number;
  conditions?: WallCondition[];
  finishes?: WallFinish[];
  backing?: BackingRun[];
}
export interface Opening {
  id: string;
  wallId: string;
  distance: number;
  width: number;
  /** Rough sill above wall base: sill channel centreline and lower cripple top. */
  sill: number;
  height: number;
  jambCount: number;
  jamb?: MemberSpec;
  sillMember?: MemberSpec;
  headerId?: string;
  /** Offsets from nominal centres half the rotated section outside each rough edge.
   * Positive along moves into framing, mirrored left/right; face follows the wall
   * normal on both sides. Required for multiple jamb members. */
  jambOffsets?: MemberOffset[];
}
/** Exact cuts span rough width plus extensions. Offsets place section centrelines
 * relative to the rough head. Rectangular physical approximations, including
 * rotated depth, bound cripple cuts. Member counts do not imply structural design. */
export interface HeaderComponent {
  id: string;
  role: string;
  member: MemberSpec;
  startExtension: number;
  endExtension: number;
  verticalOffset: number;
  faceOffset: number;
  sectionRotation?: number;
}
export interface HeaderDetail {
  id: string;
  name: string;
  reference?: string;
  components: HeaderComponent[];
}
export interface Level {
  id: string;
  name: string;
  elevation: number;
}
export interface SheetPlacement {
  id: string;
  sheetId: string;
  pageOrigin: Point;
  worldOffset: Vec3;
  rotation: number;
}
export interface Ceiling extends ConstructionSource {
  board?: SheetChoice;
  id: string;
  geometryId: string;
  levelId?: string;
  /** Finished underside above the level; grid envelopes and finish thickness extend upward. */
  elevation: number;
  materialId: string;
  layers: number;
  thickness?: number;
  wastePercent?: number;
  packageSize?: number;
  grid?: CeilingGridSpec;
}
export interface ConstructionContext {
  openings: Record<string, Opening>;
  headers: Record<string, HeaderDetail>;
  levels: Record<string, Level>;
  placements: Record<string, SheetPlacement>;
}
/** Resolved applications, never stored alongside their assembly definitions. */
export interface ConstructionData extends ConstructionContext {
  walls: Record<string, Wall>;
  ceilings: Record<string, Ceiling>;
  materials?: Record<string, MaterialApplication>;
}
export interface ConstructionSource {
  direction?: 'add' | 'deduct';
  assignmentId?: string;
  recipeId?: string;
  groupId?: string;
  componentId?: string;
  wallId?: string;
  geometryId?: string;
  openingId?: string;
  ceilingId?: string;
  finishId?: string;
}
export interface ConstructionDiagnostic extends ConstructionSource {
  code: string;
  message: string;
}
export interface ConstructionPiece extends ConstructionSource {
  id: string;
  materialId: string;
  role: string;
  start: Vec3;
  end: Vec3;
  /** Length of the displayed piece. Unresolved connection diagnostics make schedules provisional. */
  cutLength: number;
  stockLength?: number;
  wastePercent?: number;
  packageSize?: number;
  width: number;
  depth: number;
  sectionRotation: number;
  /** Unit world vector for section width, including sectionRotation. */
  widthAxis?: Vec3;
}
/** Opening-free patches. Area is always geometricArea multiplied by layers. */
export interface ConstructionSurface extends ConstructionSource {
  id: string;
  materialId: string;
  face: 'front' | 'back' | 'ceiling';
  layers: number;
  points: Vec3[];
  geometricArea: number;
  area: number;
  /** Total thickness across all layers. */
  thickness?: number;
  wastePercent?: number;
  packageSize?: number;
}
export interface ConstructionPurchase extends ConstructionSource {
  /** Exact key used by summarizeMaterials, before presentation. */
  quantityKey?: string;
  role: string;
  materialId: string;
  stockLength: number;
  requiredCount: number;
  /** Stock sticks before waste. Absent for pieces ordered by cut length. */
  packedCount?: number;
  category?: string;
  purchasedLength: number;
  packageSize?: number;
  wastePercent: number;
  /** Purchasing base plus waste, before package or whole-piece rounding. */
  adjustedCount: number;
  pieceIds: string[];
  purchasedCount: number;
  packageCount: number | null;
}
export interface FaceRequirement extends ConstructionSource, OrderCoverage {
  materialId: string;
  grossArea: number;
  wastePercent: number;
  packageSize?: number;
  surfaceIds: string[];
}
export interface ConstructionSurfacePurchase
  extends ConstructionSource, OrderCoverage {
  grossArea?: number;
  openingArea?: number;
  quantityKey?: string;
  surfaceIds: string[];
  materialId: string;
  requiredArea: number;
  wastePercent: number;
  packageSize?: number;
  packageCount: number | null;
  purchasedArea: number;
}
export interface ConstructionOptions {
  /** Shared ceiling for emitted pieces and surface patches. Defaults to 50,000. */
  maxPieces?: number;
}
export interface ConstructionResult {
  pieces: ConstructionPiece[];
  surfaces: ConstructionSurface[];
  faceRequirements?: FaceRequirement[];
  purchases: ConstructionPurchase[];
  /** Area purchasing rounds once per authored finish/ceiling, never per polygon patch. */
  surfacePurchases?: ConstructionSurfacePurchase[];
  diagnostics: ConstructionDiagnostic[];
  complete: boolean;
}
