import type {
  Calibration,
  Geometry,
  Measurement,
  Point,
  Project,
  Quantity,
  Unit,
} from './types';
import { starterRecipes } from './calculations';

export function newId(): string {
  return crypto.randomUUID();
}
export function createProject(name: string, id = newId()): Project {
  return {
    formatVersion: 1,
    id,
    name,
    revision: 0,
    sheets: {},
    geometries: {},
    groups: {},
    recipes: starterRecipes(),
    assignments: {},
  };
}

const units: Record<Unit, { dimension: string; factor: number }> = {
  m: { dimension: 'length', factor: 1 },
  mm: { dimension: 'length', factor: 0.001 },
  ft: { dimension: 'length', factor: 0.3048 },
  in: { dimension: 'length', factor: 0.0254 },
  m2: { dimension: 'area', factor: 1 },
  ft2: { dimension: 'area', factor: 0.3048 ** 2 },
  ea: { dimension: 'count', factor: 1 },
  scalar: { dimension: 'scalar', factor: 1 },
};
export function convertQuantity(quantity: Quantity, unit: Unit): Quantity {
  const from = units[quantity.unit];
  const to = units[unit];
  if (from.dimension !== to.dimension)
    throw new Error(`Cannot convert ${quantity.unit} to ${unit}`);
  const value = (quantity.value * from.factor) / to.factor;
  if (!Number.isFinite(value)) throw new Error('Quantity must be finite');
  return { value, unit };
}
export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function finitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
export function calibrationFromDistance(
  start: Point,
  end: Point,
  quantity: Quantity,
): Calibration {
  if (!finitePoint(start) || !finitePoint(end))
    throw new Error('Calibration points must be finite');
  const pageLength = distance(start, end);
  const metres = convertQuantity(quantity, 'm').value;
  if (pageLength <= 0 || metres <= 0)
    throw new Error(
      'Calibration requires positive page and physical distances',
    );
  const metresPerUnit = metres / pageLength;
  if (!Number.isFinite(metresPerUnit) || metresPerUnit <= 0)
    throw new Error('Calibration scale must be finite and positive');
  return { metresPerUnit };
}
export function pathLength(points: readonly Point[]): number {
  let result = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) result += distance(a, b);
  }
  return result;
}
export function polygonArea(points: readonly Point[]): number {
  let sum = 0;
  // Translate to the first vertex to avoid cancellation with large page offsets.
  const origin = points[0];
  if (!origin) return 0;
  for (let i = 1; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a && b)
      sum +=
        (a.x - origin.x) * (b.y - origin.y) -
        (b.x - origin.x) * (a.y - origin.y);
  }
  return Math.abs(sum) / 2;
}
function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function onSegment(p: Point, a: Point, b: Point): boolean {
  return (
    cross(a, b, p) === 0 &&
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y)
  );
}
function intersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (
    (abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0) ||
    onSegment(c, a, b) ||
    onSegment(d, a, b) ||
    onSegment(a, c, d) ||
    onSegment(b, c, d)
  );
}
export function validateGeometry(geometry: Geometry): void {
  const { points, kind } = geometry;
  if (points.some((point) => !finitePoint(point)))
    throw new Error('Geometry points must be finite');
  const minimum = kind === 'area' ? 3 : kind === 'path' ? 2 : 1;
  if (points.length < minimum)
    throw new Error(`${kind} requires at least ${String(minimum)} points`);
  if (kind === 'count') return;
  for (let i = 0; i < points.length - (kind === 'path' ? 1 : 0); i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a && b && distance(a, b) === 0)
      throw new Error('Geometry has a zero-length edge');
  }
  if (kind === 'path') {
    if (!Number.isFinite(pathLength(points)))
      throw new Error('Geometry length is not finite');
    return;
  }
  const area = polygonArea(points);
  if (!Number.isFinite(area) || area <= 0)
    throw new Error('Area polygon must have positive finite area');
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const previous = points[(i + points.length - 1) % points.length];
    if (!a || !b || !previous) continue;
    if (
      cross(previous, a, b) === 0 &&
      (previous.x - a.x) * (b.x - a.x) + (previous.y - a.y) * (b.y - a.y) > 0
    )
      throw new Error('Area edges overlap');
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j];
      const d = points[(j + 1) % points.length];
      if (c && d && intersects(a, b, c, d))
        throw new Error('Area polygon must not intersect itself');
    }
  }
}
export function measureGeometry(
  project: Project,
  geometry: Geometry,
): Measurement {
  try {
    validateGeometry(geometry);
  } catch (error) {
    return {
      diagnostic: error instanceof Error ? error.message : 'Invalid geometry',
    };
  }
  const sheet = project.sheets[geometry.sheetId];
  if (!sheet) return { diagnostic: 'Geometry sheet is unavailable' };
  if (geometry.kind === 'count')
    return { count: { value: geometry.points.length, unit: 'ea' } };
  const scale = sheet.calibration?.metresPerUnit;
  if (scale === undefined) return { diagnostic: 'Sheet is not calibrated' };
  if (!Number.isFinite(scale) || scale <= 0)
    return { diagnostic: 'Sheet calibration must be finite and positive' };
  if (geometry.kind === 'path') {
    const length = pathLength(geometry.points) * scale;
    return Number.isFinite(length)
      ? { length: { value: length, unit: 'm' } }
      : { diagnostic: 'Measured length is not finite' };
  }
  const first = geometry.points[0];
  const last = geometry.points.at(-1);
  const area = polygonArea(geometry.points) * scale ** 2;
  const perimeter =
    (pathLength(geometry.points) +
      (first && last ? distance(first, last) : 0)) *
    scale;
  if (!Number.isFinite(area) || !Number.isFinite(perimeter))
    return { diagnostic: 'Measured area or perimeter is not finite' };
  return {
    area: { value: area, unit: 'm2' },
    perimeter: { value: perimeter, unit: 'm' },
  };
}
export function nearestPointOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const squared = dx * dx + dy * dy;
  const t =
    squared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared),
        );
  return { x: a.x + t * dx, y: a.y + t * dy };
}
export function pointInPolygon(
  point: Point,
  points: readonly Point[],
): boolean {
  let inside = false;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (!a || !b) continue;
    if (onSegment(point, a, b)) return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
function edgeCandidates(point: Point, geometry: Geometry): Point[] {
  const candidates = [...geometry.points];
  if (geometry.kind === 'count') return candidates;
  for (
    let i = 0;
    i < geometry.points.length - (geometry.kind === 'path' ? 1 : 0);
    i++
  ) {
    const a = geometry.points[i];
    const b = geometry.points[(i + 1) % geometry.points.length];
    if (a && b) candidates.push(nearestPointOnSegment(point, a, b));
  }
  return candidates;
}
export function hitTestGeometry(
  geometry: Geometry,
  point: Point,
  tolerance: number,
): boolean {
  return (
    (geometry.kind === 'area' && pointInPolygon(point, geometry.points)) ||
    edgeCandidates(point, geometry).some(
      (candidate) => distance(point, candidate) <= tolerance,
    )
  );
}
/** Caller supplies geometry from the active sheet; snapping creates no shared topology. */
export function snapPoint(
  point: Point,
  geometries: readonly Geometry[],
  tolerance: number,
): Point {
  let best = { ...point };
  let nearest = tolerance;
  for (const geometry of geometries)
    for (const candidate of edgeCandidates(point, geometry)) {
      const separation = distance(point, candidate);
      if (separation <= nearest) {
        nearest = separation;
        best = { ...candidate };
      }
    }
  return best;
}
