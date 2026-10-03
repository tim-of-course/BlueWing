import type {
  ConstructionDiagnostic,
  ConstructionPiece,
  ConstructionSurface,
  MemberSpec,
} from './construction-types';
import type { Point } from './types';
import { pointInPolygon, polygonArea, validateGeometry } from './geometry';

const FOOT = 0.3048;
const MODULE = 2 * FOOT;
const MAIN_SPACING = 4 * FOOT;
const EPS = 1e-8;

/** All dimensions are metres. The main direction is rotation radians from +X. */
export interface CeilingGridSpec {
  system: '2x2' | '2x4';
  /** World-space intersection of a main runner and a 4 ft cross-tee row. */
  origin: Point;
  rotation: number;
  main: MemberSpec & { stockLength: number };
  crossTee4: MemberSpec;
  crossTee2?: MemberSpec;
  wallAngle: MemberSpec & { stockLength: number };
}

export interface CeilingGridInput extends CeilingGridSpec {
  id: string;
  geometryId: string;
  /** Calibrated, positioned, simple polygon in world XY. Either winding works. */
  boundary: readonly Point[];
  /** Finished underside datum. Member envelopes and tile thickness extend upward. */
  elevation: number;
  tile: {
    materialId: string;
    thickness?: number;
    wastePercent?: number;
    /** Coverage in square metres per purchased package. */
    packageSize?: number;
  };
  maxElements?: number;
}

export interface CeilingGridResult {
  pieces: ConstructionPiece[];
  /** Clipped tile footprints. Surface patches measure area, not purchased tiles. */
  surfaces: ConstructionSurface[];
  diagnostics: ConstructionDiagnostic[];
  complete: boolean;
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function finitePoint(point: Point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function member(spec: MemberSpec, label: string, stock?: number) {
  requireValue(spec.materialId.trim(), `${label} needs a material`);
  for (const name of ['width', 'depth'] as const)
    requireValue(
      Number.isFinite(spec[name]) && spec[name] > 0,
      `${label} ${name} must be positive`,
    );
  if (spec.stockLength !== undefined)
    requireValue(
      Number.isFinite(spec.stockLength) && spec.stockLength > 0,
      `${label} stock length must be positive`,
    );
  if (stock !== undefined && spec.stockLength !== undefined)
    requireValue(
      Math.abs(spec.stockLength - stock) <= EPS,
      `${label} stock length must match its nominal module`,
    );
  if (spec.wastePercent !== undefined)
    requireValue(
      Number.isFinite(spec.wastePercent) && spec.wastePercent >= 0,
      `${label} waste must be nonnegative`,
    );
  if (spec.packageSize !== undefined)
    requireValue(
      Number.isInteger(spec.packageSize) && spec.packageSize > 0,
      `${label} package size must be a positive whole number`,
    );
}

/** Cheap validation also used by assembly/command validation before generating. */
export function validateCeilingGrid(spec: CeilingGridSpec): void {
  requireValue(
    ['2x2', '2x4'].includes(spec.system),
    'Ceiling grid must be 2x2 or 2x4',
  );
  requireValue(finitePoint(spec.origin), 'Grid origin must be finite');
  requireValue(Number.isFinite(spec.rotation), 'Grid rotation must be finite');
  member(spec.main, 'Main runner');
  member(spec.crossTee4, '4 ft cross tee', MAIN_SPACING);
  member(spec.wallAngle, 'Wall angle');
  for (const [label, specMember] of [
    ['Main runner', spec.main],
    ['Wall angle', spec.wallAngle],
  ] as const)
    requireValue(
      Number.isFinite(specMember.stockLength) && specMember.stockLength > 0,
      `${label} needs a positive stock length`,
    );
  requireValue(
    spec.system !== '2x2' || spec.crossTee2,
    '2x2 ceilings need a 2 ft cross-tee specification',
  );
  if (spec.crossTee2) member(spec.crossTee2, '2 ft cross tee', MODULE);
}

function onEdge(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  return (
    Math.abs(dx * (point.y - a.y) - dy * (point.x - a.x)) <=
      EPS * Math.max(EPS, Math.hypot(dx, dy)) &&
    point.x >= Math.min(a.x, b.x) - EPS &&
    point.x <= Math.max(a.x, b.x) + EPS &&
    point.y >= Math.min(a.y, b.y) - EPS &&
    point.y <= Math.max(a.y, b.y) + EPS
  );
}

function onBoundary(point: Point, polygon: readonly Point[]) {
  return polygon.some((a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return b !== undefined && onEdge(point, a, b);
  });
}

/** All disjoint interior spans of an axis-aligned line, including concave rooms. */
function spans(
  polygon: readonly Point[],
  axis: 'x' | 'y',
  station: number,
  boundary = false,
  minimum = -Infinity,
  maximum = Infinity,
): [number, number][] {
  const fixed = axis === 'x' ? 'y' : 'x';
  const crossings: number[] = [];
  if (Number.isFinite(minimum)) crossings.push(minimum);
  if (Number.isFinite(maximum)) crossings.push(maximum);
  for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length];
    if (!b) continue;
    if (Math.abs(a[fixed] - b[fixed]) <= EPS) {
      if (Math.abs(a[fixed] - station) <= EPS) crossings.push(a[axis], b[axis]);
    } else {
      const t = (station - a[fixed]) / (b[fixed] - a[fixed]);
      if (t >= -EPS && t <= 1 + EPS)
        crossings.push(
          a[axis] + Math.max(0, Math.min(1, t)) * (b[axis] - a[axis]),
        );
    }
  }
  const sorted = crossings
    .filter((value) => value >= minimum - EPS && value <= maximum + EPS)
    .sort((a, b) => a - b)
    .filter(
      (value, i, values) => i === 0 || value - (values[i - 1] ?? value) > EPS,
    );
  const result: [number, number][] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = Math.max(minimum, sorted[i - 1] ?? minimum);
    const b = Math.min(maximum, sorted[i] ?? maximum);
    if (b - a <= EPS) continue;
    const midpoint =
      axis === 'x'
        ? { x: (a + b) / 2, y: station }
        : { x: station, y: (a + b) / 2 };
    const edge = onBoundary(midpoint, polygon);
    if (edge ? !boundary : !pointInPolygon(midpoint, polygon)) continue;
    const previous = result.at(-1);
    if (previous && Math.abs(previous[1] - a) <= EPS) previous[1] = b;
    else result.push([a, b]);
  }
  return result;
}

function signedArea(points: readonly Point[]) {
  const origin = points[0];
  if (!origin) return 0;
  return (
    points.reduce((sum, a, i) => {
      const b = points[(i + 1) % points.length];
      return b
        ? sum +
            (a.x - origin.x) * (b.y - origin.y) -
            (b.x - origin.x) * (a.y - origin.y)
        : sum;
    }, 0) / 2
  );
}

/** Boundary segments of polygon ∩ rectangle, stitched into separate components.
 * Unlike clipping a concave polygon to one vertex list, this cannot bridge a
 * notch with a material face when a tile has two disconnected fragments. */
export function clipPolygonToRectangle(
  boundary: readonly Point[],
  rectangle: { x: number; y: number; width: number; height: number },
): Point[][] {
  const polygon = signedArea(boundary) < 0 ? [...boundary].reverse() : boundary;
  const { x, y, width, height } = rectangle;
  const right = x + width,
    top = y + height;
  const segments: [Point, Point][] = [];
  const point = (a: Point, b: Point, t: number): Point => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  for (const [i, a] of polygon.entries()) {
    const b = polygon[(i + 1) % polygon.length];
    if (!b) continue;
    let low = 0,
      high = 1;
    for (const [axis, min, max] of [
      ['x', x, right],
      ['y', y, top],
    ] as const) {
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) <= EPS) {
        if (a[axis] < min - EPS || a[axis] > max + EPS) high = -1;
      } else {
        const t1 = (min - a[axis]) / delta,
          t2 = (max - a[axis]) / delta;
        low = Math.max(low, Math.min(t1, t2));
        high = Math.min(high, Math.max(t1, t2));
      }
    }
    if (high - low <= EPS) continue;
    const middle = point(a, b, (low + high) / 2);
    // Rectangle edges below own coincident boundary segments exactly once.
    if (
      [middle.x - x, middle.x - right, middle.y - y, middle.y - top].some(
        (value) => Math.abs(value) <= EPS,
      )
    )
      continue;
    segments.push([point(a, b, low), point(a, b, high)]);
  }
  for (const [axis, station, min, max, reverse] of [
    ['x', y, x, right, false],
    ['y', right, y, top, false],
    ['x', top, x, right, true],
    ['y', x, y, top, true],
  ] as const) {
    for (const [a, b] of spans(polygon, axis, station, true, min, max)) {
      const start = axis === 'x' ? { x: a, y: station } : { x: station, y: a };
      const end = axis === 'x' ? { x: b, y: station } : { x: station, y: b };
      const oriented: [Point, Point] = reverse ? [end, start] : [start, end];
      const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
      const opposingBoundary = polygon.some((p, i) => {
        const q = polygon[(i + 1) % polygon.length];
        return (
          q !== undefined &&
          onEdge(midpoint, p, q) &&
          (q.x - p.x) * (oriented[1].x - oriented[0].x) +
            (q.y - p.y) * (oriented[1].y - oriented[0].y) <
            0
        );
      });
      // A tile merely touching the outside of a concave notch has no area.
      if (!opposingBoundary) segments.push(oriented);
    }
  }
  const nodes: Point[] = [];
  const node = (point: Point) => {
    const index = nodes.findIndex(
      (p) => Math.hypot(p.x - point.x, p.y - point.y) <= EPS,
    );
    if (index >= 0) return index;
    nodes.push(point);
    return nodes.length - 1;
  };
  const edges = segments
    .map(([a, b]) => ({ a: node(a), b: node(b), used: false }))
    .filter((edge) => edge.a !== edge.b);
  const loops: Point[][] = [];
  for (const first of edges) {
    if (first.used) continue;
    let edge = first;
    const loop: Point[] = [];
    while (!edge.used) {
      edge.used = true;
      const a = nodes[edge.a],
        b = nodes[edge.b];
      if (!a || !b) break;
      loop.push(a);
      if (edge.b === first.a) break;
      const candidates = edges.filter(
        (next) => !next.used && next.a === edge.b,
      );
      const incoming = Math.atan2(b.y - a.y, b.x - a.x);
      const turn = (next: (typeof edges)[number]) => {
        const end = nodes[next.b];
        if (!end) return -Infinity;
        const angle = Math.atan2(end.y - b.y, end.x - b.x) - incoming;
        return Math.atan2(Math.sin(angle), Math.cos(angle));
      };
      const next = candidates.sort((a, b) => turn(b) - turn(a))[0];
      requireValue(next, 'Ceiling tile boundary could not be closed');
      edge = next;
    }
    if (loop.length >= 3 && polygonArea(loop) > EPS * EPS) loops.push(loop);
  }
  return loops;
}

/** Nominal centerline layout. Connector tabs, hangers and offcut reuse are not
 * inferred. Tile quantities are net installed area, not a purchase-piece count. */
export function generateCeilingGrid(
  input: CeilingGridInput,
): CeilingGridResult {
  const result: CeilingGridResult = {
    pieces: [],
    surfaces: [],
    diagnostics: [],
    complete: true,
  };
  const source = { ceilingId: input.id, geometryId: input.geometryId };
  let budget = input.maxElements ?? 50000;
  const reserve = () => {
    if (budget-- <= 0) throw new Error('generation-budget');
  };
  try {
    validateCeilingGrid(input);
    requireValue(
      Number.isFinite(input.elevation),
      'Ceiling elevation must be finite',
    );
    requireValue(
      Number.isInteger(budget) && budget >= 0,
      'Ceiling generation budget must be nonnegative',
    );
    if (input.boundary.length > budget) throw new Error('generation-budget');
    validateGeometry({
      id: input.geometryId,
      sheetId: '',
      name: '',
      kind: 'area',
      points: [...input.boundary],
    });
    requireValue(input.tile.materialId.trim(), 'Ceiling tiles need a material');
    for (const name of ['thickness', 'packageSize'] as const) {
      const value = input.tile[name];
      if (value !== undefined)
        requireValue(
          Number.isFinite(value) && value > 0,
          `Tile ${name} must be positive`,
        );
    }
    if (input.tile.wastePercent !== undefined)
      requireValue(
        Number.isFinite(input.tile.wastePercent) &&
          input.tile.wastePercent >= 0,
        'Tile waste must be nonnegative',
      );
    const cos = Math.cos(input.rotation),
      sin = Math.sin(input.rotation);
    let polygon = input.boundary.map((point) => ({
      x: (point.x - input.origin.x) * cos + (point.y - input.origin.y) * sin,
      y: -(point.x - input.origin.x) * sin + (point.y - input.origin.y) * cos,
    }));
    if (signedArea(polygon) < 0) polygon = polygon.reverse();
    const world = (point: Point, centreOffset: number) => ({
      x: input.origin.x + point.x * cos - point.y * sin,
      y: input.origin.y + point.x * sin + point.y * cos,
      z: input.elevation + centreOffset,
    });
    const minX = Math.min(...polygon.map((p) => p.x)),
      maxX = Math.max(...polygon.map((p) => p.x));
    const minY = Math.min(...polygon.map((p) => p.y)),
      maxY = Math.max(...polygon.map((p) => p.y));
    const tileHeight = input.system === '2x2' ? MODULE : MAIN_SPACING;
    const firstX = Math.floor((minX + EPS) / MODULE),
      lastX = Math.ceil((maxX - EPS) / MODULE);
    const firstY = Math.floor((minY + EPS) / tileHeight),
      lastY = Math.ceil((maxY - EPS) / tileHeight);
    // A very large/oblique boundary must not scan millions of empty grid cells.
    if ((lastX - firstX) * (lastY - firstY) > Math.max(1000, budget * 16))
      throw new Error('generation-budget');
    const emit = (
      id: string,
      role: string,
      spec: MemberSpec,
      a: Point,
      b: Point,
      stockLength: number,
    ) => {
      const start = world(a, spec.depth / 2),
        end = world(b, spec.depth / 2);
      const cutLength = Math.hypot(end.x - start.x, end.y - start.y);
      if (cutLength <= EPS) return;
      reserve();
      result.pieces.push({
        ...source,
        id: `${input.id}/${id}`,
        materialId: spec.materialId,
        role,
        start,
        end,
        cutLength,
        stockLength,
        ...(spec.wastePercent === undefined
          ? {}
          : { wastePercent: spec.wastePercent }),
        ...(spec.packageSize === undefined
          ? {}
          : { packageSize: spec.packageSize }),
        width: spec.width,
        depth: spec.depth,
        sectionRotation: 0,
        widthAxis: {
          x: -(end.y - start.y) / cutLength,
          y: (end.x - start.x) / cutLength,
          z: 0,
        },
      });
    };
    const segment = (
      id: string,
      role: string,
      spec: MemberSpec,
      a: Point,
      b: Point,
      stock: number,
    ) => {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const count = Math.max(1, Math.ceil((length - EPS) / stock));
      if (count > budget) throw new Error('generation-budget');
      for (let i = 0; i < count; i++) {
        const at = (distance: number) => ({
          x: a.x + ((b.x - a.x) * distance) / length,
          y: a.y + ((b.y - a.y) * distance) / length,
        });
        emit(
          `${id}/${String(i)}`,
          role,
          spec,
          at(i * stock),
          at(Math.min(length, (i + 1) * stock)),
          stock,
        );
      }
    };
    for (
      let row = Math.ceil((minY - EPS) / MAIN_SPACING);
      row <= Math.floor((maxY + EPS) / MAIN_SPACING);
      row++
    ) {
      const y = row * MAIN_SPACING;
      for (const [index, [a, b]] of spans(polygon, 'x', y).entries())
        segment(
          `main/${String(row)}/${String(index)}`,
          'ceiling-main',
          input.main,
          { x: a, y },
          { x: b, y },
          input.main.stockLength,
        );
    }
    for (
      let row = Math.ceil((minX - EPS) / MODULE);
      row <= Math.floor((maxX + EPS) / MODULE);
      row++
    ) {
      const x = row * MODULE;
      for (const [index, [a, b]] of spans(polygon, 'y', x).entries()) {
        for (
          let bay = Math.floor((a + EPS) / MAIN_SPACING);
          bay < Math.ceil((b - EPS) / MAIN_SPACING);
          bay++
        )
          emit(
            `tee4/${String(row)}/${String(index)}/${String(bay)}`,
            'ceiling-tee-4ft',
            input.crossTee4,
            { x, y: Math.max(a, bay * MAIN_SPACING) },
            { x, y: Math.min(b, (bay + 1) * MAIN_SPACING) },
            MAIN_SPACING,
          );
      }
    }
    if (input.system === '2x2' && input.crossTee2) {
      for (
        let row = Math.ceil((minY - MODULE - EPS) / MAIN_SPACING);
        row <= Math.floor((maxY - MODULE + EPS) / MAIN_SPACING);
        row++
      ) {
        const y = row * MAIN_SPACING + MODULE;
        for (const [index, [a, b]] of spans(polygon, 'x', y).entries()) {
          for (
            let bay = Math.floor((a + EPS) / MODULE);
            bay < Math.ceil((b - EPS) / MODULE);
            bay++
          )
            emit(
              `tee2/${String(row)}/${String(index)}/${String(bay)}`,
              'ceiling-tee-2ft',
              input.crossTee2,
              { x: Math.max(a, bay * MODULE), y },
              { x: Math.min(b, (bay + 1) * MODULE), y },
              MODULE,
            );
        }
      }
    }
    for (const [i, a] of polygon.entries()) {
      const b = polygon[(i + 1) % polygon.length];
      if (b)
        segment(
          `angle/${String(i)}`,
          'ceiling-wall-angle',
          input.wallAngle,
          a,
          b,
          input.wallAngle.stockLength,
        );
    }
    for (let x = firstX; x < lastX; x++) {
      for (let y = firstY; y < lastY; y++) {
        const patches = clipPolygonToRectangle(polygon, {
          x: x * MODULE,
          y: y * tileHeight,
          width: MODULE,
          height: tileHeight,
        });
        for (const [index, points] of patches.entries()) {
          reserve();
          const area = polygonArea(points);
          result.surfaces.push({
            ...source,
            id: `${input.id}/tile/${String(x)}/${String(y)}/${String(index)}`,
            materialId: input.tile.materialId,
            face: 'ceiling',
            layers: 1,
            points: points.map((point) =>
              world(point, (input.tile.thickness ?? 0) / 2),
            ),
            geometricArea: area,
            area,
            ...(input.tile.thickness === undefined
              ? {}
              : { thickness: input.tile.thickness }),
            ...(input.tile.wastePercent === undefined
              ? {}
              : { wastePercent: input.tile.wastePercent }),
            ...(input.tile.packageSize === undefined
              ? {}
              : { packageSize: input.tile.packageSize }),
          });
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.complete = false;
    result.diagnostics.push({
      ...source,
      code:
        message === 'generation-budget'
          ? 'generation-budget'
          : 'invalid-ceiling-grid',
      message:
        message === 'generation-budget'
          ? 'Ceiling grid generation stopped at the finite piece/surface budget'
          : message,
    });
  }
  return result;
}
