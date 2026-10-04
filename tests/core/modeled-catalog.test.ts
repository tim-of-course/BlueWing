import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import {
  executeCommand,
  validateAssembly,
  validateProject,
} from '../../src/core/commands';
import { calculateProject } from '../../src/core/calculations';
import { starterAssemblies } from '../../src/core/assemblies';
import { constructionSceneInput } from '../../src/three/scene';
import { ProjectSession } from '../../src/core/session';
import { inspectReview } from '../../src/core/review';
import { generateConstruction } from '../../src/core/construction';
import { resolveConstruction } from '../../src/core/applied-assemblies';
import { modeledOutputs } from '../../src/core/material-results';
import type {
  CalculationResult,
  GeometryKind,
  Project,
} from '../../src/core/types';

const ft = 0.3048;
const surfaceStarters = [
  'drywall-wall-surface',
  'frp-wall',
  'acoustical-wall-surface',
  'plywood-backing',
  'plywood-wall-surface',
  'gypsum-sheathing-wall',
  'cement-board-wall',
];

function near(actual: number | undefined, expected: number) {
  assert.ok(
    actual !== undefined && Math.abs(actual - expected) < 1e-7,
    `${String(actual)} != ${String(expected)}`,
  );
}

function command(project: Project, name: string, payload: unknown) {
  return executeCommand(project, { name, payload }).project;
}

function fixture(id: string, kind: GeometryKind = 'path', length = 24) {
  let project = createProject('Modeled catalog examples');
  project.sheets.s = {
    id: 's',
    name: 'A1',
    assetId: 'pdf',
    pageIndex: 0,
    width: 100,
    height: 100,
    calibration: { metresPerUnit: ft },
  };
  project.geometries.trace = {
    id: 'trace',
    name: 'Measured scope',
    sheetId: 's',
    kind,
    points:
      kind === 'area'
        ? [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
            { x: 8, y: 8 },
            { x: 0, y: 8 },
          ]
        : [
            { x: 0, y: 0 },
            { x: length, y: 0 },
          ],
  };
  const recipe = starterAssemblies()[id];
  assert.ok(recipe, `Missing starter: ${id}`);
  project = command(project, 'assembly.put', recipe);
  project = command(project, 'group.put', {
    id: 'g',
    name: 'Work',
    geometryIds: ['trace'],
  });
  return command(project, 'assignment.put', {
    id: 'a',
    groupId: 'g',
    recipeId: id,
    inputs: {},
    allowances: {},
  });
}

function applied(project: Project) {
  const assignment = project.assignments.a;
  assert.ok(assignment);
  return assignment;
}

function linked(result: CalculationResult) {
  assert.equal(result.complete, true, JSON.stringify(result.model.diagnostics));
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.estimateOutputs, 0);
  const sources = result.outputs.flatMap((output) => output.sources);
  assert.equal(
    sources.length,
    result.model.pieces.length + result.model.surfaces.length,
  );
  const scene = constructionSceneInput(result.model);
  assert.deepEqual(
    scene.members.map((piece) => piece.id),
    result.model.pieces.map((piece) => piece.id),
  );
  assert.deepEqual(
    scene.surfaces.map((surface) => surface.id),
    result.model.surfaces.map((surface) => surface.id),
  );
  for (const piece of result.model.pieces) {
    const matching = sources.filter((source) => source.pieceId === piece.id);
    assert.equal(matching.length, 1, piece.id);
    assert.equal(matching[0]?.value, 1);
    near(
      matching[0].cutLength?.value,
      Math.hypot(
        piece.end.x - piece.start.x,
        piece.end.y - piece.start.y,
        piece.end.z - piece.start.z,
      ),
    );
  }
  for (const surface of result.model.surfaces) {
    const matching = sources.filter(
      (source) => source.surfaceId === surface.id,
    );
    assert.equal(matching.length, 1, surface.id);
    near(matching[0]?.value ?? undefined, surface.area / ft ** 2);
  }
}

void test('new finish starters model measured surfaces and positioned deductions without invented framing', () => {
  for (const id of surfaceStarters) {
    let project = fixture(id);
    project = command(project, 'assignment.put', {
      ...applied(project),
      materialOverrides: {
        height: 8 * ft,
        elevation: 2 * ft,
        layers: 1,
        openings: [
          {
            id: 'door',
            distance: 8 * ft,
            width: 3 * ft,
            sill: 0,
            height: 7 * ft,
          },
        ],
      },
    });
    const result = calculateProject(project);
    linked(result);
    assert.equal(result.model.pieces.length, 0, id);
    assert.ok(result.model.surfaces.length > 0, id);
    near(
      result.outputs.reduce((sum, output) => sum + output.baseAmount, 0),
      171,
    );
    assert.ok(
      result.model.surfaces.every((surface) =>
        surface.points.every(
          (point) => point.z >= 2 * ft - 1e-9 && point.z <= 10 * ft + 1e-9,
        ),
      ),
    );
  }
});

void test('finish assignment defaults, local heights and live project edits have explicit precedence', () => {
  let project = fixture('frp-wall');
  const trace = project.geometries.trace;
  assert.ok(trace);
  project = command(project, 'geometry.put', {
    ...trace,
    id: 'second',
    name: 'Second run',
    points: [
      { x: 0, y: 10 },
      { x: 24, y: 10 },
    ],
  });
  project = command(project, 'group.put', {
    id: 'g',
    name: 'Work',
    geometryIds: ['trace', 'second'],
  });
  project = command(project, 'assignment.put', {
    ...applied(project),
    materialOverrides: { height: 9 * ft },
    geometryDetails: { second: { material: { height: 10 * ft } } },
  });
  const definition = structuredClone(project.recipes['frp-wall']);
  assert.ok(definition?.materialTemplate?.kind === 'path-surface');
  definition.materialTemplate.height = 12 * ft;
  definition.materialTemplate.materialId = 'specified-frp-product';
  project = command(project, 'assembly.put', definition);
  const result = calculateProject(project);
  linked(result);
  near(
    result.outputs.reduce((sum, output) => sum + output.baseAmount, 0),
    456,
  );
  assert.ok(
    result.model.surfaces.every(
      (surface) => surface.materialId === 'specified-frp-product',
    ),
  );
  project = command(project, 'assignment.put', {
    ...applied(project),
    materialOverrides: {},
    geometryDetails: {},
  });
  near(
    calculateProject(project).outputs.reduce(
      (sum, output) => sum + output.baseAmount,
      0,
    ),
    576,
  );
  validateProject(JSON.parse(JSON.stringify(project)));
});

void test('surface purchases round after traces and waste while visible material stays at installed area', () => {
  let project = fixture('drywall-wall-surface', 'path', 5);
  const trace = project.geometries.trace;
  assert.ok(trace);
  project = command(project, 'geometry.put', {
    ...trace,
    id: 'second',
    name: 'Second run',
  });
  project = command(project, 'group.put', {
    id: 'g',
    name: 'Work',
    geometryIds: ['trace', 'second'],
  });
  project = command(project, 'assignment.put', {
    ...applied(project),
    materialOverrides: {
      height: 6 * ft,
      layers: 1,
      wastePercent: 10,
      packageSize: 32 * ft ** 2,
    },
  });
  const result = calculateProject(project);
  linked(result);
  assert.equal(result.outputs.length, 1);
  near(result.outputs[0]?.baseAmount, 60);
  assert.equal(result.outputs[0]?.packageCount, 3);
  near(result.outputs[0].purchasedAmount, 96);
  near(
    result.model.surfaces.reduce((sum, surface) => sum + surface.area, 0),
    60 * ft ** 2,
  );
});

void test('joist layout and sloped kick quantities use the lengths of their displayed members', () => {
  let joists = fixture('steel-joists', 'area');
  joists = command(joists, 'assignment.put', {
    ...applied(joists),
    materialOverrides: { spacing: 2 * ft, origin: { x: 0, y: 0 }, rotation: 0 },
  });
  const layout = calculateProject(joists);
  linked(layout);
  assert.equal(layout.model.pieces.length, 5);
  assert.equal(layout.model.surfaces.length, 0);
  for (const piece of layout.model.pieces) near(piece.cutLength, 8 * ft);

  let kick = fixture('steel-kick', 'path', 3);
  kick = command(kick, 'assignment.put', {
    ...applied(kick),
    materialOverrides: { elevation: 8 * ft, endElevation: 12 * ft },
  });
  const brace = calculateProject(kick);
  linked(brace);
  assert.equal(brace.model.pieces.length, 1);
  near(brace.model.pieces[0]?.cutLength, 5 * ft);
  near(brace.model.pieces[0]?.start.z, 8 * ft);
  near(brace.model.pieces[0]?.end.z, 12 * ft);
});

void test('track joints and individual blocking segments preserve specified stock without silent splices', () => {
  let project = fixture('steel-track-run');
  const trace = project.geometries.trace;
  assert.ok(trace);
  project = command(project, 'geometry.put', {
    ...trace,
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 24, y: 0 },
    ],
  });
  const track = calculateProject(project);
  linked(track);
  assert.equal(track.model.pieces.length, 3);
  assert.deepEqual(
    track.model.pieces.map((piece) => Math.round(piece.cutLength / ft)),
    [10, 10, 4],
  );
  for (const piece of track.model.pieces) near(piece.stockLength, 10 * ft);
  const block = calculateProject(fixture('wood-blocking', 'path', 2));
  linked(block);
  assert.equal(block.model.pieces.length, 1);
  near(block.model.pieces[0]?.cutLength, 2 * ft);
  near(block.model.pieces[0]?.stockLength, 8 * ft);
  const tooLong = calculateProject(fixture('wood-blocking', 'path', 10));
  assert.equal(tooLong.complete, false);
  assert.equal(tooLong.model.pieces.length, 1);
  near(tooLong.model.pieces[0]?.cutLength, 10 * ft);
  assert.ok(
    tooLong.model.diagnostics.some((diagnostic) =>
      /stock/i.test(diagnostic.message),
    ),
  );
});

void test('box header components can be traced or copied to an opening without duplicate contributions', () => {
  const standalone = calculateProject(fixture('steel-box-header', 'path', 6));
  linked(standalone);
  assert.equal(standalone.model.pieces.length, 4);
  for (const piece of standalone.model.pieces) near(piece.cutLength, 6 * ft);

  let project = fixture('steel-framing');
  project = command(project, 'assignment.put', {
    ...applied(project),
    wallOverrides: { height: 8 * ft },
  });
  const headerAssembly = starterAssemblies()['steel-box-header'];
  assert.ok(headerAssembly?.materialTemplate);
  project = command(project, 'assembly.put', headerAssembly);
  project = command(project, 'header.fromAssembly', {
    assemblyId: headerAssembly.id,
    id: 'door-header',
    name: 'Project door detail',
  });
  project = command(project, 'opening.put', {
    id: 'door',
    wallId: 'a/trace',
    distance: 8 * ft,
    width: 3 * ft,
    sill: 0,
    height: 7 * ft,
    jambCount: 1,
    headerId: 'door-header',
  });
  const installed = calculateProject(project);
  linked(installed);
  const headers = installed.model.pieces.filter((piece) =>
    piece.role.startsWith('header-'),
  );
  assert.equal(headers.length, 4);
  for (const piece of headers) near(piece.cutLength, 3 * ft);
  assert.equal(Object.keys(project.assignments).length, 1);
  assert.equal(installed.model.surfaces.length, 0);

  const components = headerAssembly.materialTemplate.components;
  assert.ok(components?.[0]);
  components[0].member.materialId = 'later-library-example';
  project = command(project, 'assembly.put', headerAssembly);
  const copied = project.construction?.headers['door-header'];
  assert.ok(copied);
  assert.ok(
    copied.components.every(
      (component) => component.member.materialId !== 'later-library-example',
    ),
  );
  assert.deepEqual(
    calculateProject(project).model.pieces.filter((piece) =>
      piece.role.startsWith('header-'),
    ),
    headers,
  );
});

void test('horizontal finishes report their measured surfaces and furring reports its parallel members', () => {
  for (const id of [
    'drywall-ceiling',
    'plywood-deck',
    'acoustical-ceiling-tile',
  ]) {
    const result = calculateProject(fixture(id, 'area'));
    linked(result);
    assert.equal(result.model.pieces.length, 0);
    near(
      result.outputs.reduce((sum, output) => sum + output.baseAmount, 0),
      64,
    );
  }
  const furring = calculateProject(fixture('steel-furring', 'area'));
  linked(furring);
  assert.equal(furring.model.pieces.length, 5);
  assert.equal(furring.model.surfaces.length, 0);
  for (const piece of furring.model.pieces) near(piece.cutLength, 8 * ft);
});

void test('missing required finish dimensions are unresolved and incompatible overrides are rejected', () => {
  let project = fixture('frp-wall');
  const definition = structuredClone(project.recipes['frp-wall']);
  assert.ok(definition?.materialTemplate?.kind === 'path-surface');
  delete definition.materialTemplate.height;
  project = command(project, 'assembly.put', definition);
  const missing = calculateProject(project);
  assert.equal(missing.complete, false);
  assert.equal(missing.coverage.complete, false);
  assert.equal(missing.model.surfaces.length, 0);
  assert.ok(missing.outputs.some((output) => output.modeling === 'unresolved'));
  assert.throws(() =>
    command(project, 'assignment.put', {
      ...applied(project),
      materialOverrides: { height: -1 },
    }),
  );
  assert.throws(() =>
    command(project, 'assignment.put', {
      ...applied(project),
      materialOverrides: { spacing: 1 },
    }),
  );
  assert.throws(() =>
    command(project, 'assignment.put', {
      ...applied(project),
      wallOverrides: { height: 1 },
    }),
  );
  assert.throws(() => {
    validateAssembly({ ...definition, geometryKinds: ['area'] });
  });
});

void test('material override validation does not depend on a compatible trace already belonging to the group', () => {
  const empty = command(fixture('frp-wall'), 'group.members', {
    id: 'g',
    geometryIds: [],
  });
  assert.throws(() =>
    command(empty, 'assignment.put', {
      ...applied(empty),
      materialOverrides: { spacing: 1 },
    }),
  );
  assert.throws(() =>
    command(empty, 'assignment.put', {
      ...applied(empty),
      materialOverrides: { levelId: 'missing' },
    }),
  );
  const incompatible = fixture('frp-wall', 'area');
  assert.throws(() =>
    command(incompatible, 'assignment.put', {
      ...applied(incompatible),
      geometryDetails: { trace: { material: { spacing: 1 } } },
    }),
  );
});

void test('copying and deleting a traced finish preserves independent applications and undo restores its deductions', async () => {
  let project = fixture('frp-wall');
  project = command(project, 'assignment.put', {
    ...applied(project),
    materialOverrides: { height: 8 * ft },
    geometryDetails: {
      trace: {
        material: {
          openings: [
            {
              id: 'door',
              distance: 8 * ft,
              width: 3 * ft,
              sill: 0,
              height: 7 * ft,
            },
          ],
        },
      },
    },
  });
  const copiedGroup = command(project, 'group.copy', {
    id: 'g',
    newId: 'other-scope',
  });
  const duplicateScope = calculateProject(copiedGroup);
  linked(duplicateScope);
  near(
    duplicateScope.outputs.reduce((sum, output) => sum + output.baseAmount, 0),
    342,
  );
  assert.equal(
    new Set(duplicateScope.model.surfaces.map((surface) => surface.id)).size,
    duplicateScope.model.surfaces.length,
  );

  project = command(project, 'geometry.copy', {
    id: 'trace',
    newId: 'second',
    dx: 0,
    dy: 10,
  });
  const copied = calculateProject(project);
  linked(copied);
  assert.equal(Object.keys(project.assignments).length, 2);
  near(
    copied.outputs.reduce((sum, output) => sum + output.baseAmount, 0),
    342,
  );
  near(
    copied.model.surfaces
      .filter((surface) => surface.geometryId === 'second')
      .reduce((sum, surface) => sum + surface.area, 0),
    171 * ft ** 2,
  );

  const session = new ProjectSession(project, {
    save: () => Promise.resolve(),
  });
  await session.dispatch({
    name: 'geometry.delete',
    payload: { id: 'trace' },
    projectId: project.id,
    expectedRevision: 0,
  });
  assert.deepEqual(applied(session.project).geometryDetails, {});
  near(
    calculateProject(session.project).outputs.reduce(
      (sum, output) => sum + output.baseAmount,
      0,
    ),
    171,
  );
  await session.dispatch({
    name: 'history.undo',
    projectId: project.id,
    expectedRevision: 1,
  });
  linked(calculateProject(session.project));
  near(
    calculateProject(session.project).outputs.reduce(
      (sum, output) => sum + output.baseAmount,
      0,
    ),
    342,
  );
  assert.equal(
    applied(session.project).geometryDetails?.trace?.material?.openings?.[0]
      ?.id,
    'door',
  );
});

void test('level changes move finish geometry and invalidate its review without changing installed area', () => {
  let project = fixture('frp-wall');
  project = command(project, 'level.put', {
    id: 'floor',
    name: 'Floor',
    elevation: 10 * ft,
  });
  project = command(project, 'assignment.put', {
    ...applied(project),
    materialOverrides: { height: 8 * ft, elevation: 2 * ft, levelId: 'floor' },
  });
  project = command(project, 'review.mark', {
    id: 'checked',
    target: { kind: 'geometry', id: 'trace' },
    status: 'reviewed',
    note: '',
  });
  assert.equal(inspectReview(project).marks[0]?.effectiveStatus, 'reviewed');
  project = command(project, 'level.put', {
    id: 'unused',
    name: 'Unused level',
    elevation: 4 * ft,
  });
  assert.equal(inspectReview(project).marks[0]?.effectiveStatus, 'reviewed');
  project = command(project, 'level.put', {
    id: 'floor',
    name: 'Floor',
    elevation: 11 * ft,
  });
  assert.equal(inspectReview(project).marks[0]?.effectiveStatus, 'changed');
  const moved = calculateProject(project);
  linked(moved);
  near(
    Math.min(
      ...moved.model.surfaces.flatMap((surface) =>
        surface.points.map((point) => point.z),
      ),
    ),
    13 * ft,
  );
  near(moved.outputs[0]?.baseAmount, 192);
  assert.throws(() => command(project, 'level.delete', { id: 'floor' }));
});

void test('new member layouts and existing ceiling surfaces share one generation budget and report every retained record', () => {
  let project = fixture('steel-box-header', 'path', 6);
  const ceiling = fixture('drywall-ceiling', 'area');
  const area = ceiling.geometries.trace;
  const definition = ceiling.recipes['drywall-ceiling'];
  assert.ok(area && definition);
  project = command(project, 'geometry.put', { ...area, id: 'room' });
  project = command(project, 'assembly.put', definition);
  project = command(project, 'group.put', {
    id: 'ceiling',
    name: 'Ceiling',
    geometryIds: ['room'],
  });
  project = command(project, 'assignment.put', {
    id: 'finish',
    groupId: 'ceiling',
    recipeId: definition.id,
    inputs: {},
    allowances: {},
  });
  const model = generateConstruction(project, resolveConstruction(project), {
    maxPieces: 3,
  });
  assert.equal(model.complete, false);
  assert.equal(model.pieces.length + model.surfaces.length, 3);
  assert.ok(
    model.diagnostics.some(
      (diagnostic) => diagnostic.code === 'generation-budget',
    ),
  );
  const sources = modeledOutputs(project, model).flatMap(
    (output) => output.sources,
  );
  assert.equal(
    sources.filter((source) => source.pieceId || source.surfaceId).length,
    3,
  );
  for (const piece of model.pieces)
    assert.equal(
      sources.filter((source) => source.pieceId === piece.id).length,
      1,
    );
  for (const surface of model.surfaces)
    assert.equal(
      sources.filter((source) => source.surfaceId === surface.id).length,
      1,
    );
});
