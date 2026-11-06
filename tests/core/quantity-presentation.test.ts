import assert from 'node:assert/strict';
import { test } from 'node:test';
import contract from '../fixtures/estimaker-takeoff-v1.json';
import {
  calculateProject,
  exportQuantities,
  exportPieces,
} from '../../src/core/calculations';
import {
  estiMakerTakeoff,
  presentQuantities,
} from '../../src/core/quantity-presentation';
import {
  modeledOutputs,
  summarizeMaterials,
} from '../../src/core/material-results';
import { fixture } from '../fixtures/quantity-project';
import type {
  CalculationResult,
  Project,
  RecipeOutput,
} from '../../src/core/types';
import type { ConstructionResult } from '../../src/core/construction-types';
import { componentOutputId } from '../../src/core/systems';

function present<T>(value: T | null | undefined): T {
  assert.ok(value != null);
  return value;
}

const takeoff = (project: Project) =>
  estiMakerTakeoff(
    project,
    calculateProject(project),
    '2026-11-06T12:00:00.000Z',
  );
const near = (value: number | undefined, expected: number) => {
  assert.ok(
    value !== undefined && Math.abs(value - expected) < 1e-8,
    `${String(value)} != ${String(expected)}`,
  );
};
function definition(project: Project): RecipeOutput {
  return present(present(project.recipes.tee).outputs[0]);
}

void test('75 explicit 2ft pieces export 150 LF with quantity-only provenance and formula coverage warning', () => {
  const result = takeoff(fixture());
  assert.deepEqual(result, contract);
  assert.equal(result.kind, 'bluewing.takeoff');
  assert.equal(result.version, 1);
  assert.equal(result.project.revision, '0');
  assert.equal(result.calculationComplete, true);
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.estimateOutputs, 1);
  assert.equal(result.coverage.unresolvedOutputs, 0);
  assert.equal(result.skipped.length, 0);
  const row = present(result.rows[0]);
  near(row.quantity, 150);
  assert.equal(row.unit, 'LF');
  assert.equal(row.pieceCount, 75);
  assert.ok(row.description.includes('2ft (75pc)'));
  assert.equal(row.baseDescription, 'Tee');
  assert.equal(row.category, 'Acoustical ceilings');
  assert.equal(row.provenance.physicalLengthSource, 'cut');
  assert.equal(row.provenance.basis, 'purchased');
  assert.equal(row.provenance.sourceRefs[0]?.sheetId, 's');
  assert.equal(row.cutSchedule[0]?.count, 75);
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      'kind',
      'version',
      'project',
      'exportedAt',
      'calculationComplete',
      'coverage',
      'rows',
      'skipped',
    ].sort(),
  );
});

void test('direct lengths/areas convert purchased quantities once and generic exports remain intact', () => {
  for (const [unit, value, expected, target] of [
    ['ft', 10, 10, 'LF'],
    ['in', 120, 10, 'LF'],
    ['m', 3.048, 10, 'LF'],
    ['mm', 3048, 10, 'LF'],
    ['ft2', 100, 100, 'SF'],
    ['m2', 9.290304, 100, 'SF'],
  ] as const) {
    const project = fixture();
    const output = definition(project);
    delete output.piece;
    present(project.recipes.tee).inputs = [
      { name: 'q', type: 'number', unit, default: value },
    ];
    Object.assign(output, { unit, formula: 'q' });
    const row = takeoff(project).rows[0];
    near(row?.quantity, expected);
    assert.equal(row?.unit, target);
  }
  const project = fixture();
  const output = definition(project);
  delete output.piece;
  present(project.recipes.tee).inputs = [
    { name: 'q', type: 'number', unit: 'ft2', default: 100 },
  ];
  Object.assign(output, {
    unit: 'ft2',
    formula: 'q',
    allowance: { wastePercent: 10, packageSize: 32 },
  });
  near(present(takeoff(project).rows[0]).quantity, 128);
  const result = calculateProject(project);
  near(result.outputs[0]?.adjustedAmount, 110);
  assert.equal(result.outputs[0]?.packageCount, 4);
  assert.ok(
    exportQuantities(project, 'csv', result).includes('purchasedAmount'),
  );
  assert.deepEqual(
    (JSON.parse(exportQuantities(project, 'json', result)) as CalculationResult)
      .totals,
    result.totals,
  );
  assert.equal(typeof exportPieces(project, 'csv', result), 'string');
});

void test('stock differs from net cuts; waste/packages apply once; invalid stock never falls back; nullish stock permits cut', () => {
  const project = fixture();
  const output = definition(project);
  output.formula = '5';
  present(output.piece).stockLength = { formula: 'stock', unit: 'ft' };
  output.allowance = { wastePercent: 10, packageSize: 4 };
  const result = calculateProject(project);
  const row = present(estiMakerTakeoff(project, result).rows[0]);
  near(row.quantity, 80);
  assert.equal(row.pieceCount, 8);
  assert.equal(row.provenance.physicalLengthSource, 'stock');
  near(row.cutSchedule?.[0]?.length.value, 0.6096);
  near(row.pieceLength?.value, 3.048);
  for (const value of [0, -1, NaN, Infinity]) {
    const changed = structuredClone(result);
    present(changed.outputs[0]).stockLength = { value, unit: 'm' };
    const skipped = estiMakerTakeoff(project, changed);
    assert.equal(skipped.rows.length, 0);
    assert.equal(skipped.skipped[0]?.code, 'invalid-stock-length');
  }
  const noStock = structuredClone(result);
  // Runtime compatibility: nullish missing stock has no artificial separate policy.
  Object.assign(present(noStock.outputs[0]), { stockLength: null });
  const cut = present(estiMakerTakeoff(project, noStock).rows[0]);
  near(cut.quantity, 16);
  assert.equal(cut.provenance.physicalLengthSource, 'cut');
  output.allowance = { wastePercent: 0, packageSize: 2.5 };
  output.formula = '6';
  assert.equal(takeoff(project).skipped[0]?.code, 'invalid-quantity');
});

void test('count-only, scalar, invalid formulas, unresolved and incomplete outputs give explicit skipped diagnostics', () => {
  const project = fixture();
  delete definition(project).piece;
  assert.equal(takeoff(project).skipped[0]?.code, 'missing-physical-length');
  const countIssue = present(takeoff(project).skipped[0]);
  assert.equal(countIssue.baseDescription, 'Tee');
  assert.equal(countIssue.description, 'Tee');
  assert.equal(countIssue.category, 'Acoustical ceilings');
  assert.equal(countIssue.provenance.originalAmount, 75);
  assert.equal(countIssue.provenance.originalUnit, 'ea');
  assert.ok(!('quantity' in countIssue));
  definition(project).unit = 'scalar';
  assert.equal(takeoff(project).skipped[0]?.code, 'unsupported-unit');
  definition(project).formula = 'unknown';
  assert.equal(takeoff(project).skipped[0]?.code, 'incomplete');
  assert.ok(present(takeoff(project).skipped[0]).diagnostics.length);
  assert.equal(
    present(takeoff(project).skipped[0]).provenance.originalAmount,
    null,
  );
  const result = calculateProject(fixture());
  present(result.outputs[0]).modeling = 'unresolved';
  assert.equal(
    present(estiMakerTakeoff(project, result).skipped[0]).provenance
      .originalUnit,
    null,
  );
  assert.equal(
    present(estiMakerTakeoff(project, result).skipped[0]).provenance
      .originalAmount,
    null,
  );
  assert.equal(
    estiMakerTakeoff(project, result).skipped[0]?.code,
    'unresolved',
  );
  present(result.outputs[0]).modeling = 'estimate';
  present(result.outputs[0]).complete = false;
  assert.equal(estiMakerTakeoff(project, result).rows.length, 0);
  present(result.outputs[0]).complete = true;
  present(result.outputs[0]).purchasedAmount = Infinity;
  const invalid = present(estiMakerTakeoff(project, result).skipped[0]);
  assert.equal(invalid.provenance.originalAmount, null);
  assert.equal(invalid.code, 'invalid-quantity');
  assert.ok(!('quantity' in invalid));
});

function modeledFixture() {
  const project = fixture();
  const model: ConstructionResult = {
    pieces: [2, 4].map((feet, index) => ({
      id: `p${String(index)}`,
      assignmentId: 'a',
      recipeId: 'tee',
      groupId: 'group',
      geometryId: 'g',
      materialId: 'tee',
      role: 'tee',
      start: { x: 0, y: 0, z: 0 },
      end: { x: feet * 0.3048, y: 0, z: 0 },
      cutLength: 0,
      stockLength: 3.048,
      wastePercent: 10,
      packageSize: 4,
      width: 0.01,
      depth: 0.01,
      sectionRotation: 0,
    })),
    surfaces: [
      {
        id: 's1',
        assignmentId: 'a',
        groupId: 'group',
        recipeId: 'tee',
        geometryId: 'g',
        materialId: 'tile',
        finishId: 'tile',
        face: 'ceiling',
        layers: 1,
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 3.048, y: 0, z: 0 },
          { x: 3.048, y: 3.048, z: 0 },
          { x: 0, y: 3.048, z: 0 },
        ],
        geometricArea: 0,
        area: 0,
      },
    ],
    purchases: [],
    diagnostics: [],
    complete: true,
  };
  const calculate = (): CalculationResult => {
    summarizeMaterials(model);
    return {
      outputs: modeledOutputs(project, model),
      model,
      totals: [],
      complete: true,
      coverage: { modeledOutputs: 2, estimateOutputs: 0, complete: true },
    };
  };
  return { project, model, calculate };
}

void test('mixed modeled cuts/common stock preserve one purchase bucket and required cut schedule', () => {
  const { project, calculate, model } = modeledFixture();
  const rows = estiMakerTakeoff(project, calculate()).rows;
  assert.equal(rows.length, 2);
  near(present(rows[0]).quantity, 40);
  assert.equal(present(rows[0]).pieceCount, 4);
  assert.equal(present(present(rows[0]).cutSchedule).length, 2);
  assert.equal(
    present(present(rows[0]).cutSchedule).reduce((n, cut) => n + cut.count, 0),
    2,
  );
  near(present(rows[1]).quantity, 100);
  assert.equal(present(rows[0]).source.outputId, null);
  delete present(model.pieces[0]).stockLength;
  delete present(model.pieces[1]).stockLength;
  const cuts = estiMakerTakeoff(project, calculate()).rows.filter(
    (row) => row.unit === 'LF',
  );
  assert.equal(cuts.length, 2);
  assert.ok(cuts.every((row) => row.provenance.physicalLengthSource === 'cut'));
});

void test('semantic IDs survive quantity/name/source changes, reorder and unrelated modeled insertions', () => {
  const project = fixture();
  const original = present(takeoff(project).rows[0]);
  project.name = 'Renamed';
  project.revision++;
  present(project.groups.group).name = 'Renamed group';
  project.geometries.other = {
    ...present(project.geometries.g),
    id: 'other',
    name: 'New trace',
  };
  present(project.groups.group).geometryIds.unshift('other');
  definition(project).formula = '100';
  definition(project).name = 'Renamed output';
  assert.equal(present(takeoff(project).rows[0]).lineId, original.lineId);
  const cached = calculateProject(project);
  present(project.groups.group).name = 'Latest label';
  assert.equal(
    presentQuantities(project, cached)[0]?.row?.source.groupLabel,
    'Latest label',
  );
  const modeled = modeledFixture();
  const before = estiMakerTakeoff(modeled.project, modeled.calculate()).rows;
  modeled.model.pieces.reverse();
  modeled.model.pieces.unshift({
    ...present(modeled.model.pieces[0]),
    id: 'unrelated',
    materialId: 'unrelated',
    assignmentId: 'other',
  });
  modeled.model.surfaces.unshift({
    ...present(modeled.model.surfaces[0]),
    id: 'unrelated-surface',
    materialId: 'other',
  });
  const after = estiMakerTakeoff(modeled.project, modeled.calculate()).rows;
  for (const row of before)
    assert.ok(after.some((entry) => entry.lineId === row.lineId));
  modeled.model.pieces.push({
    ...present(modeled.model.pieces[1]),
    id: 'additional-source',
    geometryId: 'another-trace',
  });
  const changed = estiMakerTakeoff(modeled.project, modeled.calculate()).rows;
  assert.ok(changed.some((row) => row.lineId === present(before[0]).lineId));
});

void test('component-qualified formula identities and existing categories stay distinct', () => {
  const project = fixture();
  const child = structuredClone(present(project.recipes.tee));
  project.recipes.tee = {
    ...child,
    category: 'System',
    outputs: [],
    components: [
      { id: 'a/b', assembly: child, bindings: {} },
      { id: 'c', assembly: child, bindings: {} },
    ],
  };
  const rows = takeoff(project).rows;
  assert.equal(rows.length, 2);
  assert.notEqual(present(rows[0]).lineId, present(rows[1]).lineId);
  assert.equal(
    present(rows[0]).source.outputId,
    componentOutputId('a/b', 'tee'),
  );
  assert.equal(present(rows[0]).category, child.category);
});
