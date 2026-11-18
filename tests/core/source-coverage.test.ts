import assert from 'node:assert/strict';
import { test } from 'node:test';
import { starterAssemblies } from '../../src/core/assemblies';
import {
  calculateProject,
  exportQuantities,
  type inspectQuantities,
} from '../../src/core/calculations';
import { executeCommand } from '../../src/core/commands';
import { createProject } from '../../src/core/geometry';
import { estiMakerTakeoff } from '../../src/core/quantity-presentation';
import { ProjectSession } from '../../src/core/session';
import { fixture } from '../fixtures/quantity-project';
import type { Geometry, Project } from '../../src/core/types';

function narrowArea(id: string, sheetId = 's'): Geometry {
  // At one foot per page unit, this strip lies between the 16-inch joist stations.
  return {
    id,
    kind: 'area',
    name: 'Joist strip',
    sheetId,
    points: [
      { x: 0, y: 0.2 },
      { x: 4, y: 0.2 },
      { x: 4, y: 0.4 },
      { x: 0, y: 0.4 },
    ],
  };
}

function assign(
  project: Project,
  groupId: string,
  recipeId: string,
  geometryIds: string[],
) {
  project.groups[groupId] = { id: groupId, name: groupId, geometryIds };
  project.assignments[groupId] = {
    id: groupId,
    groupId,
    recipeId,
    inputs: {},
    allowances: {},
  };
}

void test('a lone room appears in inspection while the complete takeoff exports zero rows', () => {
  const project = createProject('Unassigned room');
  project.sheets = fixture().sheets;
  project.geometries.room = narrowArea('room');
  const result = calculateProject(project);
  assert.equal(result.sourceCoverage.ungroupedGeometry.count, 1);
  assert.equal(result.complete, true);
  assert.equal(result.coverage.complete, true);
  assert.deepEqual(result.outputs, []);
  assert.deepEqual(result.totals, []);
  assert.deepEqual(estiMakerTakeoff(project, result).rows, []);
});

void test('each omitted drawing is listed once across memberships and assignments, with empty assignments separate', () => {
  const project = fixture();
  const joists = starterAssemblies()['steel-joists'];
  const count = project.geometries.g;
  assert.ok(joists && count);
  project.recipes[joists.id] = joists;
  assign(project, 'joists', joists.id, []);
  assign(project, 'empty', 'count', []);
  // Preserve the ordinary zero row from the empty formula assignment.
  const before = calculateProject(project);
  assert.equal(
    before.outputs.find((o) => o.assignmentId === 'empty')?.baseAmount,
    0,
  );
  const handoff = (p: Project) =>
    estiMakerTakeoff(p, calculateProject(p), '2026-11-17T00:00:00.000Z');
  const beforeHandoff = handoff(project);

  project.geometries.markers = {
    ...count,
    id: 'markers',
    name: 'Ceiling interfaces',
    points: Array.from({ length: 6 }, (_, x) => ({ x, y: 1 })),
  };
  project.geometries.reference = narrowArea('reference');
  project.geometries.outline = narrowArea('outline');
  project.geometries.strip = narrowArea('strip');
  project.groups.unassigned = {
    id: 'unassigned',
    name: 'Traces',
    geometryIds: ['reference', 'outline', 'strip', 'g'],
  };
  const formulaGroup = project.groups.group;
  const joistGroup = project.groups.joists;
  assert.ok(formulaGroup && joistGroup);
  formulaGroup.geometryIds.push('outline', 'strip');
  // The count contributes through its formula even though it is incompatible here.
  joistGroup.geometryIds.push('strip', 'g');

  const after = calculateProject(project);
  const read = executeCommand(project, { name: 'quantities.inspect' })
    .data as ReturnType<typeof inspectQuantities>;
  const bucket = (item: object) => ({ count: 1, items: [item] });
  const area = (geometryId: string, groupId: string) => ({
    geometryId,
    groupId,
    name: 'Joist strip',
    sheetId: 's',
    kind: 'area',
  });
  assert.deepEqual(read.sourceCoverage, {
    ungroupedGeometry: bucket({
      geometryId: 'markers',
      name: 'Ceiling interfaces',
      sheetId: 's',
      kind: 'count',
    }),
    geometryInUnassignedGroups: bucket(area('reference', 'unassigned')),
    geometryWithIncompatibleRecipes: bucket(area('outline', 'group')),
    geometryWithoutOutputOrDiagnostic: bucket(area('strip', 'joists')),
    assignmentsWithEmptyGroups: bucket({
      assignmentId: 'empty',
      groupId: 'empty',
      recipeId: 'count',
    }),
  });
  assert.deepEqual(after.outputs, before.outputs);
  assert.deepEqual(after.totals, before.totals);
  assert.equal(after.complete, before.complete);
  assert.deepEqual(after.coverage, before.coverage);
  for (const format of ['csv', 'json'] as const)
    assert.equal(
      exportQuantities(project, format, after),
      exportQuantities(project, format, before),
    );
  assert.ok(
    !('sourceCoverage' in JSON.parse(exportQuantities(project, 'json', after))),
  );
  assert.deepEqual(handoff(project), beforeHandoff);
});

void test('uncalibrated assigned geometry follows its formula or model diagnostic', () => {
  const project = fixture();
  const sheet = project.sheets.s;
  const joists = starterAssemblies()['steel-joists'];
  assert.ok(sheet && joists);
  delete sheet.calibration;
  project.recipes[joists.id] = joists;
  project.geometries.floor = narrowArea('floor');
  project.geometries.strip = narrowArea('strip');
  assign(project, 'floor', 'floor-area', ['floor']);
  assign(project, 'joists', joists.id, ['strip']);
  const result = calculateProject(project);
  assert.ok(
    result.outputs.some((o) =>
      o.sources.some((s) => s.geometryId === 'floor' && s.diagnostic),
    ),
  );
  assert.ok(result.model.diagnostics.some((d) => d.geometryId === 'strip'));
  assert.equal(result.complete, false);
  assert.deepEqual(
    result.sourceCoverage,
    calculateProject(fixture()).sourceCoverage,
  );
});

void test('inspection resolves current labels on the shared frozen result and scopes the list to the requested takeoff', async () => {
  const project = fixture();
  project.geometries.room = narrowArea('room');
  project.geometries.other = narrowArea('other');
  project.takeoffs.phase = {
    id: 'phase',
    kind: 'phase',
    name: 'Phase',
    owned: { geometries: ['other'] },
  };
  const session = new ProjectSession(project, {
    save: () => Promise.resolve(),
  });
  const snapshot = session.calculation;
  assert.ok(
    Object.isFrozen(snapshot.sourceCoverage.ungroupedGeometry.items[0]),
  );
  const inspect = async (takeoffId: string) => {
    const read = await session.dispatch({
      ...session.observation,
      takeoffId,
      name: 'quantities.inspect',
    });
    return (read.data as ReturnType<typeof inspectQuantities>).sourceCoverage
      .ungroupedGeometry;
  };
  await session.dispatch({
    ...session.observation,
    name: 'geometry.put',
    payload: { ...project.geometries.room, name: 'Revised room' },
  });
  assert.equal(session.calculation, snapshot);
  assert.deepEqual(await inspect('main'), {
    count: 1,
    items: [
      { geometryId: 'room', name: 'Revised room', sheetId: 's', kind: 'area' },
    ],
  });
  assert.deepEqual(
    (await inspect('phase')).items.map((item) => item.geometryId),
    ['other'],
  );
});
