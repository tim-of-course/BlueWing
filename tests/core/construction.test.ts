import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import {
  emptyConstruction,
  generateConstruction,
  validateConstruction,
} from '../../src/core/construction';
import type { MemberSpec, Opening } from '../../src/core/construction-types';
const ft = 0.3048;
const spec: MemberSpec = { materialId: 'stud-92', width: 0.04, depth: 0.092 };
function fixture(length = 24 * ft, height = 10 * ft) {
  const project = createProject('Construction', 'project');
  project.sheets.plan = {
    id: 'plan',
    name: 'Plan',
    assetId: 'pdf',
    pageIndex: 0,
    width: 100,
    height: 100,
    calibration: { metresPerUnit: 1 },
  };
  project.geometries.path = {
    id: 'path',
    name: 'Wall',
    sheetId: 'plan',
    kind: 'path',
    points: [
      { x: 0, y: 0 },
      { x: length, y: 0 },
    ],
  };
  const data = emptyConstruction();
  data.walls.wall = {
    id: 'wall',
    geometryId: 'path',
    baseElevation: 0,
    height,
    studSpacing: (16 / 12) * ft,
    stud: { ...spec },
    track: { ...spec, width: 0.092075, depth: 0.03175, materialId: 'track-92' },
    finishes: [{ id: 'front', face: 'front', materialId: 'board', layers: 2 }],
  };
  return { project, data, wall: data.walls.wall };
}
function close(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < 1e-7,
    `${String(actual)} != ${String(expected)}`,
  );
}
function opening(
  id: string,
  distance: number,
  width: number,
  sill: number,
  height: number,
): Opening {
  return {
    id,
    wallId: 'wall',
    distance,
    width,
    sill,
    height,
    jambCount: 1,
    headerId: 'header',
  };
}
function addHeader(data: ReturnType<typeof emptyConstruction>) {
  data.headers.header = {
    id: 'header',
    name: 'Project header',
    components: [
      {
        id: 'web',
        role: 'header-web',
        member: spec,
        startExtension: 0,
        endExtension: 0,
        verticalOffset: 0.046,
        faceOffset: 0,
      },
    ],
  };
}
void test('24 ft wall: 19 studs, exact endpoints, net face layers and deterministic derived data', () => {
  const { project, data, wall } = fixture();
  wall.bottomAllowance = (0.5 / 12) * ft;
  wall.stud.stockLength = 12 * ft;
  wall.stud.wastePercent = 10;
  wall.stud.packageSize = 20;
  const before = JSON.stringify(data);
  const result = generateConstruction(project, data);
  assert.equal(result.complete, true);
  const studs = result.pieces.filter((p) => p.role === 'stud');
  assert.equal(studs.length, 19);
  close(present(studs[18]).start.x, 24 * ft);
  close(present(studs[0]).cutLength, 10 * ft - 0.0127);
  close(
    result.surfaces.reduce((sum, s) => sum + s.area, 0),
    480 * ft ** 2,
  );
  assert.equal(
    present(result.purchases.find((p) => p.materialId === spec.materialId))
      .purchasedCount,
    40,
  );
  const studPurchase = present(
    result.purchases.find((p) => p.materialId === spec.materialId),
  );
  assert.equal(studPurchase.wastePercent, 10);
  close(studPurchase.adjustedCount, 20.9);
  assert.deepEqual(
    studPurchase.pieceIds,
    studs.map((piece) => piece.id),
  );
  assert.deepEqual(generateConstruction(project, data), result);
  assert.equal(JSON.stringify(data), before);
});
void test('metric station offset includes endpoints exactly once', () => {
  const { project, data, wall } = fixture(3, 2.4);
  wall.studSpacing = 1;
  wall.studOffset = 0.5;
  assert.deepEqual(
    generateConstruction(project, data)
      .pieces.filter((p) => p.role === 'stud')
      .map((p) => p.start.x),
    [0, 0.5, 1.5, 2.5, 3],
  );
});
void test('sloping and stepped wall cuts, top track lengths, and area', () => {
  const { project, data, wall } = fixture(4, 3);
  wall.studSpacing = 1;
  present(present(wall.finishes)[0]).layers = 1;
  wall.topProfile = {
    mode: 'linear',
    points: [
      { distance: 0, height: 2 },
      { distance: 4, height: 4 },
    ],
  };
  let result = generateConstruction(project, data);
  for (const [i, stud] of result.pieces
    .filter((p) => p.role === 'stud')
    .entries())
    close(stud.cutLength, 2 + i * 0.5);
  close(
    present(result.pieces.find((p) => p.role === 'top-track')).cutLength,
    Math.sqrt(20),
  );
  close(
    result.surfaces.reduce((n, s) => n + s.area, 0),
    12,
  );
  wall.topProfile = {
    mode: 'step',
    points: [
      { distance: 0, height: 2 },
      { distance: 2, height: 3 },
      { distance: 4, height: 3 },
    ],
  };
  result = generateConstruction(project, data);
  close(
    result.surfaces.reduce((n, s) => n + s.area, 0),
    10,
  );
  close(
    present(result.pieces.find((p) => p.role === 'step-track')).cutLength,
    1,
  );
});
void test('door and window clip ordinary studs, generate jambs/sills, split threshold track, and deduct face area', () => {
  const { project, data, wall } = fixture(8, 3);
  wall.studSpacing = 0.5;
  present(present(wall.finishes)[0]).layers = 1;
  addHeader(data);
  data.openings.door = opening('door', 1, 1, 0, 2);
  data.openings.window = opening('window', 4, 2, 1, 1);
  const result = generateConstruction(project, data);
  assert.equal(result.complete, true);
  close(
    result.surfaces.reduce((n, s) => n + s.area, 0),
    20,
  );
  close(
    result.pieces
      .filter((p) => p.role === 'bottom-track')
      .reduce((n, p) => n + p.cutLength, 0),
    7,
  );
  assert.equal(result.pieces.filter((p) => p.role === 'jamb').length, 4);
  close(present(result.pieces.find((p) => p.role === 'sill')).cutLength, 2);
  assert.deepEqual(
    result.pieces
      .filter((p) => p.role === 'cripple' && p.start.x === 4.5)
      .map((p) => [Number(p.start.z.toFixed(6)), p.end.z]),
    [
      [0, 1],
      [2.092, 3],
    ],
  );
  assert.deepEqual(
    result.pieces
      .filter((p) => p.role === 'cripple' && p.start.x === 1.5)
      .map((p) => [Number(p.start.z.toFixed(6)), p.end.z]),
    [[2.092, 3]],
  );
});
void test('slope clips opening deduction exactly at sill/head crossing', () => {
  const { project, data, wall } = fixture(4, 3);
  present(present(wall.finishes)[0]).layers = 1;
  wall.topProfile = {
    mode: 'linear',
    points: [
      { distance: 0, height: 1 },
      { distance: 4, height: 5 },
    ],
  };
  addHeader(data);
  data.openings.window = opening('window', 0, 4, 2, 2);
  const result = generateConstruction(project, data);
  // Gross trapezoid 12; removed triangle (2*2/2) plus rectangle (1*2) = 4.
  close(
    result.surfaces.reduce((n, s) => n + s.area, 0),
    8,
  );
  assert.ok(result.diagnostics.some((d) => d.code === 'opening-above-top'));
});
void test('header components preserve project section, face, vertical offsets, extensions and rotation', () => {
  const { project, data } = fixture(6, 3);
  addHeader(data);
  present(data.headers.header).components = [
    {
      id: 'front',
      role: 'box-face',
      member: spec,
      startExtension: 0.1,
      endExtension: 0.2,
      verticalOffset: 0.15,
      faceOffset: 0.05,
      sectionRotation: Math.PI / 2,
    },
    {
      id: 'back',
      role: 'box-face',
      member: spec,
      startExtension: 0.1,
      endExtension: 0.2,
      verticalOffset: 0.15,
      faceOffset: -0.05,
    },
  ];
  data.openings.door = opening('door', 1, 2, 0, 2);
  const headers = generateConstruction(project, data).pieces.filter(
    (p) => p.role === 'box-face',
  );
  assert.equal(headers.length, 2);
  close(present(headers[0]).cutLength, 2.3);
  close(present(headers[0]).start.x, 0.9);
  close(present(headers[0]).start.y, 0.05);
  close(present(headers[0]).start.z, 2.15);
  close(present(headers[0]).sectionRotation, Math.PI / 2);
});
void test('explicit corner count replaces regular endpoint', () => {
  const { project, data, wall } = fixture(4, 3);
  wall.studSpacing = 1;
  wall.conditions = [
    {
      id: 'corner',
      kind: 'corner',
      distance: 0,
      count: 2,
      memberOffsets: [
        { along: 0, face: 0 },
        { along: 0, face: 0.04 },
      ],
    },
  ];
  const result = generateConstruction(project, data);
  assert.equal(result.pieces.filter((p) => p.role === 'corner').length, 2);
  assert.equal(result.pieces.filter((p) => p.role === 'stud').length, 4);
});
void test('placement and levels transform wall and ceiling consistently', () => {
  const { project, data, wall } = fixture(4, 3);
  data.levels.floor = { id: 'floor', name: 'Floor', elevation: 5 };
  wall.levelId = 'floor';
  wall.baseElevation = 0.2;
  data.placements.plan = {
    id: 'plan',
    sheetId: 'plan',
    pageOrigin: { x: 0, y: 0 },
    worldOffset: { x: 10, y: 20, z: 1 },
    rotation: Math.PI / 2,
  };
  project.geometries.room = {
    id: 'room',
    name: 'Room',
    sheetId: 'plan',
    kind: 'area',
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ],
  };
  data.ceilings.room = {
    id: 'room',
    geometryId: 'room',
    levelId: 'floor',
    elevation: 3,
    materialId: 'tile',
    layers: 1,
  };
  const result = generateConstruction(project, data);
  const first = present(result.pieces[0]);
  close(first.start.x, 10);
  close(first.start.y, 20);
  close(first.start.z, 6.2);
  const ceiling = present(result.surfaces.find((s) => s.face === 'ceiling'));
  close(ceiling.area, 12);
  close(present(ceiling.points[0]).z, 9);
});
void test('invalid numeric/overlap data throws; unresolved height, stock, and budget have diagnostics', () => {
  const { project, data, wall } = fixture();
  wall.studSpacing = NaN;
  assert.throws(() => {
    validateConstruction(project, data);
  });
  wall.studSpacing = 0.4;
  data.openings.a = opening('a', 1, 2, 0, 2);
  data.openings.b = opening('b', 2, 2, 1, 1);
  addHeader(data);
  assert.throws(() => {
    validateConstruction(project, data);
  }, /overlap/);
  data.openings = {};
  delete wall.height;
  assert.equal(
    present(generateConstruction(project, data).diagnostics[0]).code,
    'missing-height',
  );
  wall.height = 3;
  wall.stud.stockLength = 2;
  assert.ok(
    generateConstruction(project, data).diagnostics.some(
      (d) => d.code === 'stock-shortfall',
    ),
  );
  wall.studSpacing = 1e-12;
  const result = generateConstruction(project, data);
  assert.equal(result.pieces.length, 0);
  assert.equal(present(result.diagnostics[0]).code, 'generation-budget');
});
function present<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('Expected validated construction value');
  return value;
}

void test('rotated physical headers bound cripple cuts; sill channel envelopes permit nesting', () => {
  const { project, data, wall } = fixture(4, 3);
  wall.studSpacing = 0.5;
  wall.track.depth = 0.1;
  addHeader(data);
  const component = present(present(data.headers.header).components[0]);
  component.member = { ...spec, width: 0.4, depth: 0.2 };
  component.sectionRotation = Math.PI / 2;
  component.verticalOffset = 0.2;
  component.startExtension = 0.4;
  const window = opening('window', 0.8, 1.4, 1, 1);
  window.jambCount = 0;
  window.sillMember = { ...spec, depth: 0.2 };
  data.openings.window = window;
  let result = generateConstruction(project, data);
  const inside = result.pieces.filter(
    (p) => p.role === 'cripple' && p.start.x === 1,
  );
  assert.equal(inside.length, 2);
  close(present(inside[0]).start.z, 0);
  close(present(inside[0]).end.z, 1);
  const sill = present(result.pieces.find((p) => p.role === 'sill'));
  close(sill.start.z, 1);
  close(present(inside[1]).start.z, 2.4);
  close(present(inside[1]).end.z, 3);
  const extension = result.pieces.filter(
    (p) => p.role === 'cripple' && p.start.x === 0.5,
  );
  assert.equal(extension.length, 2);
  close(present(extension[0]).end.z, 2);
  close(present(extension[1]).start.z, 2.4);
  for (const piece of [...inside, ...extension])
    close(
      piece.cutLength,
      Math.hypot(
        piece.end.x - piece.start.x,
        piece.end.y - piece.start.y,
        piece.end.z - piece.start.z,
      ),
    );
  // A face-offset header that misses the stud must not shorten that stud.
  component.faceOffset = 0.5;
  result = generateConstruction(project, data);
  close(
    present(
      result.pieces.find(
        (p) => p.role === 'cripple' && p.start.x === 1 && p.start.z > 1,
      ),
    ).start.z,
    2,
  );
  assert.equal(
    result.pieces.filter((p) => p.role === 'stud' && p.start.x === 0.5).length,
    1,
  );
});

void test('calibration and path edits preserve authored dimensions and report stations needing repair', () => {
  const { project, data, wall } = fixture(4, 3);
  wall.topProfile = {
    mode: 'linear',
    points: [
      { distance: 0, height: 3 },
      { distance: 4, height: 3 },
    ],
  };
  addHeader(data);
  data.openings.door = opening('door', 3, 1, 0, 2);
  present(project.sheets.plan).calibration = { metresPerUnit: 0.5 };
  assert.doesNotThrow(() => {
    validateConstruction(project, data);
  });
  const result = generateConstruction(project, data);
  assert.equal(result.complete, false);
  assert.equal(result.pieces.length, 0);
  assert.equal(
    present(result.diagnostics[0]).code,
    'wall-stations-outside-profile',
  );
  assert.equal(data.openings.door.distance, 3);
  data.walls.duplicate = { ...wall, id: 'duplicate' };
  assert.throws(() => {
    validateConstruction(project, data);
  }, /one wall per geometry/);
});

void test('header physical top and opening bends remain unresolved even when rough head fits', () => {
  const { project, data } = fixture(4, 3);
  addHeader(data);
  present(present(data.headers.header).components[0]).verticalOffset = 0.15;
  data.openings.door = opening('door', 1, 2, 0, 2.9);
  let result = generateConstruction(project, data);
  assert.ok(result.diagnostics.some((d) => d.code === 'header-above-top'));
  assert.ok(!result.diagnostics.some((d) => d.code === 'opening-above-top'));
  present(project.geometries.path).points = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
  ];
  result = generateConstruction(project, data);
  assert.ok(result.diagnostics.some((d) => d.code === 'opening-crosses-bend'));
  assert.ok(
    result.diagnostics.some((d) => d.code === 'unresolved-track-joint'),
  );
});

void test('authored allowances alone determine vertical cuts', () => {
  const { project, data, wall } = fixture(4, 3);
  wall.bottomAllowance = 0.1;
  wall.topAllowance = 0.2;
  const stud = present(
    generateConstruction(project, data).pieces.find((p) => p.role === 'stud'),
  );
  close(stud.start.z, 0.1);
  close(stud.end.z, 2.8);
  close(stud.cutLength, 2.7);
  close(present(stud.widthAxis).x, 1);
});

void test('channel flange depth does not alter authored slope cuts or backing completeness', () => {
  const { project, data, wall } = fixture(4, 3);
  wall.studSpacing = 1;
  wall.bottomAllowance = 0.005;
  wall.topAllowance = 0.01;
  wall.topProfile = {
    mode: 'linear',
    points: [
      { distance: 0, height: 2 },
      { distance: 4, height: 4 },
    ],
  };
  wall.backing = [{ id: 'rail', height: 1, member: spec }];
  for (const flangeDepth of [0.03175, 0.1]) {
    wall.track.depth = flangeDepth;
    const result = generateConstruction(project, data);
    assert.equal(result.complete, true);
    const middle = present(
      result.pieces.find((p) => p.role === 'stud' && p.start.x === 2),
    );
    close(middle.start.z, 0.005);
    close(middle.end.z, 2.99);
    close(middle.cutLength, 2.985);
  }
});

void test('off-module opening jambs replace overlapping automatic studs and cripples', () => {
  const { project, data, wall } = fixture(6, 3);
  wall.studSpacing = 0.5;
  addHeader(data);
  data.openings.door = opening('door', 1.01, 2, 0, 2);
  const result = generateConstruction(project, data);
  const studs = result.pieces.filter((piece) => piece.role === 'stud');
  const cripples = result.pieces.filter((piece) => piece.role === 'cripple');
  const jambs = result.pieces.filter((piece) => piece.role === 'jamb');
  assert.equal(studs.length, 8);
  assert.equal(cripples.length, 3);
  assert.equal(jambs.length, 2);
  for (const regular of [...studs, ...cripples])
    for (const jamb of jambs)
      assert.ok(Math.abs(regular.start.x - jamb.start.x) >= spec.width - 1e-8);
  // An explicitly offset jamb on another face does not replace the stud line.
  data.openings.door.jambOffsets = [{ along: 0, face: 0.2 }];
  const offsetResult = generateConstruction(project, data);
  for (const station of [1, 3])
    assert.ok(
      offsetResult.pieces.some(
        (piece) =>
          (piece.role === 'stud' || piece.role === 'cripple') &&
          piece.start.x === station,
      ),
    );
});
void test('jambs preserve rough width and multiple offsets mirror into adjacent framing', () => {
  const { project, data } = fixture(5, 3);
  addHeader(data);
  const window = opening('window', 1, 2, 1, 1);
  data.openings.window = window;
  let result = generateConstruction(project, data);
  assert.equal(result.complete, true);
  let jambs = result.pieces.filter((p) => p.role === 'jamb');
  close(present(jambs[0]).start.x, 0.98);
  close(present(jambs[1]).start.x, 3.02);
  close(
    present(jambs[1]).start.x - 0.02 - (present(jambs[0]).start.x + 0.02),
    2,
  );
  const sill = present(result.pieces.find((p) => p.role === 'sill'));
  close(sill.start.x, 1);
  close(sill.end.x, 3);
  close(sill.cutLength, 2);
  window.jambCount = 2;
  window.jambOffsets = [
    { along: 0, face: 0 },
    { along: 0.04, face: 0 },
  ];
  result = generateConstruction(project, data);
  assert.equal(result.complete, true);
  jambs = result.pieces.filter((p) => p.role === 'jamb');
  for (const [i, expected] of [0.98, 0.94, 3.02, 3.06].entries()) {
    close(present(jambs[i]).start.x, expected);
    close(present(jambs[i]).cutLength, 3);
  }
  present(window.jambOffsets[1]).along = -0.01;
  assert.ok(
    generateConstruction(project, data).diagnostics.some(
      (d) => d.code === 'jamb-in-opening',
    ),
  );
});

void test('whole purchases do not round floating-point waste noise into an extra piece or package', () => {
  const { project, data, wall } = fixture(99, 3);
  wall.studSpacing = 1;
  wall.stud.stockLength = 3;
  wall.stud.wastePercent = 10;
  let purchase = present(
    generateConstruction(project, data).purchases.find(
      (p) => p.materialId === spec.materialId,
    ),
  );
  assert.equal(purchase.requiredCount, 100);
  assert.equal(purchase.purchasedCount, 110);
  wall.stud.packageSize = 10;
  purchase = present(
    generateConstruction(project, data).purchases.find(
      (p) => p.materialId === spec.materialId,
    ),
  );
  assert.equal(purchase.packageCount, 11);
  assert.equal(purchase.purchasedCount, 110);
});

void test('shared junction has one owner; mismatched locations remain incomplete', () => {
  const { project, data, wall } = fixture(4, 3);
  wall.studSpacing = 1;
  wall.conditions = [
    {
      id: 'junction',
      distance: 4,
      kind: 'junction',
      count: 1,
      ownerWallId: 'wall',
    },
  ];
  project.geometries.branch = {
    id: 'branch',
    name: 'Branch',
    sheetId: 'plan',
    kind: 'path',
    points: [
      { x: 4, y: 0 },
      { x: 4, y: 3 },
    ],
  };
  data.walls.branch = {
    ...wall,
    id: 'branch',
    geometryId: 'branch',
    conditions: [
      {
        id: 'junction',
        distance: 0,
        kind: 'junction',
        count: 1,
        ownerWallId: 'wall',
      },
    ],
    finishes: [],
  };
  let result = generateConstruction(project, data);
  assert.equal(result.complete, true);
  assert.equal(result.pieces.filter((p) => p.role === 'junction').length, 1);
  assert.equal(
    result.pieces.filter((p) => p.role === 'stud' && p.wallId === 'branch')
      .length,
    3,
  );
  present(data.walls.branch).stud = {
    ...spec,
    materialId: 'different-section',
  };
  assert.ok(
    generateConstruction(project, data).diagnostics.some(
      (d) => d.code === 'shared-member-mismatch',
    ),
  );
  present(data.walls.branch).stud = { ...spec };
  present(project.geometries.branch).points[0] = { x: 5, y: 0 };
  result = generateConstruction(project, data);
  assert.ok(
    result.diagnostics.some((d) => d.code === 'shared-member-mismatch'),
  );
});

void test('bent wall surfaces remain planar and backing is clipped around openings and sloping top', () => {
  const { project, data, wall } = fixture(4, 3);
  present(project.geometries.path).points = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
  ];
  present(present(wall.finishes)[0]).layers = 1;
  wall.backing = [{ id: 'rail', height: 1.5, member: spec }];
  wall.topProfile = {
    mode: 'linear',
    points: [
      { distance: 0, height: 1 },
      { distance: 4, height: 3 },
    ],
  };
  addHeader(data);
  data.openings.door = opening('door', 2.5, 0.5, 0, 2);
  const result = generateConstruction(project, data);
  // Rail starts at station 1 (height crosses 1.5), ends at 4, less half-metre door.
  close(
    result.pieces
      .filter((p) => p.role === 'backing')
      .reduce((n, p) => n + p.cutLength, 0),
    2.5,
  );
  close(
    result.surfaces.reduce((n, s) => n + s.area, 0),
    7,
  );
  for (const surface of result.surfaces) {
    const [a, b, c, d] = surface.points.map((p) => p);
    assert.ok(a && b && c && d);
    const bottomLength = Math.hypot(b.x - a.x, b.y - a.y);
    close(
      (bottomLength * (d.z - a.z + (c.z - b.z))) / 2,
      surface.geometricArea,
    );
  }
});

void test('multiple members require explicit offsets; offset members use local slope height', () => {
  const { project, data, wall } = fixture(4, 3);
  wall.topProfile = {
    mode: 'linear',
    points: [
      { distance: 0, height: 2 },
      { distance: 4, height: 4 },
    ],
  };
  wall.conditions = [{ id: 'corner', kind: 'corner', distance: 0, count: 2 }];
  assert.ok(
    generateConstruction(project, data).diagnostics.some(
      (d) => d.code === 'missing-member-offsets',
    ),
  );
  present(wall.conditions[0]).memberOffsets = [
    { along: 0, face: 0 },
    { along: 0.1, face: 0.04 },
  ];
  const pieces = generateConstruction(project, data).pieces.filter(
    (p) => p.role === 'corner',
  );
  close(present(pieces[1]).cutLength, 2.05);
  close(present(present(pieces[1]).widthAxis).x, 1);
});

void test('partial-height finishes deduct only covered openings, apply layers and round packages once', () => {
  const { project, data, wall } = fixture(8, 3);
  const finish = present(present(wall.finishes)[0]);
  finish.height = 1.2;
  finish.thickness = 0.01;
  finish.deduction = 0.5;
  finish.wastePercent = 10;
  finish.packageSize = 3;
  addHeader(data);
  data.openings.door = opening('door', 1, 1, 0, 2);
  data.openings.window = opening('window', 4, 2, 1, 1);
  const result = generateConstruction(project, data);
  assert.equal(result.complete, true);
  // 8*1.2 - 1*1.2 - 2*0.2 = 8 m²; (8 - .5)*2 = 15 m².
  close(
    result.surfaces.reduce((sum, surface) => sum + surface.geometricArea, 0),
    8,
  );
  close(
    result.surfaces.reduce((sum, surface) => sum + surface.area, 0),
    15,
  );
  const purchase = present(present(result.surfacePurchases)[0]);
  close(purchase.requiredArea, 15);
  close(purchase.purchasedArea, 18);
  assert.equal(purchase.packageCount, 6);
  for (const surface of result.surfaces) {
    close(present(surface.thickness), 0.02);
    assert.equal(surface.finishId, 'front');
    assert.equal(surface.quantityMode, 'included');
    assert.ok(surface.points.every((p) => p.z <= 1.2 + 1e-8));
    close(present(surface.points[0]).y, 0.056);
  }
  finish.deduction = 9;
  assert.ok(
    generateConstruction(project, data).diagnostics.some(
      (d) => d.code === 'excess-finish-deduction',
    ),
  );
  finish.height = NaN;
  assert.throws(() => {
    validateConstruction(project, data);
  });
});

void test('wainscot height crossing a slope integrates the clipped trapezoid', () => {
  const { project, data, wall } = fixture(4, 3);
  wall.topProfile = {
    mode: 'linear',
    points: [
      { distance: 0, height: 1 },
      { distance: 4, height: 5 },
    ],
  };
  const finish = present(present(wall.finishes)[0]);
  finish.height = 2;
  finish.layers = 1;
  const result = generateConstruction(project, data);
  // First metre is a 1-to-2 m trapezoid; remaining three metres are 2 m high.
  close(
    result.surfaces.reduce((sum, surface) => sum + surface.area, 0),
    7.5,
  );
});

void test('tracks split at stock length, including sloped tracks, within configured generation limit', () => {
  const { project, data, wall } = fixture(4, 3);
  wall.studSpacing = 1;
  wall.track.stockLength = 2;
  wall.topProfile = {
    mode: 'linear',
    points: [
      { distance: 0, height: 2 },
      { distance: 4, height: 4 },
    ],
  };
  const result = generateConstruction(project, data);
  assert.equal(result.complete, true);
  const top = result.pieces.filter((p) => p.role === 'top-track');
  assert.equal(top.length, 3);
  close(present(top[0]).cutLength, 2);
  close(present(top[1]).cutLength, 2);
  close(present(top[2]).cutLength, Math.sqrt(20) - 4);
  assert.deepEqual(present(top[0]).end, present(top[1]).start);
  assert.equal(
    result.pieces.filter((p) => p.role === 'bottom-track').length,
    2,
  );
  assert.equal(
    result.purchases.find((p) => p.materialId === wall.track.materialId)
      ?.requiredCount,
    5,
  );
  const limited = generateConstruction(project, data, { maxPieces: 5 });
  assert.ok(limited.pieces.length + limited.surfaces.length <= 5);
  assert.ok(
    limited.diagnostics.some(
      (d) => d.code === 'generation-budget' && d.wallId === wall.id,
    ),
  );
  assert.throws(() => {
    generateConstruction(project, data, { maxPieces: Infinity });
  });
});

void test('ceiling surfaces default to reference and only explicitly included ceilings add area purchasing', () => {
  const { project, data } = fixture();
  data.walls = {};
  project.geometries.room = {
    id: 'room',
    name: 'Room',
    sheetId: 'plan',
    kind: 'area',
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ],
  };
  data.ceilings.room = {
    id: 'room',
    geometryId: 'room',
    elevation: 3,
    materialId: 'tile',
    layers: 1,
  };
  const reference = generateConstruction(project, data);
  assert.equal(present(reference.surfaces[0]).quantityMode, 'reference');
  close(present(reference.surfaces[0]).geometricArea, 12);
  assert.equal(present(reference.surfacePurchases).length, 0);
  data.ceilings.room.quantityMode = 'included';
  const included = generateConstruction(project, data);
  close(present(present(included.surfacePurchases)[0]).purchasedArea, 12);
});

void test('purchase provenance separates identical material and stock with different allowances', () => {
  const { project, data, wall } = fixture(4, 3);
  wall.stud.stockLength = 4;
  wall.stud.wastePercent = 10;
  wall.track = { ...wall.stud, wastePercent: 0 };
  const result = generateConstruction(project, data);
  const purchases = result.purchases.filter(
    (p) => p.materialId === spec.materialId,
  );
  assert.equal(purchases.length, 2);
  const ids = purchases.flatMap((p) => p.pieceIds);
  assert.equal(new Set(ids).size, result.pieces.length);
  for (const purchase of purchases) {
    assert.equal(purchase.requiredCount, purchase.pieceIds.length);
    close(
      purchase.adjustedCount,
      purchase.requiredCount * (1 + purchase.wastePercent / 100),
    );
    for (const id of purchase.pieceIds) {
      const piece = present(result.pieces.find((p) => p.id === id));
      assert.equal(piece.role === 'stud', purchase.wastePercent === 10);
    }
  }
});
