import type { Point } from './types';

/** Physical lengths are metres, rotation is radians, world Z points up. */
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
export interface WallFinish {
  id: string;
  materialId: string;
  face: 'front' | 'back';
  layers: number;
  offset?: number;
  /** Height above wall base, clipped by the wall top. Omit for full height. */
  height?: number;
  /** Thickness of each layer. */
  thickness?: number;
  /** Additional unpositioned deduction in square metres per layer, after openings. */
  deduction?: number;
  wastePercent?: number;
  /** Square metres per purchased package. */
  packageSize?: number;
}
export interface BackingRun {
  id: string;
  height: number;
  member: MemberSpec;
}
export interface Wall {
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
export interface Ceiling {
  id: string;
  geometryId: string;
  levelId?: string;
  elevation: number;
  materialId: string;
  layers: number;
  /** Reference surfaces render but do not add quantities; reference is the default. */
  quantityMode?: 'reference' | 'included';
}
export interface ConstructionData {
  walls: Record<string, Wall>;
  openings: Record<string, Opening>;
  headers: Record<string, HeaderDetail>;
  levels: Record<string, Level>;
  placements: Record<string, SheetPlacement>;
  ceilings: Record<string, Ceiling>;
}
export interface ConstructionSource {
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
  width: number;
  depth: number;
  sectionRotation: number;
  /** Unit world vector for section width, including sectionRotation. */
  widthAxis?: Vec3;
}
/** Opening-free patches. area includes layers and authored deductions; geometricArea is one layer before unpositioned deductions. */
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
  quantityMode?: 'reference' | 'included';
  wastePercent?: number;
  packageSize?: number;
}
export interface ConstructionPurchase {
  materialId: string;
  stockLength: number;
  requiredCount: number;
  wastePercent: number;
  /** Required count plus waste, before package or whole-piece rounding. */
  adjustedCount: number;
  pieceIds: string[];
  purchasedCount: number;
  packageCount: number | null;
}
export interface ConstructionSurfacePurchase extends ConstructionSource {
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
  purchases: ConstructionPurchase[];
  /** Area purchasing rounds once per authored finish/ceiling, never per polygon patch. */
  surfacePurchases?: ConstructionSurfacePurchase[];
  diagnostics: ConstructionDiagnostic[];
  complete: boolean;
}
