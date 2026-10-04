import type { ConstructionResult } from '../core/construction-types';

/** Metres in plan XY, elevation Z. This module has no Solid or DOM lifecycle state. */
export interface Point3 {
  x: number;
  y: number;
  z: number;
}
export interface SceneSource {
  id: string;
  geometryId: string;
  wallId?: string;
  openingId?: string;
  materialId: string;
  role: string;
}
export interface SceneMember extends SceneSource {
  start: Point3;
  end: Point3;
  width: number;
  depth: number;
  widthAxis?: Point3;
  sectionRotation?: number;
}
export interface SceneSurface extends SceneSource {
  points: readonly Point3[];
  /** Total thickness, centred on the generated surface points. */
  thickness?: number;
}
export interface SceneInput {
  members: readonly SceneMember[];
  surfaces: readonly SceneSurface[];
}
export interface SceneFilter {
  materialId?: string;
  role?: string;
  geometryIds?: readonly string[];
  levelGeometryIds?: readonly string[];
}
export interface SceneFace {
  points: Point3[];
  source: SceneSource;
  surface: boolean;
}
export interface ConstructionScene extends SceneInput {
  bounds: { min: Point3; max: Point3 };
  count: number;
  omitted: number;
}
export interface SceneCamera {
  yaw: number;
  pitch: number;
  zoom: number;
  target?: Point3;
  /** World span across the shorter viewport axis at zoom 1. */
  span?: number;
}
export type DisplayMode = 'solid' | 'framing' | 'xray';
export const viewPresets = {
  isometric: { yaw: -Math.PI / 4, pitch: Math.PI / 5 },
  top: { yaw: -Math.PI / 2, pitch: Math.PI / 2 },
  front: { yaw: -Math.PI / 2, pitch: 0 },
  back: { yaw: Math.PI / 2, pitch: 0 },
  left: { yaw: Math.PI, pitch: 0 },
  right: { yaw: 0, pitch: 0 },
} as const;
export type ViewPreset = keyof typeof viewPresets;
export const defaultCamera: SceneCamera = { ...viewPresets.isometric, zoom: 1 };

const add = (a: Point3, b: Point3): Point3 => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
const sub = (a: Point3, b: Point3): Point3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const mul = (a: Point3, n: number): Point3 => ({
  x: a.x * n,
  y: a.y * n,
  z: a.z * n,
});
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point3, b: Point3): Point3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (a: Point3): Point3 =>
  mul(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));

/** A unit box transformed by these axes has exactly the calculated member envelope. */
export function memberFrame(member: SceneMember) {
  const delta = sub(member.end, member.start);
  const length = Math.hypot(delta.x, delta.y, delta.z);
  const along = unit(delta);
  const reference =
    Math.abs(along.z) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const baseWidth = unit(member.widthAxis ?? cross(reference, along));
  const rotation = member.sectionRotation ?? 0;
  const width = mul(
    add(
      mul(baseWidth, Math.cos(rotation)),
      mul(cross(along, baseWidth), Math.sin(rotation)),
    ),
    member.width,
  );
  const depth = mul(unit(cross(along, width)), member.depth);
  return {
    center: mul(add(member.start, member.end), 0.5),
    width,
    depth,
    length,
    along: delta,
  };
}
export function memberFaces(member: SceneMember): SceneFace[] {
  const frame = memberFrame(member);
  const width = mul(frame.width, 0.5),
    depth = mul(frame.depth, 0.5);
  const vertices = [member.start, member.end].flatMap((end) => [
    add(add(end, width), depth),
    add(sub(end, width), depth),
    sub(sub(end, width), depth),
    add(sub(end, depth), width),
  ]);
  return [
    [0, 1, 2, 3],
    [4, 7, 6, 5],
    [0, 4, 5, 1],
    [1, 5, 6, 2],
    [2, 6, 7, 3],
    [3, 7, 4, 0],
  ].map((indices) => ({
    points: indices.flatMap((index) =>
      vertices[index] ? [vertices[index]] : [],
    ),
    source: member,
    surface: false,
  }));
}

export function constructionSceneInput(result: ConstructionResult): SceneInput {
  // Vertical endpoints alone do not encode wall direction. Recover it from the
  // nearest track segment of the same wall, including bent wall paths.
  const tracks = new Map<string, typeof result.pieces>();
  for (const piece of result.pieces) {
    if (piece.wallId && piece.role.endsWith('track')) {
      const list = tracks.get(piece.wallId) ?? [];
      list.push(piece);
      tracks.set(piece.wallId, list);
    }
  }
  const widthAxis = (
    piece: (typeof result.pieces)[number],
  ): Point3 | undefined => {
    if (
      Math.hypot(piece.end.x - piece.start.x, piece.end.y - piece.start.y) >
      1e-8
    )
      return undefined;
    let nearest = Infinity;
    let axis: Point3 | undefined;
    for (const track of tracks.get(piece.wallId ?? '') ?? []) {
      const delta = {
        x: track.end.x - track.start.x,
        y: track.end.y - track.start.y,
        z: 0,
      };
      const lengthSquared = dot(delta, delta);
      if (lengthSquared < 1e-12) continue;
      const offset = sub(piece.start, track.start);
      const station = Math.max(
        0,
        Math.min(1, dot(offset, delta) / lengthSquared),
      );
      const distance = Math.hypot(
        offset.x - delta.x * station,
        offset.y - delta.y * station,
      );
      if (distance < nearest) {
        nearest = distance;
        axis = unit(delta);
      }
    }
    return axis;
  };
  return {
    members: result.pieces.map((piece) => {
      const axis = piece.widthAxis ?? widthAxis(piece);
      return {
        ...piece,
        sectionRotation: piece.widthAxis ? 0 : piece.sectionRotation,
        geometryId: piece.geometryId ?? '',
        ...(axis ? { widthAxis: axis } : {}),
      };
    }),
    surfaces: result.surfaces.map((surface) => ({
      ...surface,
      geometryId: surface.geometryId ?? '',
      role: surface.face === 'ceiling' ? 'ceiling' : 'finish',
    })),
  };
}

export function surfaceFaces(surface: SceneSurface): SceneFace[] {
  const face = (points: Point3[]): SceneFace => ({
    points,
    source: surface,
    surface: true,
  });
  const origin = surface.points[0];
  if (!origin || !surface.thickness) return [face([...surface.points])];
  // Sum triangle normals so a collinear first edge does not flatten the finish.
  let normal = { x: 0, y: 0, z: 0 };
  for (let i = 1; i < surface.points.length - 1; i++) {
    const a = surface.points[i],
      b = surface.points[i + 1];
    if (a && b) normal = add(normal, cross(sub(a, origin), sub(b, origin)));
  }
  const offset = mul(unit(normal), surface.thickness / 2);
  const front = surface.points.map((point) => add(point, offset));
  const back = surface.points.map((point) => sub(point, offset));
  return [
    face(front),
    face([...back].reverse()),
    ...front.flatMap((point, i) => {
      const next = (i + 1) % front.length;
      const a = front[next],
        b = back[next],
        c = back[i];
      return a && b && c ? [face([point, c, b, a])] : [];
    }),
  ];
}

function boundsOf(input: SceneInput): ConstructionScene['bounds'] {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const include = (point: Point3) => {
    for (const axis of ['x', 'y', 'z'] as const) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  };
  for (const member of input.members) {
    const frame = memberFrame(member);
    const half = { x: 0, y: 0, z: 0 };
    for (const axis of ['x', 'y', 'z'] as const)
      half[axis] =
        (Math.abs(frame.width[axis]) +
          Math.abs(frame.depth[axis]) +
          Math.abs(frame.along[axis])) /
        2;
    include(sub(frame.center, half));
    include(add(frame.center, half));
  }
  for (const surface of input.surfaces)
    for (const face of surfaceFaces(surface))
      for (const point of face.points) include(point);
  return Number.isFinite(min.x)
    ? { min, max }
    : { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } };
}

/** Filtering retains original records. No renderer-specific object cap or duplicate face graph. */
export function buildConstructionScene(
  input: SceneInput,
  filter: SceneFilter = {},
  limit = Infinity,
): ConstructionScene {
  const selected = filter.geometryIds ? new Set(filter.geometryIds) : null;
  const level = filter.levelGeometryIds
    ? new Set(filter.levelGeometryIds)
    : null;
  let count = 0,
    omitted = 0;
  const include = (source: SceneSource) => {
    if (
      (filter.materialId && source.materialId !== filter.materialId) ||
      (filter.role && source.role !== filter.role) ||
      (selected && !selected.has(source.geometryId)) ||
      (level && !level.has(source.geometryId))
    )
      return false;
    if (count >= Math.max(0, limit)) {
      omitted++;
      return false;
    }
    count++;
    return true;
  };
  const members = input.members.filter(include);
  const surfaces = input.surfaces.filter(include);
  return {
    members,
    surfaces,
    bounds: boundsOf({ members, surfaces }),
    count,
    omitted,
  };
}

export function fitCamera(
  scene: ConstructionScene,
  camera: SceneCamera = defaultCamera,
  geometryIds?: readonly string[],
  pieceId?: string | null,
): SceneCamera & { target: Point3; span: number } {
  let bounds = scene.bounds;
  if (pieceId || geometryIds) {
    const ids = new Set(geometryIds);
    const include = (source: SceneSource) =>
      pieceId ? source.id === pieceId : ids.has(source.geometryId);
    const members = scene.members.filter(include),
      surfaces = scene.surfaces.filter(include);
    if (members.length || surfaces.length)
      bounds = boundsOf({ members, surfaces });
  }
  const size = sub(bounds.max, bounds.min);
  return {
    ...camera,
    zoom: 1,
    target: mul(add(bounds.min, bounds.max), 0.5),
    span: Math.max(0.1, Math.hypot(size.x, size.y, size.z)) * 1.08,
  };
}
export function resolveCamera(
  scene: ConstructionScene,
  camera: SceneCamera,
): SceneCamera & { target: Point3; span: number } {
  if (camera.target && camera.span !== undefined)
    return { ...camera, target: camera.target, span: camera.span };
  const fitted = fitCamera(scene, camera);
  return {
    ...camera,
    target: camera.target ?? fitted.target,
    span: camera.span ?? fitted.span,
  };
}
export function orbitCamera(
  camera: SceneCamera,
  dx: number,
  dy: number,
): SceneCamera {
  return {
    ...camera,
    yaw: camera.yaw + dx * 0.008,
    pitch: Math.max(
      -Math.PI / 2,
      Math.min(Math.PI / 2, camera.pitch + dy * 0.008),
    ),
  };
}
export function zoomCamera(camera: SceneCamera, factor: number): SceneCamera {
  return {
    ...camera,
    zoom: Math.max(0.01, Math.min(10000, camera.zoom * factor)),
  };
}
