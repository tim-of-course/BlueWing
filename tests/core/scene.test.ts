import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildConstructionScene,
  constructionSceneInput,
  defaultCamera,
  memberFaces,
  orbitCamera,
  pickConstruction,
  projectConstruction,
  projectPoint,
  zoomCamera,
} from '../../src/three/scene';
import type {
  SceneMember,
  SceneSurface,
  ProjectedScene,
} from '../../src/three/scene';
import type { ConstructionResult } from '../../src/core/construction-types';

const member: SceneMember = {
  id: 'stud-1',
  geometryId: 'path-1',
  wallId: 'wall-1',
  openingId: 'door-1',
  materialId: 'steel',
  role: 'jamb',
  start: { x: 0, y: 0, z: 0 },
  end: { x: 0, y: 0, z: 3 },
  width: 0.05,
  depth: 0.1,
};

void test('projection uses elevation Z, preserves orthographic lengths, and orbit/zoom remain bounded', () => {
  const camera = { yaw: 0, pitch: 0, zoom: 1 };
  assert.deepEqual(projectPoint({ x: 4, y: 2, z: 3 }, camera), {
    x: 2,
    y: -3,
    depth: 4,
  });
  assert.equal(projectPoint({ x: 100, y: 2, z: 3 }, camera).x, 2);
  assert.equal(orbitCamera(camera, 0, 1e6).pitch, 1.45);
  assert.equal(zoomCamera(camera, 1e6).zoom, 15);
  assert.equal(zoomCamera(camera, 0).zoom, 0.15);
});

void test('member bounds include physical section dimensions and rotated section', () => {
  const scene = buildConstructionScene({ members: [member], surfaces: [] });
  assert.equal(memberFaces(member).length, 6);
  assert.deepEqual(scene.bounds, {
    min: { x: -0.025, y: -0.05, z: 0 },
    max: { x: 0.025, y: 0.05, z: 3 },
  });
  const rotated = buildConstructionScene({
    members: [{ ...member, sectionRotation: Math.PI / 2 }],
    surfaces: [],
  });
  assert.ok(Math.abs(rotated.bounds.max.x - 0.05) < 1e-10);
  assert.ok(Math.abs(rotated.bounds.max.y - 0.025) < 1e-10);
  const projected = projectConstruction(scene, 600, 400, defaultCamera);
  for (const face of projected.faces)
    for (const point of face.points) {
      assert.ok(point.x > 0 && point.x < 600 && point.y > 0 && point.y < 400);
    }
});

void test('picking returns nearest face with original source IDs and misses outside the model', () => {
  const far = {
    ...member,
    id: 'far',
    start: { x: -2, y: 0, z: 0 },
    end: { x: -2, y: 0, z: 3 },
  };
  const scene = projectConstruction(
    buildConstructionScene({ members: [member, far], surfaces: [] }),
    500,
    500,
    { yaw: 0, pitch: 0, zoom: 1 },
  );
  const picked = pickConstruction(scene, 250, 250);
  assert.equal(picked?.id, member.id);
  assert.equal(picked.geometryId, 'path-1');
  assert.equal(picked.openingId, 'door-1');
  assert.equal(pickConstruction(scene, 0, 0), null);
});

void test('filters precede object cap and surfaces retain source and measured dimensions', () => {
  const result: ConstructionResult = {
    pieces: [{ ...member, cutLength: 3, stockLength: 3.6, sectionRotation: 0 }],
    surfaces: [
      {
        id: 'ceiling',
        geometryId: 'room',
        materialId: 'tile',
        face: 'ceiling',
        points: [
          { x: 0, y: 0, z: 3 },
          { x: 4, y: 0, z: 3 },
          { x: 4, y: 4, z: 3 },
          { x: 0, y: 4, z: 3 },
        ],
        layers: 1,
        geometricArea: 16,
        area: 16,
      },
    ],
    purchases: [],
    diagnostics: [],
    complete: true,
  };
  const input = constructionSceneInput(result);
  const capped = buildConstructionScene(input, {}, 1);
  assert.equal(capped.count, 1);
  assert.equal(capped.omitted, 1);
  const filtered = buildConstructionScene(
    input,
    { materialId: 'tile', role: 'ceiling', geometryIds: ['room'] },
    1,
  );
  assert.equal(filtered.count, 1);
  assert.equal(filtered.omitted, 0);
  assert.equal(filtered.faces[0]?.source.geometryId, 'room');
  assert.deepEqual(filtered.bounds.max, { x: 4, y: 4, z: 3 });
  assert.equal(buildConstructionScene(input, { geometryIds: [] }).count, 0);
  assert.equal(result.pieces[0]?.stockLength, 3.6);
  result.pieces.push({
    ...member,
    cutLength: 4,
    sectionRotation: 0,
    id: 'track',
    role: 'bottom-track',
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0, y: 4, z: 0 },
  });
  const aligned = constructionSceneInput(result).members[0];
  assert.deepEqual(aligned?.widthAxis, { x: 0, y: 1, z: 0 });
});

void test('multilayer finishes use total thickness centred on their generated plane', () => {
  const result: ConstructionResult = {
    pieces: [],
    purchases: [],
    diagnostics: [],
    complete: true,
    surfaces: [
      {
        id: 'finish',
        geometryId: 'wall',
        materialId: 'gypsum',
        face: 'front',
        layers: 2,
        thickness: 0.0254,
        area: 24,
        geometricArea: 12,
        points: [
          { x: 0, y: 0.0627, z: 0 },
          { x: 4, y: 0.0627, z: 0 },
          { x: 4, y: 0.0627, z: 3 },
          { x: 0, y: 0.0627, z: 3 },
        ],
      },
    ],
  };
  const original = structuredClone(result);
  const scene = buildConstructionScene(constructionSceneInput(result));
  assert.equal(scene.count, 1);
  assert.equal(scene.faces.length, 6);
  assert.ok(Math.abs(scene.bounds.min.y - 0.05) < 1e-10);
  assert.ok(Math.abs(scene.bounds.max.y - 0.0754) < 1e-10);
  assert.deepEqual(result, original);
});

void test('finish thickness follows the geometric normal after rotation or reflection', () => {
  const surface: SceneSurface = {
    id: 'finish',
    geometryId: 'wall',
    materialId: 'gypsum',
    role: 'finish',
    thickness: 0.2,
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 4, z: 0 },
      { x: 3, y: 4, z: 2 },
      { x: 0, y: 0, z: 2 },
    ],
  };
  for (const reflect of [1, -1]) {
    const transformed = {
      ...surface,
      points: surface.points.map((p) => ({ ...p, x: p.x * reflect })),
    };
    const scene = buildConstructionScene({
      members: [],
      surfaces: [transformed],
    });
    assert.ok(Math.abs(scene.bounds.min.y + 0.06) < 1e-10);
    assert.ok(Math.abs(scene.bounds.max.y - 4.06) < 1e-10);
    assert.ok(
      Math.abs(scene.bounds.min.x - (reflect === 1 ? -0.08 : -3.08)) < 1e-10,
    );
    assert.ok(
      Math.abs(scene.bounds.max.x - (reflect === 1 ? 3.08 : 0.08)) < 1e-10,
    );
    assert.equal(scene.bounds.min.z, 0);
    assert.equal(scene.bounds.max.z, 2);
  }
  const flat = buildConstructionScene({
    members: [],
    surfaces: [{ ...surface, thickness: 0 }],
  });
  assert.equal(flat.faces.length, 1);
});

void test('explicit generated width axis is already rotated, including reflected placements', () => {
  for (const direction of [1, -1]) {
    const result: ConstructionResult = {
      pieces: [
        {
          ...member,
          widthAxis: { x: 0, y: direction, z: 0 },
          sectionRotation: Math.PI / 2,
          cutLength: 3,
        },
      ],
      surfaces: [],
      purchases: [],
      diagnostics: [],
      complete: true,
    };
    const scene = buildConstructionScene(constructionSceneInput(result));
    assert.equal(scene.bounds.max.x, 0.05);
    assert.equal(scene.bounds.max.y, 0.025);
  }
});

void test('level isolation intersects source, material and role filters before the cap', () => {
  const input = {
    members: [
      { ...member, id: 'other-level', geometryId: 'other' },
      { ...member, id: 'other-material', materialId: 'wood' },
      { ...member, id: 'other-role', role: 'stud' },
      member,
      { ...member, id: 'second-jamb' },
    ],
    surfaces: [],
  };
  const filter = {
    levelGeometryIds: ['path-1'],
    geometryIds: ['path-1', 'other'],
    materialId: 'steel',
    role: 'jamb',
  };
  const scene = buildConstructionScene(input, filter, 1);
  assert.equal(scene.count, 1);
  assert.equal(scene.omitted, 1);
  assert.equal(scene.faces[0]?.source.id, member.id);
  assert.equal(
    buildConstructionScene(input, { ...filter, levelGeometryIds: [] }).count,
    0,
  );
  assert.equal(
    buildConstructionScene(input, { ...filter, geometryIds: ['other'] }).count,
    0,
  );
});

void test('picking compares depth at the click and keeps framing selectable through finishes', () => {
  const sloping = { ...member, id: 'sloping' },
    flat = { ...member, id: 'flat' },
    finish = { ...member, id: 'finish' };
  const points = (left: number, right: number) => [
    { x: 0, y: 0, depth: left },
    { x: 10, y: 0, depth: right },
    { x: 10, y: 10, depth: right },
    { x: 0, y: 10, depth: left },
  ];
  const scene: ProjectedScene = {
    width: 10,
    height: 10,
    scale: 1,
    faces: [
      {
        source: sloping,
        points: points(0, 10),
        surface: false,
        depth: 5,
        light: 70,
      },
      {
        source: flat,
        points: points(6, 6),
        surface: false,
        depth: 6,
        light: 70,
      },
      {
        source: finish,
        points: points(12, 12),
        surface: true,
        depth: 12,
        light: 70,
      },
    ],
  };
  assert.equal(pickConstruction(scene, 9, 5)?.id, 'sloping');
  assert.equal(pickConstruction(scene, 1, 5)?.id, 'flat');
  assert.equal(
    pickConstruction(
      { ...scene, faces: scene.faces.filter((face) => face.surface) },
      1,
      5,
    )?.id,
    'finish',
  );
});
