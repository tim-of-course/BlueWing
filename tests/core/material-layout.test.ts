import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import {
  generateMaterialLayout,
  materialFieldsSchema,
  validateMaterialTemplate,
} from '../../src/core/material-layout';
import type { MaterialTemplate } from '../../src/core/material-layout';
import type {
  HeaderComponent,
  MemberSpec,
} from '../../src/core/construction-types';
import type { Point } from '../../src/core/types';
import { constructionSceneInput, memberFrame } from '../../src/three/scene';
import {
  summarizeMaterials,
  surfaceArea,
} from '../../src/core/material-results';

const member: MemberSpec = {
  materialId: 'specified-member',
  width: 0.04,
  depth: 0.09,
};
const component = (values: Partial<HeaderComponent> = {}): HeaderComponent => ({
  id: 'component',
  role: 'brace',
  member,
  startExtension: 0,
  endExtension: 0,
  verticalOffset: 0,
  faceOffset: 0,
  ...values,
});
function fixture(
  template: MaterialTemplate,
  points: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
  ],
) {
  const project = createProject('Material layout', 'p');
  project.sheets.plan = {
    id: 'plan',
    name: 'Plan',
    assetId: 'pdf',
    pageIndex: 0,
    width: 100,
    height: 100,
    calibration: { metresPerUnit: 1 },
  };
  project.geometries.trace = {
    id: 'trace',
    sheetId: 'plan',
    name: 'Trace',
    kind: template.kind === 'area-members' ? 'area' : 'path',
    points: points.map((point) => ({ x: point.x, y: -point.y })),
  };
  const context = { levels: {}, placements: {} };
  const application = {
    id: 'layout',
    geometryId: 'trace',
    assignmentId: 'assignment',
    recipeId: 'recipe',
    groupId: 'group',
    template,
  };
  return { project, application, context };
}
function close(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < 1e-8,
    `${String(actual)} != ${String(expected)}`,
  );
}
function present<T>(value: T | undefined): T {
  assert.notEqual(value, undefined);
  return value as T;
}

void test('standalone finish subtracts the union of located openings before layers, with no framing', () => {
  const template: MaterialTemplate = {
    kind: 'path-surface',
    elevation: 1,
    height: 3,
    materialId: 'frp',
    layers: 2,
    thickness: 0.01,
    offset: 0.2,
    packageSize: 10,
    openings: [
      { id: 'left', distance: 2, width: 3, sill: 0, height: 2 },
      { id: 'right', distance: 4, width: 2, sill: 1, height: 2 },
    ],
  };
  const { project, application, context } = fixture(template);
  const before = JSON.stringify({ project, application, context });
  const result = generateMaterialLayout(project, application, context);
  assert.equal(result.complete, true);
  assert.equal(result.pieces.length, 0);
  // 30 m² wall less 6 + 4 - 1 m² overlapping openings, then two layers.
  close(
    result.surfaces.reduce((sum, surface) => sum + surface.area, 0),
    42,
  );
  for (const surface of result.surfaces) {
    close(surface.area, surfaceArea(surface.points) * 2);
    close(present(surface.thickness), 0.02);
    assert.equal(surface.assignmentId, 'assignment');
    assert.equal(surface.finishId, 'Wall finish');
    assert.equal('template' in surface, false);
    for (const point of surface.points) close(point.y, 0.21);
  }
  summarizeMaterials(result);
  assert.equal(result.surfacePurchases?.length, 1);
  close(present(result.surfacePurchases[0]).requiredArea, 42);
  close(present(result.surfacePurchases[0]).purchasedArea, 50);
  assert.equal(JSON.stringify({ project, application, context }), before);
});

void test('sloped members use true-axis extensions and rotated sections in the model and cuts', () => {
  const { project, application, context } = fixture(
    {
      kind: 'path-members',
      elevation: 0,
      endElevation: 4,
      components: [
        component({
          startExtension: 0.5,
          endExtension: 0.5,
          sectionRotation: Math.PI / 3,
          member: { ...member, stockLength: 5 },
        }),
      ],
    },
    [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ],
  );
  const result = generateMaterialLayout(project, application, context);
  assert.equal(result.pieces.length, 1);
  const piece = present(result.pieces[0]);
  close(piece.cutLength, 6);
  close(piece.start.x, -0.3);
  close(piece.start.z, -0.4);
  close(piece.end.x, 3.3);
  close(piece.end.z, 4.4);
  assert.equal(result.complete, false);
  assert.equal(result.diagnostics[0]?.code, 'stock-shortfall');
  const axis = present(piece.widthAxis);
  close(
    axis.x * (piece.end.x - piece.start.x) +
      axis.y * (piece.end.y - piece.start.y) +
      axis.z * (piece.end.z - piece.start.z),
    0,
  );
  const sceneMember = present(constructionSceneInput(result).members[0]);
  close(memberFrame(sceneMember).length, 6);
  close(Math.hypot(axis.x, axis.y, axis.z), 1);
  summarizeMaterials(result);
  assert.equal(result.purchases[0]?.requiredCount, 1);
  close(piece.cutLength, 6);
});

void test('header components keep explicit offsets and extend only outer ends of a bent trace', () => {
  const { project, application, context } = fixture(
    {
      kind: 'path-members',
      elevation: 2,
      components: [
        component({
          startExtension: 0.2,
          endExtension: 0.3,
          verticalOffset: 0.1,
          faceOffset: 0.05,
        }),
      ],
    },
    [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ],
  );
  const result = generateMaterialLayout(project, application, context);
  assert.equal(result.complete, true);
  assert.equal(result.pieces.length, 2);
  close(present(result.pieces[0]).cutLength, 2.2);
  close(present(result.pieces[1]).cutLength, 2.3);
  close(present(result.pieces[0]).start.z, 2.1);
  close(present(result.pieces[0]).start.y, 0.05);
  close(present(result.pieces[1]).start.x, 1.95);
});

void test('parallel members clip to disjoint spans of a concave area and include boundary rows', () => {
  const { project, application, context } = fixture(
    {
      kind: 'area-members',
      elevation: 3,
      spacing: 3,
      origin: { x: 0, y: 0 },
      rotation: 0,
      member,
      role: 'joist',
    },
    [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 4 },
      { x: 0, y: 4 },
    ],
  );
  const result = generateMaterialLayout(project, application, context);
  assert.equal(result.complete, true);
  assert.deepEqual(
    result.pieces.map((piece) => piece.cutLength),
    [6, 2, 2],
  );
  assert.deepEqual(
    result.pieces.map((piece) => [piece.start.x, piece.end.x, piece.start.y]),
    [
      [0, 6, 0],
      [0, 2, 3],
      [4, 6, 3],
    ],
  );
  assert.ok(
    result.pieces.every((piece) => piece.start.z === 3 && piece.end.z === 3),
  );
  assert.equal(result.surfaces.length, 0);
});

void test('rotation, calibration, sheet placement and level determine material positions', () => {
  const { project, application } = fixture(
    {
      kind: 'path-surface',
      elevation: 0.5,
      height: 2,
      materialId: 'acoustic-panel',
      layers: 1,
    },
    [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ],
  );
  present(project.sheets.plan).calibration = { metresPerUnit: 0.5 };
  const context = {
    levels: { floor: { id: 'floor', name: 'Floor', elevation: 4 } },
    placements: {
      plan: {
        id: 'plan',
        sheetId: 'plan',
        pageOrigin: { x: 0, y: 0 },
        worldOffset: { x: 10, y: 20, z: 3 },
        rotation: Math.PI / 2,
      },
    },
  };
  const result = generateMaterialLayout(
    project,
    { ...application, levelId: 'floor' },
    context,
  );
  const surface = present(result.surfaces[0]);
  close(surface.area, 2);
  close(present(surface.points[0]).x, 10);
  close(present(surface.points[0]).y, 20);
  close(present(surface.points[0]).z, 7.5);
  close(present(surface.points[1]).y, 21);
  close(present(surface.points[2]).z, 9.5);

  const area = fixture(
    {
      kind: 'area-members',
      elevation: 0,
      spacing: 2,
      origin: { x: 0, y: 0 },
      rotation: Math.PI / 2,
      member,
      role: 'joist',
    },
    [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ],
  );
  const rotated = generateMaterialLayout(
    area.project,
    area.application,
    area.context,
  );
  assert.equal(rotated.pieces.length, 3);
  for (const piece of rotated.pieces) {
    close(piece.start.x, piece.end.x);
    close(piece.cutLength, 4);
  }
});

void test('rotated concave boundaries retain the same joist cuts and bounded generation', () => {
  const angle = Math.PI / 5;
  const origin = { x: 11, y: -7 };
  const outline = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 4 },
    { x: 0, y: 4 },
  ].map((point) => ({
    x: origin.x + point.x * Math.cos(angle) - point.y * Math.sin(angle),
    y: origin.y + point.x * Math.sin(angle) + point.y * Math.cos(angle),
  }));
  const { project, application, context } = fixture(
    {
      kind: 'area-members',
      elevation: 3,
      spacing: 3,
      origin,
      rotation: angle,
      member,
      role: 'joist',
    },
    outline,
  );
  const result = generateMaterialLayout(project, application, context);
  assert.equal(result.complete, true);
  assert.equal(result.pieces.length, 3);
  result.pieces.forEach((piece, index) => {
    close(piece.cutLength, index === 0 ? 6 : 2);
    const direction = {
      x: piece.end.x - piece.start.x,
      y: piece.end.y - piece.start.y,
    };
    close(direction.x / piece.cutLength, Math.cos(angle));
    close(direction.y / piece.cutLength, Math.sin(angle));
  });
  application.template.spacing = 0.001;
  const limited = generateMaterialLayout(project, application, context, 20);
  assert.equal(limited.complete, false);
  assert.equal(limited.pieces.length, 0);
  assert.equal(limited.diagnostics[0]?.code, 'generation-budget');

  const manyMembers = fixture({
    kind: 'path-members',
    elevation: 0,
    components: Array.from({ length: 5 }, (_, index) =>
      component({ id: `piece-${String(index)}`, faceOffset: index * 0.1 }),
    ),
  });
  const stopped = generateMaterialLayout(
    manyMembers.project,
    manyMembers.application,
    manyMembers.context,
    2,
  );
  assert.equal(stopped.pieces.length, 2);
  assert.equal(stopped.complete, false);
  assert.equal(stopped.diagnostics[0]?.code, 'generation-budget');
});

void test('missing dimensions, misplaced openings and generation limits remain visible', () => {
  const { project, application, context } = fixture({
    kind: 'path-surface',
    elevation: 0,
    materialId: 'board',
    layers: 1,
  });
  assert.equal(
    generateMaterialLayout(project, application, context).diagnostics[0]?.code,
    'missing-height',
  );
  application.template.height = 3;
  application.template.openings = [
    { id: 'door', distance: 9, width: 2, sill: 0, height: 2 },
  ];
  assert.equal(
    generateMaterialLayout(project, application, context).diagnostics[0]?.code,
    'opening-outside-trace',
  );
  application.template.openings = [
    { id: 'door', distance: 0, width: 2, sill: 2, height: 2 },
  ];
  const above = generateMaterialLayout(project, application, context);
  assert.equal(above.diagnostics[0]?.code, 'opening-above-surface');
  close(
    above.surfaces.reduce((sum, surface) => sum + surface.area, 0),
    28,
  );
  application.template.openings = [];
  const limited = generateMaterialLayout(project, application, context, 0);
  assert.equal(limited.complete, false);
  assert.equal(limited.surfaces.length, 0);
  assert.equal(limited.diagnostics[0]?.code, 'generation-budget');
  delete present(project.sheets.plan).calibration;
  assert.equal(
    generateMaterialLayout(project, application, context).diagnostics[0]?.code,
    'missing-calibration',
  );
});

void test('template validation rejects settings ignored by the selected kind and keeps kind immutable in overrides', () => {
  const surface: MaterialTemplate = {
    kind: 'path-surface',
    elevation: 0,
    height: 2,
    materialId: 'board',
    layers: 1,
  };
  validateMaterialTemplate(surface);
  assert.throws(() => {
    validateMaterialTemplate({ ...surface, spacing: 0.4 });
  }, /not used/);
  assert.throws(() => {
    validateMaterialTemplate({ ...surface, layers: 1.5 });
  }, /whole number/);
  assert.throws(() => {
    validateMaterialTemplate({
      kind: 'path-members',
      elevation: 0,
      components: [],
    });
  }, /components are required/);
  const overrides = materialFieldsSchema('path-surface', true);
  assert.equal(overrides.properties?.kind, undefined);
  assert.ok(overrides.properties?.levelId);
  assert.equal(overrides.properties.components, undefined);
  assert.equal(overrides.properties.height?.nullable, true);
  assert.notEqual(overrides.properties.materialId?.nullable, true);
});
