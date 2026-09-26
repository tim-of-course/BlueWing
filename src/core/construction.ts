import type { Geometry, Point, Project } from './types';
import { polygonArea } from './geometry';
import type {
  ConstructionData,
  ConstructionOptions,
  ConstructionResult,
  ConstructionSource,
  MemberSpec,
  MemberOffset,
  Opening,
  SheetPlacement,
  Vec3,
  Wall,
} from './construction-types';
export type * from './construction-types';
const EPS = 1e-8;
// Do not buy an extra piece for multiplication noise such as 100 * 1.1.
const wholeQuantity = (value: number) =>
  Math.ceil(value - Number.EPSILON * Math.max(1, Math.abs(value)) * 4);
export const CONSTRUCTION_GENERATION_BUDGET = 50000;
export function emptyConstruction(): ConstructionData {
  return {
    walls: {},
    openings: {},
    headers: {},
    levels: {},
    placements: {},
    ceilings: {},
  };
}
function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`Construction: ${message}`);
}
function numeric(value: number, label: string, minimum = -Infinity) {
  requireValue(
    Number.isFinite(value) && value >= minimum,
    `${label} must be finite and >= ${String(minimum)}`,
  );
}
function positive(value: number, label: string) {
  numeric(value, label, 0);
  requireValue(value > 0, `${label} must be positive`);
}
function integer(value: number, label: string, minimum = 0) {
  numeric(value, label, minimum);
  requireValue(Number.isSafeInteger(value), `${label} must be a whole number`);
}
function member(spec: MemberSpec) {
  requireValue(
    typeof spec.materialId === 'string' && spec.materialId.trim(),
    'member materialId is required',
  );
  positive(spec.width, 'member width');
  positive(spec.depth, 'member depth');
  if (spec.stockLength !== undefined)
    positive(spec.stockLength, 'stock length');
  if (spec.wastePercent !== undefined) numeric(spec.wastePercent, 'waste', 0);
  if (spec.packageSize !== undefined)
    integer(spec.packageSize, 'package size', 1);
}
function uniqueIds(
  values: {
    id: string;
  }[],
  label: string,
) {
  requireValue(
    values.every((v) => typeof v.id === 'string' && v.id.length > 0),
    `${label} IDs are required`,
  );
  requireValue(
    new Set(values.map((v) => v.id)).size === values.length,
    `${label} IDs must be unique`,
  );
}
function validateOffsets(offsets: MemberOffset[] | undefined, count: number) {
  if (!offsets) return;
  requireValue(offsets.length === count, 'member offsets must match count');
  for (const offset of offsets) {
    numeric(offset.along, 'member along offset');
    numeric(offset.face, 'member face offset');
    numeric(offset.rotation ?? 0, 'member rotation');
  }
  requireValue(
    new Set(offsets.map((o) => `${String(o.along)}/${String(o.face)}`)).size ===
      offsets.length,
    'member offsets cannot coincide',
  );
}
/** Throws on invalid authored data. Missing height/calibration is resolved by generation diagnostics. */
export function validateConstruction(
  project: Project,
  data: ConstructionData,
): void {
  const collections: unknown[] = [
    data.walls,
    data.openings,
    data.headers,
    data.levels,
    data.placements,
    data.ceilings,
  ];
  for (const collection of collections) {
    requireValue(
      collection &&
        typeof collection === 'object' &&
        !Array.isArray(collection),
      'expected record collection',
    );
    for (const [id, item] of Object.entries(
      collection as Record<string, unknown>,
    ))
      requireValue(
        item &&
          typeof item === 'object' &&
          'id' in item &&
          id === item.id &&
          id.length,
        'record key must match id',
      );
  }
  const geometryFor = (id: string, kind: string) => {
    const g = project.geometries[id];
    requireValue(g?.kind === kind, `${id} must reference ${kind} geometry`);
    requireValue(project.sheets[g.sheetId], `${id} sheet is missing`);
    return g;
  };
  const level = (id?: string) => {
    if (id !== undefined)
      requireValue(data.levels[id], `level ${id} is missing`);
  };
  for (const l of Object.values(data.levels))
    numeric(l.elevation, 'level elevation');
  const placed = new Set<string>();
  for (const p of Object.values(data.placements)) {
    requireValue(project.sheets[p.sheetId], 'placement sheet is missing');
    requireValue(!placed.has(p.sheetId), 'only one placement per sheet');
    placed.add(p.sheetId);
    numeric(p.pageOrigin.x, 'page origin x');
    numeric(p.pageOrigin.y, 'page origin y');
    numeric(p.worldOffset.x, 'world x');
    numeric(p.worldOffset.y, 'world y');
    numeric(p.worldOffset.z, 'world z');
    numeric(p.rotation, 'rotation');
  }
  const wallGeometries = new Set<string>();
  for (const w of Object.values(data.walls)) {
    requireValue(
      !wallGeometries.has(w.geometryId),
      'only one wall per geometry',
    );
    wallGeometries.add(w.geometryId);
    geometryFor(w.geometryId, 'path');
    level(w.levelId);
    numeric(w.baseElevation, 'base elevation');
    if (w.height !== undefined) positive(w.height, 'wall height');
    positive(w.studSpacing, 'stud spacing');
    numeric(w.studOffset ?? 0, 'stud offset', 0);
    numeric(w.bottomAllowance ?? 0, 'bottom allowance', 0);
    numeric(w.topAllowance ?? 0, 'top allowance', 0);
    member(w.stud);
    member(w.track);
    if (w.topProfile) {
      requireValue(
        ['linear', 'step'].includes(w.topProfile.mode),
        'invalid height profile mode',
      );
      requireValue(
        w.topProfile.points.length >= 2,
        'height profile needs two points',
      );
      let previous = -1;
      for (const p of w.topProfile.points) {
        numeric(p.distance, 'profile distance', 0);
        positive(p.height, 'profile height');
        requireValue(p.distance > previous, 'profile distances must increase');
        previous = p.distance;
      }
      requireValue(
        present(w.topProfile.points[0]).distance === 0,
        'profile must start at zero',
      );
    }
    uniqueIds(w.conditions ?? [], 'condition');
    uniqueIds(w.finishes ?? [], 'finish');
    uniqueIds(w.backing ?? [], 'backing');
    const stations = new Set<number>();
    for (const c of w.conditions ?? []) {
      numeric(c.distance, 'condition distance', 0);
      integer(c.count, 'condition count');
      validateOffsets(c.memberOffsets, c.count);
      requireValue(
        ['end', 'corner', 'junction'].includes(c.kind),
        'invalid condition kind',
      );
      requireValue(
        !stations.has(c.distance),
        'conditions cannot duplicate stations',
      );
      stations.add(c.distance);
      if (c.ownerWallId) {
        const owner = data.walls[c.ownerWallId];
        requireValue(owner, 'shared member owner is missing');
        if (owner.id !== w.id)
          requireValue(
            owner.conditions?.some(
              (other) =>
                other.id === c.id &&
                (!other.ownerWallId || other.ownerWallId === owner.id) &&
                other.count === c.count,
            ),
            'shared condition must identify a matching condition on its owner',
          );
      }
    }
    for (const f of w.finishes ?? []) {
      requireValue(
        typeof f.materialId === 'string' && f.materialId.trim(),
        'finish material is required',
      );
      requireValue(['front', 'back'].includes(f.face), 'invalid finish face');
      integer(f.layers, 'finish layers', 1);
      numeric(f.offset ?? 0, 'finish offset');
      if (f.height !== undefined) positive(f.height, 'finish height');
      if (f.thickness !== undefined) positive(f.thickness, 'finish thickness');
      numeric(f.deduction ?? 0, 'finish deduction', 0);
      numeric(f.wastePercent ?? 0, 'finish waste', 0);
      if (f.packageSize !== undefined)
        positive(f.packageSize, 'finish package area');
    }
    for (const b of w.backing ?? []) {
      numeric(b.height, 'backing height', 0);
      member(b.member);
    }
  }
  for (const h of Object.values(data.headers)) {
    requireValue(h.components.length > 0, 'header requires components');
    uniqueIds(h.components, 'header component');
    for (const c of h.components) {
      member(c.member);
      requireValue(
        typeof c.role === 'string' && c.role.trim(),
        'header component role is required',
      );
      numeric(c.startExtension, 'start extension', 0);
      numeric(c.endExtension, 'end extension', 0);
      numeric(c.verticalOffset, 'vertical offset');
      numeric(c.faceOffset, 'face offset');
      numeric(c.sectionRotation ?? 0, 'section rotation');
    }
  }
  const openings = Object.values(data.openings);
  for (const o of openings) {
    const w = data.walls[o.wallId];
    requireValue(w, 'opening wall is missing');
    numeric(o.distance, 'opening distance', 0);
    positive(o.width, 'opening width');
    numeric(o.sill, 'opening sill', 0);
    positive(o.height, 'opening height');
    integer(o.jambCount, 'jamb count');
    if (o.jamb) member(o.jamb);
    if (o.sillMember) member(o.sillMember);
    validateOffsets(o.jambOffsets, o.jambCount);
    if (o.headerId)
      requireValue(data.headers[o.headerId], 'header detail is missing');
    for (const other of openings)
      if (other.id < o.id && other.wallId === o.wallId) {
        requireValue(
          !(
            o.distance < other.distance + other.width - EPS &&
            other.distance < o.distance + o.width - EPS &&
            o.sill < other.sill + other.height - EPS &&
            other.sill < o.sill + o.height - EPS
          ),
          'openings overlap',
        );
      }
  }
  for (const c of Object.values(data.ceilings)) {
    if (c.quantityMode !== undefined)
      requireValue(
        ['reference', 'included'].includes(c.quantityMode),
        'invalid ceiling quantity mode',
      );
    geometryFor(c.geometryId, 'area');
    level(c.levelId);
    numeric(c.elevation, 'ceiling elevation');
    requireValue(
      typeof c.materialId === 'string' && c.materialId.trim(),
      'ceiling material is required',
    );
    integer(c.layers, 'ceiling layers', 1);
  }
}
function heightAt(wall: Wall, distance: number, fromLeft = false): number {
  const profile = wall.topProfile;
  if (!profile) return present(wall.height);
  const points = profile.points;
  for (let i = 1; i < points.length; i++) {
    const a = present(points[i - 1]);
    const b = present(points[i]);
    if (
      distance < b.distance - EPS ||
      (fromLeft && distance <= b.distance + EPS) ||
      i === points.length - 1
    ) {
      if (profile.mode === 'step') {
        if (!fromLeft && distance >= b.distance - EPS) return b.height;
        return a.height;
      }
      return (
        a.height +
        ((b.height - a.height) * (distance - a.distance)) /
          (b.distance - a.distance)
      );
    }
  }
  return present(points[points.length - 1]).height;
}
function sorted(values: number[]) {
  return [...new Set(values)]
    .sort((a, b) => a - b)
    .filter((v, i, all) => i === 0 || v - present(all[i - 1]) > EPS);
}
function subtract(
  low: number,
  high: number,
  cuts: [number, number][],
): [number, number][] {
  let spans: [number, number][] = [[low, high]];
  for (const [a, b] of cuts)
    spans = spans.flatMap(([x, y]) => {
      if (b <= x + EPS || a >= y - EPS) return [[x, y]];
      const next: [number, number][] = [];
      if (a > x + EPS) next.push([x, Math.min(a, y)]);
      if (b < y - EPS) next.push([Math.max(b, x), y]);
      return next;
    });
  return spans.filter(([a, b]) => b - a > EPS);
}
function world(point: Point, scale: number, placement?: SheetPlacement): Vec3 {
  const x = (point.x - (placement?.pageOrigin.x ?? 0)) * scale;
  const y = -(point.y - (placement?.pageOrigin.y ?? 0)) * scale;
  const angle = placement?.rotation ?? 0;
  return {
    x:
      x * Math.cos(angle) -
      y * Math.sin(angle) +
      (placement?.worldOffset.x ?? 0),
    y:
      x * Math.sin(angle) +
      y * Math.cos(angle) +
      (placement?.worldOffset.y ?? 0),
    z: placement?.worldOffset.z ?? 0,
  };
}
function path(geometry: Geometry, scale: number, placement?: SheetPlacement) {
  const points = geometry.points.map((p) => world(p, scale, placement));
  const stations = [0];
  for (let i = 1; i < points.length; i++)
    stations.push(
      present(stations[i - 1]) +
        Math.hypot(
          present(points[i]).x - present(points[i - 1]).x,
          present(points[i]).y - present(points[i - 1]).y,
        ),
    );
  const length = present(stations[stations.length - 1]);
  const at = (
    distance: number,
    z: number,
    offset = 0,
    directionStation = distance,
  ): Vec3 => {
    let index = stations.findIndex((s, i) => i > 0 && s >= distance - EPS);
    if (index < 1) index = points.length - 1;
    const a = present(points[index - 1]);
    const b = present(points[index]);
    const segment = present(stations[index]) - present(stations[index - 1]);
    const t = (distance - present(stations[index - 1])) / segment;
    let directionIndex = stations.findIndex(
      (s, i) => i > 0 && s >= directionStation - EPS,
    );
    if (directionIndex < 1) directionIndex = points.length - 1;
    const da = present(points[directionIndex - 1]);
    const db = present(points[directionIndex]);
    const dl =
      present(stations[directionIndex]) - present(stations[directionIndex - 1]);
    return {
      x: a.x + (b.x - a.x) * t - ((db.y - da.y) / dl) * offset,
      y: a.y + (b.y - a.y) * t + ((db.x - da.x) / dl) * offset,
      z: a.z + z,
    };
  };
  return { stations, length, at };
}
/** Derived only: authored records never receive generated pieces or surfaces. */
export function generateConstruction(
  project: Project,
  data: ConstructionData,
  options: ConstructionOptions = {},
): ConstructionResult {
  const result: ConstructionResult = {
    pieces: [],
    surfaces: [],
    purchases: [],
    surfacePurchases: [],
    diagnostics: [],
    complete: true,
  };
  const diagnostic = (
    source: ConstructionSource,
    code: string,
    message: string,
  ) => {
    result.diagnostics.push({ ...source, code, message });
    result.complete = false;
  };
  validateConstruction(project, data);
  const placements = Object.values(data.placements);
  const ordered = <
    T extends {
      id: string;
    },
  >(
    records: Record<string, T>,
  ) => Object.values(records).sort((a, b) => a.id.localeCompare(b.id));
  integer(
    options.maxPieces ?? CONSTRUCTION_GENERATION_BUDGET,
    'generation budget',
    1,
  );
  let budget = options.maxPieces ?? CONSTRUCTION_GENERATION_BUDGET;
  let budgetSource: ConstructionSource = {};
  const purchase = new Map<
    string,
    {
      spec: MemberSpec;
      length: number;
      count: number;
      pieceIds: string[];
    }
  >();
  const emit = (
    source: ConstructionSource,
    id: string,
    role: string,
    spec: MemberSpec,
    start: Vec3,
    end: Vec3,
    sectionAxis: Vec3,
    sectionRotation = 0,
  ) => {
    const cutLength = Math.hypot(
      end.x - start.x,
      end.y - start.y,
      end.z - start.z,
    );
    if (cutLength <= EPS) return;
    if (--budget < 0) throw new Error('generation-budget');
    result.pieces.push({
      ...source,
      id,
      role,
      materialId: spec.materialId,
      start,
      end,
      cutLength,
      ...(spec.stockLength !== undefined
        ? { stockLength: spec.stockLength }
        : {}),
      width: spec.width,
      depth: spec.depth,
      widthAxis: {
        x:
          sectionAxis.x * Math.cos(sectionRotation) +
          (((end.y - start.y) * sectionAxis.z -
            (end.z - start.z) * sectionAxis.y) /
            cutLength) *
            Math.sin(sectionRotation),
        y:
          sectionAxis.y * Math.cos(sectionRotation) +
          (((end.z - start.z) * sectionAxis.x -
            (end.x - start.x) * sectionAxis.z) /
            cutLength) *
            Math.sin(sectionRotation),
        z:
          sectionAxis.z * Math.cos(sectionRotation) +
          (((end.x - start.x) * sectionAxis.y -
            (end.y - start.y) * sectionAxis.x) /
            cutLength) *
            Math.sin(sectionRotation),
      },
      sectionRotation,
    });
    if (spec.stockLength !== undefined && cutLength > spec.stockLength + EPS)
      diagnostic(
        source,
        'stock-shortfall',
        `${id}: cut ${String(cutLength)} m exceeds stock ${String(spec.stockLength)} m`,
      );
    const length = spec.stockLength ?? cutLength;
    const key = JSON.stringify([
      spec.materialId,
      length,
      spec.wastePercent ?? 0,
      spec.packageSize ?? 1,
    ]);
    const entry = purchase.get(key);
    if (entry) {
      entry.count++;
      entry.pieceIds.push(id);
    } else purchase.set(key, { spec, length, count: 1, pieceIds: [id] });
  };
  try {
    for (const wall of ordered(data.walls)) {
      const source = { wallId: wall.id, geometryId: wall.geometryId };
      budgetSource = source;
      const geometry = present(project.geometries[wall.geometryId]);
      if (
        geometry.points.length + (wall.topProfile?.points.length ?? 0) >
        budget
      ) {
        diagnostic(
          source,
          'generation-budget',
          'Wall path/profile exceeds finite generation budget',
        );
        continue;
      }
      const scale =
        project.sheets[geometry.sheetId]?.calibration?.metresPerUnit;
      if (!scale) {
        diagnostic(
          source,
          'missing-calibration',
          'Wall sheet needs calibration',
        );
        continue;
      }
      if (wall.height === undefined && !wall.topProfile) {
        diagnostic(source, 'missing-height', 'Wall height is unresolved');
        continue;
      }
      const line = path(
        geometry,
        scale,
        placements.find((p) => p.sheetId === geometry.sheetId),
      );
      if (
        line.length <= EPS ||
        line.stations.some(
          (s, i) => i > 0 && s - present(line.stations[i - 1]) <= EPS,
        )
      ) {
        diagnostic(
          source,
          'invalid-path',
          'Wall path must have nonzero segments',
        );
        continue;
      }
      const openings = ordered(data.openings).filter(
        (o) => o.wallId === wall.id,
      );
      if (
        (wall.topProfile &&
          Math.abs(
            present(wall.topProfile.points.at(-1)).distance - line.length,
          ) > EPS) ||
        wall.conditions?.some((c) => c.distance > line.length + EPS) ||
        openings.some((o) => o.distance + o.width > line.length + EPS)
      ) {
        diagnostic(
          source,
          'wall-stations-outside-profile',
          'Wall length changed or authored stations exceed the wall; revise profile, openings and conditions',
        );
        continue;
      }
      const estimated =
        line.length / wall.studSpacing +
        openings.reduce((n, o) => n + 2 * o.jambCount, 0) +
        (wall.conditions ?? []).reduce((n, c) => n + c.count, 0);
      if (estimated > budget) {
        diagnostic(
          source,
          'generation-budget',
          'Wall exceeds finite piece generation budget',
        );
        continue;
      }
      const base =
        wall.baseElevation +
        (wall.levelId ? present(data.levels[wall.levelId]).elevation : 0);
      const at = (s: number, h: number, offset = 0, directionStation = s) =>
        line.at(s, base + h, offset, directionStation);
      for (const condition of wall.conditions ?? []) {
        if (!condition.ownerWallId || condition.ownerWallId === wall.id)
          continue;
        const owner = present(data.walls[condition.ownerWallId]);
        const ownerCondition = present(
          owner.conditions?.find((c) => c.id === condition.id),
        );
        const ownerGeometry = present(project.geometries[owner.geometryId]);
        const ownerScale =
          project.sheets[ownerGeometry.sheetId]?.calibration?.metresPerUnit;
        if (!ownerScale || (owner.height === undefined && !owner.topProfile)) {
          diagnostic(
            source,
            'unresolved-shared-member',
            `Shared condition ${condition.id} has an unresolved owner`,
          );
          continue;
        }
        const ownerLine = path(
          ownerGeometry,
          ownerScale,
          placements.find((p) => p.sheetId === ownerGeometry.sheetId),
        );
        const ownerBase =
          owner.baseElevation +
          (owner.levelId ? present(data.levels[owner.levelId]).elevation : 0);
        const ownerPoint = ownerLine.at(ownerCondition.distance, ownerBase);
        const point = at(condition.distance, 0);
        if (
          Math.hypot(
            point.x - ownerPoint.x,
            point.y - ownerPoint.y,
            point.z - ownerPoint.z,
          ) > EPS ||
          Math.abs(
            heightAt(wall, condition.distance) -
              heightAt(owner, ownerCondition.distance),
          ) > EPS ||
          wall.stud.materialId !== owner.stud.materialId ||
          Math.abs(wall.stud.width - owner.stud.width) > EPS ||
          Math.abs(wall.stud.depth - owner.stud.depth) > EPS ||
          Math.abs((wall.bottomAllowance ?? 0) - (owner.bottomAllowance ?? 0)) >
            EPS ||
          Math.abs((wall.topAllowance ?? 0) - (owner.topAllowance ?? 0)) > EPS
        )
          diagnostic(
            source,
            'shared-member-mismatch',
            `Shared condition ${condition.id} must align with its owner in position, height, section, material and allowances`,
          );
      }
      const breaks = sorted([
        ...line.stations,
        ...(wall.topProfile?.points.map((p) => p.distance) ?? []),
      ]);
      const piece = (
        id: string,
        role: string,
        spec: MemberSpec,
        a: number,
        za: number,
        b: number,
        zb: number,
        opening?: Opening,
        offset = 0,
        rotation = 0,
      ) => {
        const midpoint = (a + b) / 2;
        const origin = at(midpoint, 0);
        const normal = at(midpoint, 0, 1);
        const vertical = Math.abs(a - b) < EPS;
        const sectionAxis = {
          x: vertical ? normal.y - origin.y : normal.x - origin.x,
          y: vertical ? origin.x - normal.x : normal.y - origin.y,
          z: 0,
        };
        const start = at(a, za, offset, midpoint);
        const end = at(b, zb, offset, midpoint);
        const length = Math.hypot(
          end.x - start.x,
          end.y - start.y,
          end.z - start.z,
        );
        const splitTrack =
          !opening &&
          ['bottom-track', 'top-track', 'step-track'].includes(role) &&
          spec.stockLength !== undefined;
        const stock = splitTrack ? present(spec.stockLength) : length;
        const count =
          stock > EPS ? Math.max(1, Math.ceil((length - EPS) / stock)) : 1;
        if (count > budget) {
          diagnostic(
            source,
            'generation-budget',
            'Track stock segmentation exceeds finite generation budget',
          );
          return;
        }
        for (let index = 0; index < count; index++) {
          const t0 = length > EPS ? (index * stock) / length : 0;
          const t1 =
            length > EPS ? Math.min(1, ((index + 1) * stock) / length) : 1;
          const interpolate = (t: number): Vec3 => ({
            x: start.x + (end.x - start.x) * t,
            y: start.y + (end.y - start.y) * t,
            z: start.z + (end.z - start.z) * t,
          });
          emit(
            { ...source, ...(opening ? { openingId: opening.id } : {}) },
            `${wall.id}/${id}${count > 1 ? `/stock/${String(index)}` : ''}`,
            role,
            spec,
            interpolate(t0),
            interpolate(t1),
            sectionAxis,
            rotation,
          );
        }
      };
      const horizontal = (
        id: string,
        role: string,
        spec: MemberSpec,
        a: number,
        b: number,
        h: number,
        opening?: Opening,
        offset = 0,
        rotation = 0,
      ) => {
        const splits = sorted([
          a,
          b,
          ...line.stations.filter((s) => s > a + EPS && s < b - EPS),
        ]);
        for (let i = 1; i < splits.length; i++)
          piece(
            `${id}/${String(i - 1)}`,
            role,
            spec,
            present(splits[i - 1]),
            h,
            present(splits[i]),
            h,
            opening,
            offset,
            rotation,
          );
      };
      // Channel envelopes include empty space between flanges. Only authored
      // vertical allowances reduce stud/jamb cuts, including on slopes. Sample
      // height at the member centre; no bevel or flange deduction is inferred.
      const bottom = wall.bottomAllowance ?? 0;
      const topAt = (station: number) =>
        Math.min(heightAt(wall, station, true), heightAt(wall, station)) -
        (wall.topAllowance ?? 0);
      const headerHalfHeight = (spec: MemberSpec, rotation = 0) =>
        (Math.abs(Math.sin(rotation)) * spec.width +
          Math.abs(Math.cos(rotation)) * spec.depth) /
        2;
      // Sill channel flange envelopes do not shorten lower cripples: the rough
      // sill is their top datum. Explicit headers are rectangular physical
      // approximations whose rotated depths bound adjacent cripple cuts.
      // This does not resolve connection design or general material collisions.
      const physicalCuts = (
        station: number,
        face: number,
        rotation: number,
      ): [number, number][] => {
        const cuts: [number, number][] = [];
        const studHalfFace =
          (Math.abs(Math.cos(rotation)) * wall.stud.depth +
            Math.abs(Math.sin(rotation)) * wall.stud.width) /
          2;
        const studHalfAlong =
          (Math.abs(Math.cos(rotation)) * wall.stud.width +
            Math.abs(Math.sin(rotation)) * wall.stud.depth) /
          2;
        for (const opening of openings) {
          const a = opening.distance;
          const b = a + opening.width;
          const head = opening.sill + opening.height;
          if (station >= a - EPS && station <= b + EPS) {
            cuts.push([opening.sill, head]);
          }
          for (const c of opening.headerId
            ? present(data.headers[opening.headerId]).components
            : []) {
            const angle = c.sectionRotation ?? 0;
            const halfFace =
              (Math.abs(Math.cos(angle)) * c.member.width +
                Math.abs(Math.sin(angle)) * c.member.depth) /
              2;
            if (
              station + studHalfAlong <= a - c.startExtension + EPS ||
              station - studHalfAlong >= b + c.endExtension - EPS ||
              Math.abs(face - c.faceOffset) >= studHalfFace + halfFace - EPS
            )
              continue;
            const halfHeight = headerHalfHeight(c.member, angle);
            cuts.push([
              head + c.verticalOffset - halfHeight,
              head + c.verticalOffset + halfHeight,
            ]);
          }
        }
        return cuts;
      };
      if (line.stations.length > 2 || wall.topProfile?.mode === 'step')
        diagnostic(
          source,
          'unresolved-track-joint',
          'Bent or stepped tracks need explicit joint and end-cut details; displayed centreline lengths do not resolve joint overlaps',
        );
      const stations = [
        0,
        line.length,
        ...line.stations,
        ...(wall.conditions ?? []).map((c) => c.distance),
      ];
      const offset = wall.studOffset ?? 0;
      for (let i = 0; offset + i * wall.studSpacing < line.length - EPS; i++)
        stations.push(offset + i * wall.studSpacing);
      for (const s of sorted(stations)) {
        const condition = wall.conditions?.find(
          (c) => Math.abs(c.distance - s) < EPS,
        );
        if (condition?.ownerWallId && condition.ownerWallId !== wall.id)
          continue;
        if (condition && condition.count > 1 && !condition.memberOffsets) {
          diagnostic(
            source,
            'missing-member-offsets',
            `Condition ${condition.id} needs positions for its multiple members`,
          );
          continue;
        }
        // Jambs replace regular studs on opening boundaries.
        if (
          openings.some(
            (o) =>
              o.jambCount > 0 &&
              (Math.abs(o.distance - s) < EPS ||
                Math.abs(o.distance + o.width - s) < EPS),
          )
        )
          continue;
        for (let n = 0; n < (condition?.count ?? 1); n++) {
          const memberOffset = condition?.memberOffsets?.[n];
          const station = s + (memberOffset?.along ?? 0);
          if (station < -EPS || station > line.length + EPS) {
            diagnostic(
              source,
              'member-outside-wall',
              `Condition ${String(condition?.id)} member is outside wall`,
            );
            continue;
          }
          const studTop = topAt(station);
          if (studTop <= bottom) {
            diagnostic(
              source,
              'invalid-cut',
              'End allowances consume stud height',
            );
            continue;
          }
          const cuts = physicalCuts(
            station,
            memberOffset?.face ?? 0,
            memberOffset?.rotation ?? 0,
          );
          const spans = subtract(bottom, studTop, cuts);
          for (let k = 0; k < spans.length; k++) {
            const span = present(spans[k]);
            piece(
              `stud/${String(s)}/${String(n)}/${String(k)}`,
              cuts.length ? 'cripple' : (condition?.kind ?? 'stud'),
              wall.stud,
              station,
              span[0],
              station,
              span[1],
              undefined,
              memberOffset?.face ?? 0,
              memberOffset?.rotation ?? 0,
            );
          }
        }
      }
      for (const [a, b] of subtract(
        0,
        line.length,
        openings
          .filter((o) => o.sill <= EPS)
          .map((o) => [o.distance, o.distance + o.width]),
      ))
        horizontal(
          `bottom-track/${String(a)}`,
          'bottom-track',
          wall.track,
          a,
          b,
          0,
        );
      for (let i = 1; i < breaks.length; i++) {
        const a = present(breaks[i - 1]);
        const b = present(breaks[i]);
        piece(
          `top-track/${String(i)}`,
          'top-track',
          wall.track,
          a,
          heightAt(wall, a),
          b,
          heightAt(wall, b, true),
        );
        const before = heightAt(wall, b, true);
        const after = heightAt(wall, b);
        if (Math.abs(after - before) > EPS)
          piece(
            `step-track/${String(i)}`,
            'step-track',
            wall.track,
            b,
            before,
            b,
            after,
          );
      }
      const jambStations = new Set<string>();
      for (const o of openings) {
        const a = o.distance;
        const b = a + o.width;
        const head = o.sill + o.height;
        if (line.stations.some((s) => s > a + EPS && s < b - EPS))
          diagnostic(
            { ...source, openingId: o.id },
            'opening-crosses-bend',
            'Opening crosses a path vertex and requires separate framing details',
          );
        const minTop = Math.min(
          heightAt(wall, a),
          heightAt(wall, b, true),
          ...breaks
            .filter((s) => s > a && s < b)
            .flatMap((s) => [heightAt(wall, s), heightAt(wall, s, true)]),
        );
        if (head > minTop + EPS)
          diagnostic(
            { ...source, openingId: o.id },
            'opening-above-top',
            'Opening is clipped by the wall top; review framing detail',
          );
        if (o.jambCount > 1 && !o.jambOffsets)
          diagnostic(
            { ...source, openingId: o.id },
            'missing-member-offsets',
            'Multiple jamb members require explicit positions',
          );
        else
          for (const [side, s] of [
            ['left', a],
            ['right', b],
          ] as const)
            for (let n = 0; n < o.jambCount; n++) {
              const offset = o.jambOffsets?.[n];
              const jamb = o.jamb ?? wall.stud;
              const rotation = offset?.rotation ?? 0;
              const halfAlong =
                (Math.abs(Math.cos(rotation)) * jamb.width +
                  Math.abs(Math.sin(rotation)) * jamb.depth) /
                2;
              // Positive offsets move into framing on both sides of the rough opening.
              const station =
                s +
                (side === 'left' ? -1 : 1) * (halfAlong + (offset?.along ?? 0));
              if ((offset?.along ?? 0) < -EPS)
                diagnostic(
                  { ...source, openingId: o.id },
                  'jamb-in-opening',
                  'Jamb offset consumes the specified rough opening width',
                );
              const key = `${String(station)}/${String(offset?.face ?? 0)}`;
              if (jambStations.has(key)) {
                diagnostic(
                  { ...source, openingId: o.id },
                  'shared-jamb-detail',
                  'Coincident opening jambs require a shared framing detail; duplicate member omitted',
                );
                continue;
              }
              jambStations.add(key);
              if (topAt(station) <= bottom) {
                diagnostic(
                  { ...source, openingId: o.id },
                  'invalid-cut',
                  'End allowances consume jamb height',
                );
                continue;
              }
              if (station < -EPS || station > line.length + EPS) {
                diagnostic(
                  { ...source, openingId: o.id },
                  'member-outside-wall',
                  'Jamb member is outside wall',
                );
                continue;
              }
              piece(
                `opening/${o.id}/jamb/${side}/${String(n)}`,
                'jamb',
                o.jamb ?? wall.stud,
                station,
                bottom,
                station,
                topAt(station),
                o,
                offset?.face ?? 0,
                offset?.rotation ?? 0,
              );
            }
        if (o.sill > EPS)
          horizontal(
            `opening/${o.id}/sill`,
            'sill',
            o.sillMember ?? wall.track,
            a,
            b,
            Math.min(o.sill, minTop),
            o,
          );
        if (!o.headerId)
          diagnostic(
            { ...source, openingId: o.id },
            'missing-header',
            'Opening requires an explicit header detail',
          );
        else
          for (const c of present(data.headers[o.headerId]).components) {
            if (
              a - c.startExtension < -EPS ||
              b + c.endExtension > line.length + EPS
            ) {
              diagnostic(
                { ...source, openingId: o.id },
                'header-outside-wall',
                'Header extension is outside wall',
              );
              continue;
            }
            const headerStart = a - c.startExtension;
            const headerEnd = b + c.endExtension;
            const topStations = sorted([
              headerStart,
              headerEnd,
              ...breaks.filter((s) => s > headerStart && s < headerEnd),
            ]);
            const envelopeTop =
              head +
              c.verticalOffset +
              headerHalfHeight(c.member, c.sectionRotation);
            if (
              c.verticalOffset - headerHalfHeight(c.member, c.sectionRotation) <
              -EPS
            )
              diagnostic(
                { ...source, openingId: o.id },
                'header-in-opening',
                'Header section extends below the rough opening head; revise its centreline offset',
              );
            if (topStations.some((s) => envelopeTop > topAt(s) + EPS))
              diagnostic(
                { ...source, openingId: o.id },
                'header-above-top',
                'Header section exceeds the wall top after the authored top allowance; revise the detail',
              );
            horizontal(
              `opening/${o.id}/header/${c.id}`,
              c.role,
              c.member,
              a - c.startExtension,
              b + c.endExtension,
              head + c.verticalOffset,
              o,
              c.faceOffset,
              c.sectionRotation ?? 0,
            );
          }
      }
      for (const backing of wall.backing ?? []) {
        const cuts: [number, number][] = openings
          .filter(
            (o) =>
              backing.height >= o.sill - EPS &&
              backing.height <= o.sill + o.height + EPS,
          )
          .map((o) => [o.distance, o.distance + o.width]);
        for (const [a, b] of subtract(0, line.length, cuts)) {
          const segments = sorted([
            a,
            b,
            ...breaks.filter((s) => s > a && s < b),
          ]);
          for (let i = 1; i < segments.length; i++) {
            let x = present(segments[i - 1]);
            let y = present(segments[i]);
            const hx = heightAt(wall, x);
            const hy = heightAt(wall, y, true);
            if (Math.max(hx, hy) < backing.height) continue;
            if (Math.min(hx, hy) < backing.height) {
              const crossing =
                x + ((y - x) * (backing.height - hx)) / (hy - hx);
              if (hx < backing.height) x = crossing;
              else y = crossing;
            }
            horizontal(
              `backing/${backing.id}/${String(x)}`,
              'backing',
              backing.member,
              x,
              y,
              backing.height,
            );
          }
        }
      }
      // Vertical decomposition makes each emitted face polygon opening-free, including slope crossings.
      const faceBreaks = sorted([
        ...breaks,
        ...openings.flatMap((o) => [o.distance, o.distance + o.width]),
      ]);
      for (let i = 1; i < faceBreaks.length; i++) {
        const a = present(faceBreaks[i - 1]);
        const b = present(faceBreaks[i]);
        const ha = heightAt(wall, a);
        const hb = heightAt(wall, b, true);
        const active = openings.filter(
          (o) => o.distance < b - EPS && o.distance + o.width > a + EPS,
        );
        const splits = [a, b];
        for (const finish of wall.finishes ?? []) {
          const height = finish.height;
          if (height !== undefined && (height - ha) * (height - hb) < 0)
            splits.push(a + ((b - a) * (height - ha)) / (hb - ha));
        }
        for (const o of active)
          for (const z of [o.sill, o.sill + o.height])
            if ((z - ha) * (z - hb) < 0)
              splits.push(a + ((b - a) * (z - ha)) / (hb - ha));
        const xs = sorted(splits);
        for (let j = 1; j < xs.length; j++) {
          const x = present(xs[j - 1]);
          const y = present(xs[j]);
          const hx = ha + ((hb - ha) * (x - a)) / (b - a);
          const hy = ha + ((hb - ha) * (y - a)) / (b - a);
          const bands = subtract(
            0,
            Math.max(hx, hy),
            active.map((o) => [o.sill, o.sill + o.height]),
          );
          for (let k = 0; k < bands.length; k++) {
            const [low, high] = present(bands[k]);
            for (const finish of wall.finishes ?? []) {
              const tx = Math.min(high, hx, finish.height ?? Infinity);
              const ty = Math.min(high, hy, finish.height ?? Infinity);
              const area =
                ((y - x) * (Math.max(0, tx - low) + Math.max(0, ty - low))) / 2;
              if (area <= EPS) continue;
              if (--budget < 0) throw new Error('generation-budget');
              const thickness =
                finish.thickness === undefined
                  ? undefined
                  : finish.thickness * finish.layers;
              const faceOffset =
                (finish.face === 'front' ? 1 : -1) *
                (wall.stud.depth / 2 +
                  (finish.offset ?? 0) +
                  (thickness ?? 0) / 2);
              const midpoint = (x + y) / 2;
              result.surfaces.push({
                ...source,
                finishId: finish.id,
                id: `${wall.id}/finish/${finish.id}/${String(i)}/${String(j)}/${String(k)}`,
                materialId: finish.materialId,
                face: finish.face,
                layers: finish.layers,
                geometricArea: area,
                area: area * finish.layers,
                quantityMode: 'included',
                wastePercent: finish.wastePercent ?? 0,
                ...(finish.packageSize === undefined
                  ? {}
                  : { packageSize: finish.packageSize }),
                ...(thickness === undefined ? {} : { thickness }),
                points: [
                  at(x, low, faceOffset, midpoint),
                  at(y, low, faceOffset, midpoint),
                  at(y, Math.max(low, ty), faceOffset, midpoint),
                  at(x, Math.max(low, tx), faceOffset, midpoint),
                ],
              });
            }
          }
        }
      }
    }
    for (const ceiling of ordered(data.ceilings)) {
      const source = { ceilingId: ceiling.id, geometryId: ceiling.geometryId };
      budgetSource = source;
      const geometry = present(project.geometries[ceiling.geometryId]);
      if (geometry.points.length > budget) {
        diagnostic(
          source,
          'generation-budget',
          'Ceiling exceeds finite generation budget',
        );
        continue;
      }
      const scale =
        project.sheets[geometry.sheetId]?.calibration?.metresPerUnit;
      if (!scale) {
        diagnostic(
          source,
          'missing-calibration',
          'Ceiling sheet needs calibration',
        );
        continue;
      }
      if (--budget < 0) throw new Error('generation-budget');
      const placement = placements.find((p) => p.sheetId === geometry.sheetId);
      const elevation =
        ceiling.elevation +
        (ceiling.levelId ? present(data.levels[ceiling.levelId]).elevation : 0);
      const points = geometry.points.map((p) => {
        const v = world(p, scale, placement);
        return { ...v, z: v.z + elevation };
      });
      const area = polygonArea(geometry.points) * scale ** 2;
      result.surfaces.push({
        ...source,
        id: `${ceiling.id}/ceiling`,
        materialId: ceiling.materialId,
        face: 'ceiling',
        layers: ceiling.layers,
        points,
        geometricArea: area,
        area: area * ceiling.layers,
        quantityMode: ceiling.quantityMode ?? 'reference',
      });
    }
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'generation-budget')
      throw error;
    diagnostic(
      budgetSource,
      'generation-budget',
      'Construction generation stopped at the finite piece/surface budget',
    );
  }
  for (const { spec, length, count, pieceIds } of purchase.values()) {
    const adjusted = count * (1 + (spec.wastePercent ?? 0) / 100);
    const packageCount = spec.packageSize
      ? wholeQuantity(adjusted / spec.packageSize)
      : null;
    result.purchases.push({
      materialId: spec.materialId,
      stockLength: length,
      requiredCount: count,
      wastePercent: spec.wastePercent ?? 0,
      adjustedCount: adjusted,
      pieceIds,
      purchasedCount:
        packageCount === null
          ? wholeQuantity(adjusted)
          : packageCount * present(spec.packageSize),
      packageCount,
    });
  }
  for (const wall of ordered(data.walls))
    for (const finish of wall.finishes ?? []) {
      const surfaces = result.surfaces.filter(
        (s) => s.wallId === wall.id && s.finishId === finish.id,
      );
      if (!surfaces.length) continue;
      const gross = surfaces.reduce(
        (sum, surface) => sum + surface.geometricArea,
        0,
      );
      const deduction = finish.deduction ?? 0;
      const source = {
        wallId: wall.id,
        geometryId: wall.geometryId,
        finishId: finish.id,
      };
      if (deduction > gross + EPS)
        diagnostic(
          source,
          'excess-finish-deduction',
          'Finish deduction exceeds remaining face area',
        );
      const net = Math.max(0, gross - deduction);
      for (const surface of surfaces)
        surface.area = ((surface.geometricArea * net) / gross) * finish.layers;
      const requiredArea = net * finish.layers;
      const wastePercent = finish.wastePercent ?? 0;
      const adjusted = requiredArea * (1 + wastePercent / 100);
      const packageCount =
        finish.packageSize === undefined
          ? null
          : wholeQuantity(adjusted / finish.packageSize);
      present(result.surfacePurchases).push({
        ...source,
        materialId: finish.materialId,
        requiredArea,
        wastePercent,
        ...(finish.packageSize === undefined
          ? {}
          : { packageSize: finish.packageSize }),
        packageCount,
        purchasedArea:
          packageCount === null
            ? adjusted
            : packageCount * present(finish.packageSize),
      });
    }
  for (const surface of result.surfaces)
    if (surface.face === 'ceiling' && surface.quantityMode === 'included') {
      present(result.surfacePurchases).push({
        ...(surface.ceilingId ? { ceilingId: surface.ceilingId } : {}),
        ...(surface.geometryId ? { geometryId: surface.geometryId } : {}),
        materialId: surface.materialId,
        requiredArea: surface.area,
        wastePercent: 0,
        packageCount: null,
        purchasedArea: surface.area,
      });
    }
  return result;
}
function present<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('Expected validated construction value');
  return value;
}
