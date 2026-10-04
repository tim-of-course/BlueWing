import type { PayloadSchema } from './commands';
import type { GeometryKind, Point, Project } from './types';
import type {
  ConstructionContext,
  ConstructionResult,
  ConstructionSource,
  HeaderComponent,
  MemberSpec,
  SheetPlacement,
  Vec3,
} from './construction-types';
import { pointInPolygon } from './geometry';
import { surfaceArea } from './material-results';

export interface MaterialOpening {
  id: string;
  distance: number;
  width: number;
  sill: number;
  height: number;
}

/** Metres and radians. The kind selects the fields that may be authored. */
export interface MaterialTemplate {
  kind: 'path-surface' | 'path-members' | 'area-members';
  /** Surface bottom, or member centreline. Added to level and sheet placement. */
  elevation: number;
  height?: number;
  materialId?: string;
  layers?: number;
  thickness?: number;
  /** Surface back-face offset to the left of the directed world-space trace. */
  offset?: number;
  wastePercent?: number;
  packageSize?: number;
  openings?: MaterialOpening[];
  /** Centreline elevation at the final path point; defaults to elevation. */
  endElevation?: number;
  /** Extensions follow the true 3D member axis at the two outer path ends. */
  components?: HeaderComponent[];
  spacing?: number;
  /** World XY grid origin. Parallel members follow rotation, at spacing multiples. */
  origin?: Point;
  rotation?: number;
  member?: MemberSpec;
  role?: string;
}

export interface MaterialApplication extends ConstructionSource {
  id: string;
  geometryId: string;
  levelId?: string;
  template: MaterialTemplate;
}

const text: PayloadSchema = { type: 'string' };
const number: PayloadSchema = { type: 'number' };
const positive: PayloadSchema = { type: 'number', minimum: Number.MIN_VALUE };
const nonnegative: PayloadSchema = { type: 'number', minimum: 0 };
const object = (
  properties: Record<string, PayloadSchema>,
  required = Object.keys(properties),
): PayloadSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const array = (items: PayloadSchema): PayloadSchema => ({
  type: 'array',
  items,
});
const memberSchema = object(
  {
    materialId: text,
    width: positive,
    depth: positive,
    stockLength: positive,
    wastePercent: nonnegative,
    packageSize: positive,
  },
  ['materialId', 'width', 'depth'],
);
const fields: Record<string, PayloadSchema> = {
  kind: {
    type: 'string',
    enum: ['path-surface', 'path-members', 'area-members'],
  },
  elevation: number,
  height: positive,
  materialId: text,
  layers: positive,
  thickness: positive,
  offset: number,
  wastePercent: nonnegative,
  packageSize: positive,
  openings: array(
    object({
      id: text,
      distance: nonnegative,
      width: positive,
      sill: nonnegative,
      height: positive,
    }),
  ),
  endElevation: number,
  components: array(
    object(
      {
        id: text,
        role: text,
        member: memberSchema,
        startExtension: nonnegative,
        endExtension: nonnegative,
        verticalOffset: number,
        faceOffset: number,
        sectionRotation: number,
      },
      [
        'id',
        'role',
        'member',
        'startExtension',
        'endExtension',
        'verticalOffset',
        'faceOffset',
      ],
    ),
  ),
  spacing: positive,
  origin: object({ x: number, y: number }),
  rotation: number,
  member: memberSchema,
  role: text,
};
const kindFields: Record<MaterialTemplate['kind'], string[]> = {
  'path-surface': [
    'height',
    'materialId',
    'layers',
    'thickness',
    'offset',
    'wastePercent',
    'packageSize',
    'openings',
  ],
  'path-members': ['endElevation', 'components'],
  'area-members': ['spacing', 'origin', 'rotation', 'member', 'role'],
};
const requiredFields: Record<MaterialTemplate['kind'], string[]> = {
  'path-surface': ['materialId', 'layers'],
  'path-members': ['components'],
  'area-members': ['spacing', 'origin', 'rotation', 'member', 'role'],
};

function partial(schema: PayloadSchema): PayloadSchema {
  return {
    ...schema,
    required: [],
    properties: Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [
        key,
        {
          ...(value.type === 'object' ? partial(value) : value),
          ...(!schema.required?.includes(key) ? { nullable: true } : {}),
        },
      ]),
    ),
  };
}

export const materialTemplateSchema = object(fields, ['kind', 'elevation']);
export const materialOverrideSchema = partial(
  object(
    {
      ...Object.fromEntries(
        Object.entries(fields).filter(([key]) => key !== 'kind'),
      ),
      levelId: text,
    },
    [
      'elevation',
      'materialId',
      'layers',
      'components',
      'spacing',
      'origin',
      'rotation',
      'member',
      'role',
    ],
  ),
);

/** A focused schema keeps each editor limited to settings the generator uses. */
export function materialFieldsSchema(
  kind: MaterialTemplate['kind'],
  overrides = false,
): PayloadSchema {
  const names = ['kind', 'elevation', ...kindFields[kind]];
  const schema = object(
    Object.fromEntries(
      names.map((name) => [
        name,
        name === 'kind'
          ? { type: 'string', enum: [kind] }
          : (fields[name] ?? {}),
      ]),
    ),
    ['kind', 'elevation', ...requiredFields[kind]],
  );
  if (!overrides) return schema;
  const properties: Record<string, PayloadSchema> = {
    ...schema.properties,
    levelId: text,
  };
  delete properties.kind;
  return partial({
    ...schema,
    properties,
    required: (schema.required ?? []).filter((name) => name !== 'kind'),
  });
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Material layout: ${message}`);
}
function finite(
  value: number | undefined,
  label: string,
  minimum = -Infinity,
): asserts value is number {
  requireValue(
    typeof value === 'number' && Number.isFinite(value) && value >= minimum,
    `${label} must be finite and >= ${String(minimum)}`,
  );
}
function positiveValue(
  value: number | undefined,
  label: string,
): asserts value is number {
  finite(value, label, 0);
  requireValue(value > 0, `${label} must be positive`);
}
function identifier(value: string | undefined, label: string) {
  requireValue(
    typeof value === 'string' && value.trim(),
    `${label} is required`,
  );
}
function validateMember(spec: MemberSpec | undefined) {
  requireValue(spec && typeof spec === 'object', 'member is required');
  identifier(spec.materialId, 'member material');
  positiveValue(spec.width, 'member width');
  positiveValue(spec.depth, 'member depth');
  if (spec.stockLength !== undefined)
    positiveValue(spec.stockLength, 'stock length');
  if (spec.wastePercent !== undefined) finite(spec.wastePercent, 'waste', 0);
  if (spec.packageSize !== undefined) {
    positiveValue(spec.packageSize, 'member package size');
    requireValue(
      Number.isSafeInteger(spec.packageSize),
      'member package size must be a whole number',
    );
  }
}
function unique(values: { id: string }[], label: string) {
  for (const value of values) identifier(value.id, `${label} id`);
  requireValue(
    new Set(values.map((value) => value.id)).size === values.length,
    `${label} ids must be unique`,
  );
}

export function validateMaterialTemplate(template: MaterialTemplate): void {
  requireValue(
    typeof template === 'object' && Object.hasOwn(kindFields, template.kind),
    'unknown template kind',
  );
  const allowed = new Set(['kind', 'elevation', ...kindFields[template.kind]]);
  for (const name of Object.keys(template))
    requireValue(allowed.has(name), `${name} is not used by ${template.kind}`);
  finite(template.elevation, 'elevation');
  if (template.kind === 'path-surface') {
    identifier(template.materialId, 'surface material');
    positiveValue(template.layers, 'surface layers');
    requireValue(
      Number.isSafeInteger(template.layers),
      'surface layers must be a whole number',
    );
    if (template.height !== undefined)
      positiveValue(template.height, 'surface height');
    if (template.thickness !== undefined)
      positiveValue(template.thickness, 'surface thickness');
    if (template.offset !== undefined)
      finite(template.offset, 'surface offset');
    if (template.wastePercent !== undefined)
      finite(template.wastePercent, 'surface waste', 0);
    if (template.packageSize !== undefined)
      positiveValue(template.packageSize, 'surface package area');
    requireValue(
      template.openings === undefined || Array.isArray(template.openings),
      'openings must be an array',
    );
    unique(template.openings ?? [], 'opening');
    for (const opening of template.openings ?? []) {
      finite(opening.distance, 'opening distance', 0);
      positiveValue(opening.width, 'opening width');
      finite(opening.sill, 'opening sill', 0);
      positiveValue(opening.height, 'opening height');
    }
  } else if (template.kind === 'path-members') {
    if (template.endElevation !== undefined)
      finite(template.endElevation, 'end elevation');
    requireValue(
      Array.isArray(template.components) && template.components.length,
      'member components are required',
    );
    unique(template.components, 'component');
    for (const component of template.components) {
      identifier(component.role, 'component role');
      validateMember(component.member);
      finite(component.startExtension, 'start extension', 0);
      finite(component.endExtension, 'end extension', 0);
      finite(component.verticalOffset, 'vertical offset');
      finite(component.faceOffset, 'face offset');
      if (component.sectionRotation !== undefined)
        finite(component.sectionRotation, 'section rotation');
    }
  } else {
    positiveValue(template.spacing, 'member spacing');
    finite(template.origin?.x, 'origin x');
    finite(template.origin.y, 'origin y');
    finite(template.rotation, 'rotation');
    validateMember(template.member);
    identifier(template.role, 'member role');
  }
}

export function materialGeometryKind(template: MaterialTemplate): GeometryKind {
  return template.kind === 'area-members' ? 'area' : 'path';
}

const EPS = 1e-8;
const add = (a: Vec3, b: Vec3, factor = 1): Vec3 => ({
  x: a.x + b.x * factor,
  y: a.y + b.y * factor,
  z: a.z + b.z * factor,
});
const subtract = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const magnitude = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3): Vec3 => {
  const length = magnitude(a);
  return { x: a.x / length, y: a.y / length, z: a.z / length };
};
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
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
const sorted = (values: number[]) =>
  values
    .sort((a, b) => a - b)
    .filter(
      (value, index, all) =>
        index === 0 || value - (all[index - 1] ?? value) > EPS,
    );
function clearBands(
  height: number,
  openings: MaterialOpening[],
): [number, number][] {
  let bands: [number, number][] = [[0, height]];
  for (const opening of openings) {
    const low = opening.sill,
      high = low + opening.height;
    bands = bands.flatMap(([a, b]) => {
      if (low >= b - EPS || high <= a + EPS) return [[a, b]];
      const rest: [number, number][] = [];
      if (low > a + EPS) rest.push([a, Math.min(low, b)]);
      if (high < b - EPS) rest.push([Math.max(high, a), b]);
      return rest;
    });
  }
  return bands;
}
function onBoundary(point: Point, polygon: Point[]) {
  return polygon.some((a, index) => {
    const b = present(polygon[(index + 1) % polygon.length]);
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
  });
}
/** Disjoint spans include a row lying exactly along a boundary, without duplicates. */
function rowSpans(polygon: Point[], y: number): [number, number][] {
  const crossings: number[] = [];
  for (const [index, a] of polygon.entries()) {
    const b = present(polygon[(index + 1) % polygon.length]);
    if (Math.abs(a.y - b.y) <= EPS) {
      if (Math.abs(y - a.y) <= EPS) crossings.push(a.x, b.x);
    } else {
      const t = (y - a.y) / (b.y - a.y);
      if (t >= -EPS && t <= 1 + EPS)
        crossings.push(a.x + Math.max(0, Math.min(1, t)) * (b.x - a.x));
    }
  }
  const xs = sorted(crossings);
  const spans: [number, number][] = [];
  for (let index = 1; index < xs.length; index++) {
    const a = present(xs[index - 1]),
      b = present(xs[index]);
    const middle = { x: (a + b) / 2, y };
    if (!pointInPolygon(middle, polygon) && !onBoundary(middle, polygon))
      continue;
    const previous = spans.at(-1);
    if (previous && Math.abs(previous[1] - a) <= EPS) previous[1] = b;
    else spans.push([a, b]);
  }
  return spans;
}

/** Generated records, never stored geometry. Purchasing is summarized by the caller. */
export function generateMaterialLayout(
  project: Project,
  application: MaterialApplication,
  context: Pick<ConstructionContext, 'levels' | 'placements'>,
  maxElements = 50000,
): ConstructionResult {
  const template = application.template;
  validateMaterialTemplate(template);
  const result: ConstructionResult = {
    pieces: [],
    surfaces: [],
    purchases: [],
    surfacePurchases: [],
    diagnostics: [],
    complete: true,
  };
  const source: ConstructionSource = {
    ...(application.assignmentId
      ? { assignmentId: application.assignmentId }
      : {}),
    ...(application.recipeId ? { recipeId: application.recipeId } : {}),
    ...(application.groupId ? { groupId: application.groupId } : {}),
    ...(application.componentId
      ? { componentId: application.componentId }
      : {}),
    geometryId: application.geometryId,
  };
  const diagnostic = (code: string, message: string) => {
    result.complete = false;
    result.diagnostics.push({ ...source, code, message });
  };
  const geometry = project.geometries[application.geometryId];
  if (!geometry || geometry.kind !== materialGeometryKind(template)) {
    diagnostic(
      'incompatible-geometry',
      `Material layout needs ${materialGeometryKind(template)} geometry`,
    );
    return result;
  }
  const scale = project.sheets[geometry.sheetId]?.calibration?.metresPerUnit;
  if (!scale) {
    diagnostic(
      'missing-calibration',
      'Material layout sheet needs calibration',
    );
    return result;
  }
  if (application.levelId && !context.levels[application.levelId]) {
    diagnostic('missing-level', 'Material layout level is missing');
    return result;
  }
  if (!Number.isSafeInteger(maxElements) || maxElements < 0)
    throw new Error(
      'Material layout generation budget must be a nonnegative whole number',
    );
  const room = () => {
    if (result.pieces.length + result.surfaces.length < maxElements)
      return true;
    diagnostic(
      'generation-budget',
      'Material layout stopped at the finite piece/surface budget',
    );
    return false;
  };
  if (geometry.points.length > Math.max(maxElements, 4)) {
    diagnostic(
      'generation-budget',
      'Material layout trace exceeds the finite generation budget',
    );
    return result;
  }
  const placement = Object.values(context.placements).find(
    (item) => item.sheetId === geometry.sheetId,
  );
  const points = geometry.points.map((point) => world(point, scale, placement));
  const elevation =
    template.elevation +
    (application.levelId
      ? present(context.levels[application.levelId]).elevation
      : 0);
  const emit = (
    id: string,
    role: string,
    spec: MemberSpec,
    start: Vec3,
    end: Vec3,
    widthAxis: Vec3,
    sectionRotation = 0,
  ) => {
    if (!room()) return false;
    const delta = subtract(end, start),
      cutLength = magnitude(delta);
    const rotated = add(
      {
        x: widthAxis.x * Math.cos(sectionRotation),
        y: widthAxis.y * Math.cos(sectionRotation),
        z: widthAxis.z * Math.cos(sectionRotation),
      },
      cross(unit(delta), widthAxis),
      Math.sin(sectionRotation),
    );
    result.pieces.push({
      ...source,
      id: `${application.id}/${id}`,
      role,
      ...spec,
      start,
      end,
      cutLength,
      widthAxis: rotated,
      sectionRotation,
    });
    if (spec.stockLength !== undefined && cutLength > spec.stockLength + EPS)
      diagnostic(
        'stock-shortfall',
        `${application.id}/${id}: cut ${String(cutLength)} m exceeds stock ${String(spec.stockLength)} m`,
      );
    return true;
  };
  if (template.kind === 'area-members') {
    const origin = present(template.origin),
      angle = present(template.rotation),
      spacing = present(template.spacing);
    const c = Math.cos(angle),
      s = Math.sin(angle);
    const polygon = points.map((point) => ({
      x: (point.x - origin.x) * c + (point.y - origin.y) * s,
      y: -(point.x - origin.x) * s + (point.y - origin.y) * c,
    }));
    const first = Math.ceil(
      (Math.min(...polygon.map((point) => point.y)) - EPS) / spacing,
    );
    const last = Math.floor(
      (Math.max(...polygon.map((point) => point.y)) + EPS) / spacing,
    );
    if (
      !Number.isSafeInteger(first) ||
      !Number.isSafeInteger(last) ||
      last - first + 1 > maxElements
    ) {
      diagnostic(
        'generation-budget',
        'Parallel member rows exceed the finite generation budget',
      );
      return result;
    }
    const at = (x: number, y: number): Vec3 => ({
      x: origin.x + x * c - y * s,
      y: origin.y + x * s + y * c,
      z: (placement?.worldOffset.z ?? 0) + elevation,
    });
    for (let row = first; row <= last; row++) {
      const y = row * spacing;
      for (const [index, [a, b]] of rowSpans(polygon, y).entries())
        if (
          !emit(
            `row/${String(row)}/${String(index)}`,
            present(template.role),
            present(template.member),
            at(a, y),
            at(b, y),
            { x: -s, y: c, z: 0 },
          )
        )
          return result;
    }
    return result;
  }
  const segments = points.slice(1).map((end, index) => {
    const start = present(points[index]);
    const delta = subtract(end, start),
      length = Math.hypot(delta.x, delta.y);
    return {
      start,
      end,
      length,
      normal: { x: -delta.y / length, y: delta.x / length, z: 0 },
    };
  });
  if (!segments.length || segments.some((segment) => segment.length <= EPS)) {
    diagnostic(
      'invalid-path',
      'Material layout path must have nonzero segments',
    );
    return result;
  }
  const length = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (template.kind === 'path-surface') {
    if (template.height === undefined) {
      diagnostic('missing-height', 'Surface height is unresolved');
      return result;
    }
    const openings = template.openings ?? [];
    if (
      openings.some(
        (opening) => opening.distance + opening.width > length + EPS,
      )
    ) {
      diagnostic(
        'opening-outside-trace',
        'Surface opening exceeds the trace length; revise its location or width',
      );
      return result;
    }
    if (
      openings.some(
        (opening) =>
          opening.sill + opening.height > present(template.height) + EPS,
      )
    )
      diagnostic(
        'opening-above-surface',
        'Surface opening exceeds the finish height; its displayed intersection is provisional until the dimensions are confirmed',
      );
    const layers = present(template.layers),
      thickness =
        template.thickness === undefined
          ? undefined
          : template.thickness * layers;
    let station = 0;
    for (const [index, segment] of segments.entries()) {
      const low = station,
        high = station + segment.length;
      const xs = sorted([
        low,
        high,
        ...openings
          .flatMap((opening) => [
            opening.distance,
            opening.distance + opening.width,
          ])
          .filter((distance) => distance > low + EPS && distance < high - EPS),
      ]);
      const at = (distance: number, z: number) =>
        add(
          {
            x:
              segment.start.x +
              ((segment.end.x - segment.start.x) * (distance - low)) /
                segment.length,
            y:
              segment.start.y +
              ((segment.end.y - segment.start.y) * (distance - low)) /
                segment.length,
            z: segment.start.z + elevation + z,
          },
          segment.normal,
          (template.offset ?? 0) + (thickness ?? 0) / 2,
        );
      for (let part = 1; part < xs.length; part++) {
        const a = present(xs[part - 1]),
          b = present(xs[part]);
        const active = openings.filter(
          (opening) =>
            opening.distance < b - EPS &&
            opening.distance + opening.width > a + EPS,
        );
        for (const [band, [bottom, top]] of clearBands(
          template.height,
          active,
        ).entries()) {
          if (!room()) return result;
          const polygon = [
            at(a, bottom),
            at(b, bottom),
            at(b, top),
            at(a, top),
          ];
          const area = surfaceArea(polygon);
          result.surfaces.push({
            ...source,
            finishId: 'Wall finish',
            id: `${application.id}/surface/${String(index)}/${String(part)}/${String(band)}`,
            materialId: present(template.materialId),
            face: 'front',
            layers,
            points: polygon,
            geometricArea: area,
            area: area * layers,
            ...(thickness === undefined ? {} : { thickness }),
            wastePercent: template.wastePercent ?? 0,
            ...(template.packageSize === undefined
              ? {}
              : { packageSize: template.packageSize }),
          });
        }
      }
      station = high;
    }
  } else {
    const rise =
      (template.endElevation ?? template.elevation) - template.elevation;
    let station = 0;
    for (const [index, segment] of segments.entries()) {
      for (const component of present(template.components)) {
        const start = add(
          {
            ...segment.start,
            z:
              segment.start.z +
              elevation +
              (rise * station) / length +
              component.verticalOffset,
          },
          segment.normal,
          component.faceOffset,
        );
        const end = add(
          {
            ...segment.end,
            z:
              segment.end.z +
              elevation +
              (rise * (station + segment.length)) / length +
              component.verticalOffset,
          },
          segment.normal,
          component.faceOffset,
        );
        const direction = unit(subtract(end, start));
        if (
          !emit(
            `${component.id}/segment/${String(index)}`,
            component.role,
            component.member,
            add(start, direction, index === 0 ? -component.startExtension : 0),
            add(
              end,
              direction,
              index === segments.length - 1 ? component.endExtension : 0,
            ),
            segment.normal,
            component.sectionRotation ?? 0,
          )
        )
          return result;
      }
      station += segment.length;
    }
  }
  return result;
}

function present<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('Expected validated material layout value');
  return value;
}
