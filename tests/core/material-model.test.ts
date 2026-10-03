import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import { calculateProject } from '../../src/core/calculations';
import { executeCommand } from '../../src/core/commands';
import { starterAssemblies } from '../../src/core/assemblies';
import {
  materialSettings,
  resolveConstruction,
} from '../../src/core/applied-assemblies';
import { constructionSceneInput } from '../../src/three/scene';
import type {
  CalculationResult,
  CommandCall,
  GeometryKind,
  Project,
  Recipe,
} from '../../src/core/types';

const ft = 0.3048;

function near(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < 1e-7,
    `${String(actual)} != ${String(expected)}`,
  );
}

function command(
  project: Project,
  name: string,
  payload: CommandCall['payload'],
) {
  return executeCommand(project, { name, payload }).project;
}

function starter(id: string): Recipe {
  const recipe = starterAssemblies()[id];
  assert.ok(recipe);
  return recipe;
}

function fixture(recipe: Recipe, kind: GeometryKind = 'path') {
  let project = createProject(
    'Unified material calculation',
    'material-project',
  );
  project.sheets.plan = {
    id: 'plan',
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
    sheetId: 'plan',
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
            { x: 24, y: 0 },
          ],
  };
  project = command(project, 'assembly.put', recipe);
  project = command(project, 'group.put', {
    id: 'scope',
    name: 'Work',
    geometryIds: ['trace'],
  });
  return command(project, 'assignment.put', {
    id: 'applied',
    groupId: 'scope',
    recipeId: recipe.id,
    inputs: {},
    allowances: {},
  });
}

function wall(height = 10) {
  const recipe = starter('steel-wall');
  assert.ok(recipe.wallTemplate);
  recipe.wallTemplate.height = height * ft;
  return recipe;
}

/** Verify the report and renderer consume the same individual generated records. */
function linked(result: CalculationResult) {
  assert.equal(result.complete, true, JSON.stringify(result.model.diagnostics));
  const scene = constructionSceneInput(result.model);
  assert.deepEqual(
    scene.members.map((piece) => piece.id),
    result.model.pieces.map((piece) => piece.id),
  );
  assert.deepEqual(
    scene.surfaces.map((surface) => surface.id),
    result.model.surfaces.map((surface) => surface.id),
  );
  const pieceSources = result.outputs
    .flatMap((output) => output.sources)
    .filter((source) => source.pieceId);
  const surfaceSources = result.outputs
    .flatMap((output) => output.sources)
    .filter((source) => source.surfaceId);
  assert.equal(pieceSources.length, result.model.pieces.length);
  assert.equal(surfaceSources.length, result.model.surfaces.length);
  for (const piece of result.model.pieces) {
    const source = pieceSources.find((source) => source.pieceId === piece.id);
    assert.ok(source);
    assert.equal(source.value, 1);
    near(
      source.cutLength?.value ?? NaN,
      Math.hypot(
        piece.end.x - piece.start.x,
        piece.end.y - piece.start.y,
        piece.end.z - piece.start.z,
      ),
    );
    const rendered = scene.members.find((member) => member.id === piece.id);
    assert.deepEqual(rendered?.start, piece.start);
    assert.deepEqual(rendered.end, piece.end);
  }
  for (const surface of result.model.surfaces) {
    near(surface.area, surface.geometricArea * surface.layers);
    const source = surfaceSources.find(
      (source) => source.surfaceId === surface.id,
    );
    assert.ok(source);
    near(source.value ?? NaN, surface.area / ft ** 2);
    assert.deepEqual(
      scene.surfaces.find((item) => item.id === surface.id)?.points,
      surface.points,
    );
  }
  for (const output of result.outputs) {
    assert.equal(output.modeling, 'modeled');
    near(
      output.baseAmount,
      output.sources.reduce((sum, source) => sum + (source.value ?? 0), 0),
    );
  }
  assert.equal(result.coverage.complete, true);
}

void test('modeled wall reports exactly the positioned studs, tracks and finish surfaces', () => {
  const project = fixture(wall());
  const result = calculateProject(project);
  linked(result);
  const studs = result.model.pieces.filter((piece) => piece.role === 'stud');
  const tracks = result.model.pieces.filter((piece) =>
    piece.role.endsWith('track'),
  );
  assert.equal(studs.length, 19); // 24 ft / 16 in, plus both ends.
  for (const stud of studs) near(stud.cutLength, 10 * ft);
  assert.equal(tracks.length, 6); // Two 24 ft runs, each split into 10+10+4 ft.
  near(
    tracks.reduce((sum, piece) => sum + piece.cutLength, 0),
    48 * ft,
  );
  near(
    result.outputs
      .filter((output) => output.unit === 'ft2')
      .reduce((sum, output) => sum + output.baseAmount, 0),
    480,
  );
  assert.ok(
    result.outputs.every(
      (output) =>
        output.assignmentId === 'applied' &&
        output.recipeId === 'steel-wall' &&
        output.groupId === 'scope',
    ),
  );
});

void test('project definition edits update modeled pieces while sparse wall edits preserve only local differences', () => {
  let project = fixture(wall(8));
  const applied = resolveConstruction(project).walls['applied/trace'];
  assert.ok(applied);
  project = command(project, 'wall.put', {
    ...materialSettings(applied),
    id: applied.id,
    geometryId: applied.geometryId,
    height: 10 * ft,
  });
  assert.deepEqual(project.assignments.applied?.geometryDetails?.trace?.wall, {
    height: 10 * ft,
  });
  const changed = structuredClone(project.recipes['steel-wall']);
  assert.ok(changed?.wallTemplate);
  changed.wallTemplate.height = 9 * ft;
  changed.wallTemplate.studSpacing = 2 * ft;
  changed.wallTemplate.stud.materialId = 'new-project-stud';
  project = command(project, 'assembly.put', changed);
  const result = calculateProject(project);
  linked(result);
  const studs = result.model.pieces.filter((piece) => piece.role === 'stud');
  assert.equal(studs.length, 13);
  for (const stud of studs) {
    near(stud.cutLength, 10 * ft);
    assert.equal(stud.materialId, 'new-project-stud');
  }
  project = command(project, 'wall.reset', { id: 'applied/trace' });
  const reset = calculateProject(project);
  linked(reset);
  for (const stud of reset.model.pieces.filter(
    (piece) => piece.role === 'stud',
  ))
    near(stud.cutLength, 9 * ft);
});

void test('opening geometry drives layered finish area, header elevation, backing cuts and their reports', () => {
  const recipe = wall();
  assert.ok(recipe.wallTemplate);
  recipe.wallTemplate.finishes = [
    {
      id: 'board',
      face: 'front',
      materialId: 'type-x',
      layers: 2,
      thickness: 0.015875,
    },
  ];
  recipe.wallTemplate.backing = [
    {
      id: 'backing',
      height: 4 * ft,
      member: {
        materialId: 'wood-backing',
        width: 0.0381,
        depth: 0.0889,
        stockLength: 16 * ft,
      },
    },
  ];
  let project = fixture(recipe);
  project = command(project, 'header.put', {
    id: 'detail',
    name: 'Specified header',
    components: [
      {
        id: 'web',
        role: 'header-web',
        member: {
          materialId: 'header-track',
          width: 0.092075,
          depth: 0.05,
          stockLength: 10 * ft,
        },
        startExtension: 0,
        endExtension: 0,
        verticalOffset: 0.025,
        faceOffset: 0,
      },
    ],
  });
  project = command(project, 'opening.put', {
    id: 'door',
    wallId: 'applied/trace',
    distance: 8 * ft,
    width: 3 * ft,
    sill: 0,
    height: 7 * ft,
    jambCount: 1,
    headerId: 'detail',
  });
  const result = calculateProject(project);
  linked(result);
  const board = result.outputs.find((output) => output.materialId === 'type-x');
  near(board?.baseAmount ?? NaN, 438); // (24 × 10 - 3 × 7) × 2.
  const header = result.model.pieces.find(
    (piece) => piece.role === 'header-web',
  );
  assert.ok(header);
  near(header.start.z, 7 * ft + 0.025);
  near(header.end.z, 7 * ft + 0.025);
  near(header.cutLength, 3 * ft);
  const backing = result.model.pieces.filter(
    (piece) => piece.role === 'backing',
  );
  near(
    backing.reduce((sum, piece) => sum + piece.cutLength, 0),
    21 * ft,
  );
  assert.ok(
    backing.every(
      (piece) =>
        piece.end.x <= 8 * ft + 1e-8 || piece.start.x >= 11 * ft - 1e-8,
    ),
  );
});

void test('waste and packages change purchasing without creating extra material geometry', () => {
  const recipe = wall();
  assert.ok(recipe.wallTemplate);
  recipe.wallTemplate.finishes = [
    {
      id: 'board',
      materialId: 'type-x',
      face: 'front',
      layers: 2,
      wastePercent: 10,
      packageSize: 32 * ft ** 2,
    },
  ];
  recipe.wallTemplate.stud.wastePercent = 10;
  recipe.wallTemplate.stud.packageSize = 10;
  const result = calculateProject(fixture(recipe));
  linked(result);
  const stud = result.outputs.find(
    (output) => output.materialId === recipe.wallTemplate?.stud.materialId,
  );
  assert.equal(stud?.baseAmount, 19);
  assert.equal(stud.purchasedAmount, 30);
  assert.equal(
    result.model.pieces.filter((piece) => piece.role === 'stud').length,
    19,
  );
  const board = result.outputs.find((output) => output.materialId === 'type-x');
  near(board?.baseAmount ?? NaN, 480);
  near(board?.purchasedAmount ?? NaN, 544); // 480 × 1.10, rounded to 17 × 32 SF.
  near(
    result.model.surfaces.reduce((sum, surface) => sum + surface.area, 0),
    480 * ft ** 2,
  );
});

void test('both ACT layout assemblies report their actual main, tee, angle and tile geometry', () => {
  for (const system of ['2x2', '2x4'] as const) {
    const result = calculateProject(
      fixture(starter(`ceiling-grid-${system}`), 'area'),
    );
    linked(result);
    const count = (role: string) =>
      result.model.pieces.filter((piece) => piece.role === role).length;
    assert.equal(count('ceiling-main'), 1);
    assert.equal(count('ceiling-tee-4ft'), 6);
    assert.equal(count('ceiling-tee-2ft'), system === '2x2' ? 8 : 0);
    assert.equal(count('ceiling-wall-angle'), 4);
    assert.equal(result.model.surfaces.length, system === '2x2' ? 16 : 8);
    near(
      result.outputs.find((output) => output.unit === 'ft2')?.baseAmount ?? NaN,
      64,
    );
    assert.ok(
      result.model.pieces.every(
        (piece) => Math.abs(piece.start.z - piece.depth / 2 - 9 * ft) < 1e-8,
      ),
    );
  }
});

void test('ACT purchase rounding groups tile patches instead of ordering a package per patch', () => {
  const recipe = starter('ceiling-grid-2x2');
  assert.ok(recipe.ceilingTemplate?.grid);
  recipe.ceilingTemplate.packageSize = 48 * ft ** 2;
  recipe.ceilingTemplate.wastePercent = 10;
  recipe.ceilingTemplate.grid.main.wastePercent = 10;
  recipe.ceilingTemplate.grid.crossTee4.packageSize = 10;
  const result = calculateProject(fixture(recipe, 'area'));
  linked(result);
  assert.equal(result.model.surfaces.length, 16);
  const tile = result.outputs.find((output) => output.unit === 'ft2');
  assert.equal(tile?.packageCount, 2);
  near(tile.purchasedAmount, 96);
  assert.equal(
    result.outputs.find((output) => output.role === 'ceiling-main')
      ?.purchasedAmount,
    2,
  );
  assert.equal(
    result.outputs.find((output) => output.role === 'ceiling-tee-4ft')
      ?.purchasedAmount,
    10,
  );
  assert.equal(
    result.model.pieces.filter((piece) => piece.role === 'ceiling-main').length,
    1,
  );
});

void test('a formula piece schedule remains an explicit estimate and creates no material mesh', () => {
  let project = fixture(starter('steel-straight-run'));
  const assignment = project.assignments.applied;
  assert.ok(assignment);
  project = command(project, 'assignment.put', {
    ...assignment,
    inputs: { height: 10, stockLength: 12 },
  });
  const result = calculateProject(project);
  assert.equal(result.complete, true);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.estimateOutputs, 1);
  const estimate = result.outputs[0];
  assert.ok(estimate);
  assert.equal(estimate.modeling, 'estimate');
  assert.equal(estimate.baseAmount, 19);
  near(estimate.sources[0]?.cutLength?.value ?? NaN, 10 * ft);
  assert.deepEqual(result.model.pieces, []);
  assert.deepEqual(result.model.surfaces, []);
  assert.deepEqual(constructionSceneInput(result.model), {
    members: [],
    surfaces: [],
  });
});

void test('missing modeled height is unresolved and never becomes zero-quantity material geometry', () => {
  const result = calculateProject(fixture(starter('steel-wall')));
  assert.equal(result.complete, false);
  assert.equal(result.coverage.complete, false);
  assert.deepEqual(result.model.pieces, []);
  assert.deepEqual(result.model.surfaces, []);
  assert.ok(
    result.outputs.some(
      (output) =>
        output.modeling === 'unresolved' &&
        output.sources.some((source) => source.value === null),
    ),
  );
});
