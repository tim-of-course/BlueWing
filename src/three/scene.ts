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
export interface ConstructionScene {
  faces: SceneFace[];
  bounds: { min: Point3; max: Point3 };
  count: number;
  omitted: number;
}
export interface SceneCamera {
  yaw: number;
  pitch: number;
  zoom: number;
}
export const defaultCamera: SceneCamera = {
  yaw: -Math.PI / 4,
  pitch: Math.PI / 5,
  zoom: 1,
};
export const MAX_SCENE_OBJECTS = 4000;
export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
}
export interface ProjectedFace extends Omit<SceneFace, 'points'> {
  points: ScreenPoint[];
  depth: number;
  light: number;
}
export interface ProjectedScene {
  faces: ProjectedFace[];
  width: number;
  height: number;
  scale: number;
}

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

export function memberFaces(member: SceneMember): SceneFace[] {
  const along = unit(sub(member.end, member.start));
  const reference =
    Math.abs(along.z) > 0.9 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const baseWidth = unit(member.widthAxis ?? cross(reference, along));
  const rotation = member.sectionRotation ?? 0;
  const width = mul(
    add(
      mul(baseWidth, Math.cos(rotation)),
      mul(cross(along, baseWidth), Math.sin(rotation)),
    ),
    member.width / 2,
  );
  const depth = mul(unit(cross(along, width)), member.depth / 2);
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

export function buildConstructionScene(
  input: SceneInput,
  filter: SceneFilter = {},
  limit = MAX_SCENE_OBJECTS,
): ConstructionScene {
  const faces: SceneFace[] = [];
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let count = 0;
  let omitted = 0;
  const selected = filter.geometryIds ? new Set(filter.geometryIds) : null;
  const level = filter.levelGeometryIds
    ? new Set(filter.levelGeometryIds)
    : null;
  const include = (source: SceneSource) =>
    (!filter.materialId || source.materialId === filter.materialId) &&
    (!filter.role || source.role === filter.role) &&
    (!selected || selected.has(source.geometryId)) &&
    (!level || level.has(source.geometryId));
  const append = (source: SceneSource, getFaces: () => SceneFace[]) => {
    if (!include(source)) return;
    if (count >= Math.max(0, Math.min(MAX_SCENE_OBJECTS, limit))) {
      omitted++;
      return;
    }
    const next = getFaces();
    for (const face of next)
      for (const point of face.points) {
        min.x = Math.min(min.x, point.x);
        min.y = Math.min(min.y, point.y);
        min.z = Math.min(min.z, point.z);
        max.x = Math.max(max.x, point.x);
        max.y = Math.max(max.y, point.y);
        max.z = Math.max(max.z, point.z);
      }
    faces.push(...next);
    count++;
  };
  for (const member of input.members) append(member, () => memberFaces(member));
  for (const surface of input.surfaces)
    append(surface, () => surfaceFaces(surface));
  if (!faces.length)
    return {
      faces,
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
      count,
      omitted,
    };
  return { faces, bounds: { min, max }, count, omitted };
}

export function orbitCamera(
  camera: SceneCamera,
  dx: number,
  dy: number,
): SceneCamera {
  return {
    ...camera,
    yaw: camera.yaw + dx * 0.008,
    pitch: Math.max(-1.45, Math.min(1.45, camera.pitch + dy * 0.008)),
  };
}
export function zoomCamera(camera: SceneCamera, factor: number): SceneCamera {
  return {
    ...camera,
    zoom: Math.max(0.15, Math.min(15, camera.zoom * factor)),
  };
}
export function projectPoint(point: Point3, camera: SceneCamera): ScreenPoint {
  const s = Math.sin(camera.yaw),
    c = Math.cos(camera.yaw);
  const sp = Math.sin(camera.pitch),
    cp = Math.cos(camera.pitch);
  return {
    x: -s * point.x + c * point.y,
    y: sp * (c * point.x + s * point.y) - cp * point.z,
    depth: cp * (c * point.x + s * point.y) + sp * point.z,
  };
}
export function projectConstruction(
  scene: ConstructionScene,
  width: number,
  height: number,
  camera: SceneCamera = defaultCamera,
): ProjectedScene {
  const center = mul(add(scene.bounds.min, scene.bounds.max), 0.5);
  // Fit a bounding sphere so orbiting does not continually change the scale.
  const size = sub(scene.bounds.max, scene.bounds.min);
  const diameter = Math.max(0.1, Math.hypot(size.x, size.y, size.z));
  const scale =
    (Math.max(1, Math.min(width, height) - 64) / diameter) * camera.zoom;
  const faces = scene.faces
    .map((face) => {
      const points = face.points.map((point) => {
        const projected = projectPoint(sub(point, center), camera);
        return {
          x: width / 2 + projected.x * scale,
          y: height / 2 + projected.y * scale,
          depth: projected.depth,
        };
      });
      const [a, b, c] = face.points;
      const normal =
        a && b && c ? unit(cross(sub(b, a), sub(c, a))) : { x: 0, y: 0, z: 1 };
      const light =
        55 + Math.abs(dot(normal, unit({ x: 0.4, y: 0.6, z: 1 }))) * 22;
      return {
        ...face,
        points,
        light,
        depth:
          points.reduce((sum, point) => sum + point.depth, 0) / points.length,
      };
    })
    .sort((a, b) => a.depth - b.depth);
  return { faces, width, height, scale };
}
export function pickConstruction(
  scene: ProjectedScene,
  x: number,
  y: number,
): SceneSource | null {
  let nearest:
    { source: SceneSource; depth: number; surface: boolean } | undefined;
  for (let index = scene.faces.length - 1; index >= 0; index--) {
    const face = scene.faces[index];
    if (!face) continue;
    let inside = false;
    for (
      let i = 0, j = face.points.length - 1;
      i < face.points.length;
      j = i++
    ) {
      const a = face.points[i],
        b = face.points[j];
      if (!a || !b) continue;
      if (
        a.y > y !== b.y > y &&
        x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
    if (!inside) continue;
    // Orthographic depth is a plane, so compare it at the click rather than at
    // each polygon's centre. Inspection rendering puts members over finishes.
    const a = face.points[0];
    if (!a) continue;
    for (let i = 1; i + 1 < face.points.length; i++) {
      const b = face.points[i],
        c = face.points[i + 1];
      if (!b || !c) continue;
      const determinant = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(determinant) < 1e-10) continue;
      const u =
        ((x - a.x) * (c.y - a.y) - (y - a.y) * (c.x - a.x)) / determinant;
      const v =
        ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / determinant;
      const depth = a.depth + u * (b.depth - a.depth) + v * (c.depth - a.depth);
      if (
        !nearest ||
        (nearest.surface && !face.surface) ||
        (nearest.surface === face.surface && depth > nearest.depth)
      )
        nearest = { source: face.source, depth, surface: face.surface };
      break;
    }
  }
  return nearest?.source ?? null;
}
function materialHue(material: string): number {
  let hash = 0;
  for (let i = 0; i < material.length; i++)
    hash = (hash * 31 + material.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}
export interface RenderConstructionOptions {
  width?: number;
  height?: number;
  pixelRatio?: number;
  camera?: SceneCamera;
  selectedGeometryIds?: readonly string[];
  selectedPieceId?: string | null;
}
/** Renders synchronously; callers can export canvas.toDataURL() for CLI images. */
export function renderConstruction(
  canvas: HTMLCanvasElement,
  scene: ConstructionScene,
  options: RenderConstructionOptions = {},
): ProjectedScene {
  const width = options.width ?? (canvas.clientWidth || canvas.width);
  const height = options.height ?? (canvas.clientHeight || canvas.height);
  const ratio = Math.min(2, options.pixelRatio ?? 1);
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const projected = projectConstruction(scene, width, height, options.camera);
  const context = canvas.getContext('2d');
  if (!context) return projected;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = '#edf1f5';
  context.fillRect(0, 0, width, height);
  const selection = new Set(options.selectedGeometryIds);
  // Translucent finish surfaces provide context without hiding the framing
  // being checked. Material and role filters can isolate either representation.
  const faces = [
    ...projected.faces.filter((face) => face.surface),
    ...projected.faces.filter((face) => !face.surface),
  ];
  for (const face of faces) {
    if (!face.points.length) continue;
    context.beginPath();
    face.points.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
    const active = options.selectedPieceId === face.source.id;
    context.globalAlpha = face.surface ? 0.3 : 1;
    context.fillStyle = active
      ? '#ffbd66'
      : `hsl(${String(materialHue(face.source.materialId))} 28% ${String(face.surface ? face.light + 8 : face.light)}%)`;
    context.fill();
    context.lineWidth = active
      ? 2
      : selection.has(face.source.geometryId)
        ? 1.5
        : 0.65;
    context.strokeStyle = active
      ? '#9b4c00'
      : selection.has(face.source.geometryId)
        ? '#196cb3'
        : '#526375';
    context.stroke();
  }
  context.globalAlpha = 1;
  context.fillStyle = '#526375';
  context.font = '12px sans-serif';
  context.fillText('Plan XY · Elevation Z · metres', 14, height - 14);
  if (scene.faces.some((face) => face.surface))
    context.fillText(
      'Framing shown through translucent finishes',
      14,
      height - 30,
      width - 28,
    );
  if (
    scene.faces.some((face) => face.surface && face.source.role === 'ceiling')
  )
    context.fillText('Ceiling surfaces show calculated installed area', 14, 22);
  return projected;
}
