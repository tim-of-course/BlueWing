import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildConstructionScene,
  constructionSceneInput,
  defaultCamera,
  fitCamera,
  memberFaces,
  orbitCamera,
  surfaceFaces,
  zoomCamera,
} from '../../src/three/scene';
import type { SceneMember, SceneSurface } from '../../src/three/scene';
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

void test('camera fit targets physical bounds and navigation preserves that target', () => {
  const scene = buildConstructionScene({ members: [member], surfaces: [] });
  const camera = fitCamera(scene, { ...defaultCamera, zoom: 8 });
  assert.deepEqual(camera.target, { x: 0, y: 0, z: 1.5 });
  assert.equal(camera.zoom, 1);
  assert.ok(camera.span > 3);
  assert.equal(orbitCamera(camera, 0, 1e6).pitch, Math.PI / 2);
  assert.equal(orbitCamera(camera, 0, -1e6).pitch, -Math.PI / 2);
  assert.deepEqual(orbitCamera(camera, 100, 100).target, camera.target);
  assert.deepEqual(zoomCamera(camera, 2).target, camera.target);
  assert.equal(zoomCamera(camera, 2).zoom, 2);
  assert.equal(zoomCamera(camera, 1e6).zoom, 10_000);
  assert.equal(zoomCamera(camera, 0).zoom, 0.01);
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
  assert.equal(filtered.surfaces[0]?.geometryId, 'room');
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
  const finish = scene.surfaces[0];
  assert.ok(finish);
  assert.equal(surfaceFaces(finish).length, 6);
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
  const flatFinish = flat.surfaces[0];
  assert.ok(flatFinish);
  assert.equal(surfaceFaces(flatFinish).length, 1);
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
  assert.equal(scene.members[0]?.id, member.id);
  assert.equal(
    buildConstructionScene(input, { ...filter, levelGeometryIds: [] }).count,
    0,
  );
  assert.equal(
    buildConstructionScene(input, { ...filter, geometryIds: ['other'] }).count,
    0,
  );
});

void test('all calculated members reach the scene unless an explicit limit is requested', () => {
  const input = {
    members: Array.from({ length: 6_000 }, (_, index) => ({
      ...member,
      id: `stud-${String(index)}`,
      start: { x: index, y: 0, z: 0 },
      end: { x: index, y: 0, z: 3 },
    })),
    surfaces: [],
  };
  const scene = buildConstructionScene(input);
  assert.equal(scene.count, 6_000);
  assert.equal(scene.members.length, 6_000);
  assert.equal(scene.omitted, 0);
  assert.equal(scene.members.at(-1)?.id, 'stud-5999');
  assert.equal(scene.bounds.max.x, 5_999.025);
  const limited = buildConstructionScene(input, {}, 12);
  assert.equal(limited.members.length, 12);
  assert.equal(limited.omitted, 5_988);
});
