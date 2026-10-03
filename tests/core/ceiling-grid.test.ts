import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateCeilingGrid,
  type CeilingGridInput,
} from '../../src/core/ceiling-grid';
import { polygonArea, pointInPolygon } from '../../src/core/geometry';
import type { Point } from '../../src/core/types';
import { memberFaces, surfaceFaces } from '../../src/three/scene';

const ft = 0.3048;
const points = (values: [number, number][]): Point[] =>
  values.map(([x, y]) => ({ x: x * ft, y: y * ft }));

function fixture(width = 8, height = 8): CeilingGridInput {
  const spec = { width: 0.024, depth: 0.038 };
  return {
    id: 'ceiling',
    geometryId: 'room',
    boundary: points([
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ]),
    elevation: 9 * ft,
    system: '2x2',
    origin: { x: 0, y: 0 },
    rotation: 0,
    main: { ...spec, materialId: 'main', stockLength: 12 * ft },
    crossTee4: { ...spec, materialId: 'tee-4' },
    crossTee2: { ...spec, materialId: 'tee-2' },
    wallAngle: { ...spec, materialId: 'angle', stockLength: 12 * ft },
    tile: {
      materialId: 'tile',
      thickness: 0.016,
      wastePercent: 10,
      packageSize: 64 * ft ** 2,
    },
  };
}

function close(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < 1e-7,
    `${String(actual)} != ${String(expected)}`,
  );
}

function checked(input: CeilingGridInput) {
  const result = generateCeilingGrid(input);
  assert.equal(result.complete, true, JSON.stringify(result.diagnostics));
  for (const piece of result.pieces) {
    close(
      piece.cutLength,
      Math.hypot(
        piece.end.x - piece.start.x,
        piece.end.y - piece.start.y,
        piece.end.z - piece.start.z,
      ),
    );
    close(piece.start.z - piece.depth / 2, input.elevation);
    close(piece.end.z - piece.depth / 2, input.elevation);
    assert.ok(piece.cutLength > 0);
    assert.ok(
      piece.stockLength !== undefined &&
        piece.cutLength <= piece.stockLength + 1e-8,
    );
  }
  for (const surface of result.surfaces) {
    close(surface.area, polygonArea(surface.points));
    close(surface.area, surface.geometricArea);
    assert.ok(
      surface.points.every(
        (point) =>
          Math.abs(point.z - (surface.thickness ?? 0) / 2 - input.elevation) <
          1e-8,
      ),
    );
  }
  close(
    result.surfaces.reduce((sum, surface) => sum + surface.area, 0),
    polygonArea(input.boundary),
  );
  return result;
}

void test('2x2 grid emits independently countable members and 64 SF of actual tile footprints', () => {
  const result = checked(fixture());
  const count = (materialId: string) =>
    result.pieces.filter((piece) => piece.materialId === materialId).length;
  assert.equal(count('main'), 1);
  assert.equal(count('tee-4'), 6);
  assert.equal(count('tee-2'), 8);
  assert.equal(count('angle'), 4);
  assert.equal(result.surfaces.length, 16);
  for (const surface of result.surfaces) close(surface.area / ft ** 2, 4);
  close(
    result.pieces.find((piece) => piece.materialId === 'main')?.cutLength ?? 0,
    8 * ft,
  );
  assert.deepEqual(generateCeilingGrid(fixture()), result);
});

void test('2x4 grid changes actual tile footprints and omits 2 ft cross tees', () => {
  const input = fixture();
  input.system = '2x4';
  delete input.crossTee2;
  const result = checked(input);
  assert.equal(result.surfaces.length, 8);
  assert.equal(
    result.pieces.filter((piece) => piece.materialId === 'tee-4').length,
    6,
  );
  assert.equal(
    result.pieces.filter((piece) => piece.role === 'ceiling-tee-2ft').length,
    0,
  );
  for (const surface of result.surfaces) close(surface.area / ft ** 2, 8);
});

void test('ceiling elevation is the rendered finished underside for different member depths and tile thicknesses', () => {
  const input = fixture();
  input.main.depth = 0.08;
  input.crossTee4.depth = 0.06;
  assert.ok(input.crossTee2);
  input.crossTee2.depth = 0.03;
  input.wallAngle.depth = 0.02;
  const result = checked(input);
  for (const piece of result.pieces) {
    const vertices = memberFaces({
      ...piece,
      geometryId: input.geometryId,
    }).flatMap((face) => face.points);
    close(Math.min(...vertices.map((point) => point.z)), input.elevation);
    close(
      Math.max(...vertices.map((point) => point.z)),
      input.elevation + piece.depth,
    );
  }
  for (const surface of result.surfaces) {
    const vertices = surfaceFaces({
      ...surface,
      geometryId: input.geometryId,
      role: 'ceiling',
    }).flatMap((face) => face.points);
    close(Math.min(...vertices.map((point) => point.z)), input.elevation);
    close(
      Math.max(...vertices.map((point) => point.z)),
      input.elevation + (input.tile.thickness ?? 0),
    );
  }
  const measuredOnly = checked({
    ...input,
    tile: { materialId: 'unknown-thickness-tile' },
  });
  for (const surface of measuredOnly.surfaces) {
    assert.equal(surface.thickness, undefined);
    assert.ok(surface.points.every((point) => point.z === input.elevation));
  }
});

void test('border tiles and cross tees clip to the room, rather than keeping area-factor counts', () => {
  const result = checked(fixture(5, 7));
  assert.equal(result.surfaces.length, 12);
  const fourFoot = result.pieces.filter(
    (piece) => piece.materialId === 'tee-4',
  );
  const twoFoot = result.pieces.filter((piece) => piece.materialId === 'tee-2');
  assert.equal(fourFoot.length, 4);
  assert.equal(twoFoot.length, 6);
  assert.deepEqual(
    fourFoot.map((piece) => Math.round(piece.cutLength / ft)).sort(),
    [3, 3, 4, 4],
  );
  assert.deepEqual(
    twoFoot.map((piece) => Math.round(piece.cutLength / ft)).sort(),
    [1, 1, 2, 2, 2, 2],
  );
  close(
    result.surfaces.reduce((sum, surface) => sum + surface.area, 0),
    35 * ft ** 2,
  );
});

void test('mains and wall angle are segmented into explicit stock-limited pieces', () => {
  const result = checked(fixture(26, 8));
  assert.deepEqual(
    result.pieces
      .filter((piece) => piece.materialId === 'main')
      .map((piece) => Math.round(piece.cutLength / ft)),
    [12, 12, 2],
  );
  const angles = result.pieces.filter((piece) => piece.materialId === 'angle');
  assert.equal(angles.length, 8);
  close(
    angles.reduce((sum, piece) => sum + piece.cutLength, 0),
    68 * ft,
  );
});

void test('concave boundaries do not create members or tiles across an excluded corner', () => {
  const input = fixture();
  input.boundary = points([
    [0, 0],
    [8, 0],
    [8, 4],
    [4, 4],
    [4, 8],
    [0, 8],
  ]);
  const result = checked(input);
  assert.equal(result.surfaces.length, 12);
  assert.equal(
    result.pieces.filter((piece) => piece.materialId === 'tee-4').length,
    4,
  );
  assert.equal(
    result.pieces.filter((piece) => piece.materialId === 'tee-2').length,
    6,
  );
  close(
    result.pieces
      .filter((piece) => piece.materialId === 'main')
      .reduce((sum, piece) => sum + piece.cutLength, 0),
    4 * ft,
  );
  for (const piece of result.pieces)
    assert.ok(
      pointInPolygon(
        {
          x: (piece.start.x + piece.end.x) / 2,
          y: (piece.start.y + piece.end.y) / 2,
        },
        input.boundary,
      ),
    );
});

void test('a notch can split one tile cell into separate material patches without bridging the gap', () => {
  const input = fixture(2, 4);
  input.boundary = points([
    [0, 0],
    [2, 0],
    [2, 4],
    [1.25, 4],
    [1.25, 1],
    [0.75, 1],
    [0.75, 4],
    [0, 4],
  ]);
  const result = checked(input);
  const upperCell = result.surfaces.filter((surface) =>
    surface.id.includes('/tile/0/1/'),
  );
  assert.equal(upperCell.length, 2);
  for (const surface of upperCell) {
    assert.ok(
      surface.points.every((point) => point.x <= 0.75 * ft + 1e-8) ||
        surface.points.every((point) => point.x >= 1.25 * ft - 1e-8),
    );
    close(surface.area, 1.5 * ft ** 2);
  }
});

void test('rotation and translated grid origin preserve exact quantities and move generated geometry', () => {
  const original = fixture(5, 7);
  const expected = checked(original);
  const rotation = Math.PI / 5;
  const origin = { x: -10, y: 20 };
  const transform = (point: Point) => ({
    x: origin.x + point.x * Math.cos(rotation) - point.y * Math.sin(rotation),
    y: origin.y + point.x * Math.sin(rotation) + point.y * Math.cos(rotation),
  });
  const input = {
    ...original,
    rotation,
    origin,
    boundary: original.boundary.map(transform),
    elevation: 11 * ft,
  };
  const result = checked(input);
  assert.equal(result.pieces.length, expected.pieces.length);
  assert.equal(result.surfaces.length, expected.surfaces.length);
  for (const [index, piece] of result.pieces.entries())
    close(piece.cutLength, expected.pieces[index]?.cutLength ?? 0);
  const reverse = checked({
    ...input,
    boundary: [...input.boundary].reverse(),
  });
  close(
    reverse.surfaces.reduce((sum, surface) => sum + surface.area, 0),
    35 * ft ** 2,
  );
  assert.equal(reverse.pieces.length, result.pieces.length);
});

void test('grid origin changes border cuts and quantities while preserving room area', () => {
  const input = fixture();
  input.origin = { x: ft, y: ft };
  const result = checked(input);
  assert.equal(
    result.pieces.filter((piece) => piece.materialId === 'main').length,
    2,
  );
  assert.equal(
    result.pieces.filter((piece) => piece.materialId === 'tee-4').length,
    12,
  );
  assert.equal(result.surfaces.length, 25);
});

void test('diagonal boundary clips polygons and grid lengths without rectangular fill', () => {
  const input = fixture();
  input.boundary = points([
    [0, 0],
    [8, 0],
    [0, 8],
  ]);
  const result = checked(input);
  close(
    result.surfaces.reduce((sum, surface) => sum + surface.area, 0),
    32 * ft ** 2,
  );
  assert.ok(result.surfaces.some((surface) => surface.points.length === 3));
});

void test('missing specifications and invalid boundaries do not invent geometry', () => {
  const missing = fixture();
  delete missing.crossTee2;
  for (const input of [
    missing,
    { ...fixture(), main: { ...fixture().main, width: 0 } },
    {
      ...fixture(),
      boundary: points([
        [0, 0],
        [8, 8],
        [8, 0],
        [0, 8],
      ]),
    },
  ]) {
    const result = generateCeilingGrid(input);
    assert.equal(result.complete, false);
    assert.equal(result.pieces.length, 0);
    assert.equal(result.surfaces.length, 0);
    assert.equal(result.diagnostics[0]?.code, 'invalid-ceiling-grid');
  }
});

void test('generation limit reports incomplete instead of silently presenting a complete ceiling', () => {
  const result = generateCeilingGrid({ ...fixture(), maxElements: 10 });
  assert.equal(result.complete, false);
  assert.ok(result.pieces.length + result.surfaces.length <= 10);
  assert.equal(result.diagnostics[0]?.code, 'generation-budget');
});
