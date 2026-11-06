import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProject } from '../../src/core/geometry';
import { starterAssemblies } from '../../src/core/assemblies';
import { calculateProject } from '../../src/core/calculations';
import { ProjectSession } from '../../src/core/session';
import {
  executeCommand,
  validateCommand,
  validateProject,
  validatePayload,
} from '../../src/core/commands';
import { registry } from '../../src/app/registry';
import {
  categoryColor,
  categoryName,
  categoryOptions,
  standardCategories,
  geometryCategories,
  geometryMatchesCategories,
  filterConstructionCategories,
} from '../../src/core/categories';
import { offsetStroke } from '../../src/core/category-strokes';
import { recordChanges } from '../../src/platform/storage-model';
import {
  visibleDrawingIds,
  visibleCategoryTags,
} from '../../src/app/visibility';
import {
  buildConstructionScene,
  constructionSceneInput,
} from '../../src/three/scene';

function fixture() {
  const project = createProject('Shared scopes');
  project.sheets.s = {
    id: 's',
    name: 'Plan',
    assetId: 'pdf',
    pageIndex: 0,
    width: 100,
    height: 100,
    calibration: { metresPerUnit: 0.3048 },
  };
  project.geometries.line = {
    id: 'line',
    name: 'Shared line',
    sheetId: 's',
    kind: 'path',
    points: [
      { x: 0, y: 0 },
      { x: 24, y: 0 },
    ],
  };
  project.groups.g = { id: 'g', name: 'Wall', geometryIds: ['line'] };
  project.recipes = starterAssemblies();
  for (const id of ['steel-framing', 'drywall-wall-surface']) {
    assert.ok(project.recipes[id], id);
    project.assignments[id] = {
      id,
      groupId: 'g',
      recipeId: id,
      inputs: {},
      allowances: {},
    };
  }
  const framing = project.recipes['steel-framing'];
  assert.ok(framing?.wallTemplate);
  framing.wallTemplate.height = 8 * 0.3048;
  const finish = project.recipes['drywall-wall-surface'];
  assert.ok(finish?.materialTemplate?.kind === 'path-surface');
  finish.materialTemplate.height = 8 * 0.3048;
  return project;
}

void test('category matching trims names and ignores case while custom colors remain project-only', () => {
  const project = createProject('Categories');
  project.categoryColors = { 'Special scope': '#961DCB' };
  assert.equal(categoryName(' DRYWALL HANG/FINISH '), 'Drywall hang/finish');
  assert.equal(
    categoryName('acoustical ceilings/acoustical work'),
    'Acoustical ceilings/acoustical work',
  );
  assert.equal(categoryName(' '), null);
  assert.equal(categoryName(' insulation '), 'Insulation');
  const insulation = categoryOptions(project).find(
    (entry) => entry.name === 'Insulation',
  );
  assert.ok(insulation);
  assert.equal(categoryColor({}, 'INSULATION'), insulation.color);
  assert.notEqual(insulation.color, categoryColor({}, 'Demo'));
  assert.ok(
    standardCategories
      .filter((entry) => entry.name !== 'Insulation')
      .every((entry) => entry.color !== insulation.color),
  );
  assert.equal(categoryColor(project, 'special SCOPE'), '#961DCB');
  assert.equal(
    categoryColor(project, 'DRYWALL HANG/FINISH'),
    categoryColor({}, 'Drywall hang/finish'),
  );
  assert.equal(categoryColor({}, 'Other'), categoryColor({}, ' other '));
  assert.ok(
    categoryOptions(project).some((entry) => entry.name === 'Special scope'),
  );
  const standards = new Set<string>(
    standardCategories.map((entry) => entry.name),
  );
  for (const assembly of Object.values(starterAssemblies()))
    assert.ok(
      standards.has(assembly.category ?? ''),
      `${assembly.id} must declare a standard category directly`,
    );
});

void test('one shared trace derives distinct assembly scopes without duplicates or quantity changes', () => {
  const project = fixture();
  const before = calculateProject(project);
  const tags = geometryCategories(project);
  assert.deepEqual(tags.line, [
    'Drywall hang/finish',
    'Light-gauge metal framing',
  ]);
  assert.equal(
    geometryMatchesCategories(tags.line, ['Drywall hang/finish']),
    true,
  );
  assert.equal(geometryMatchesCategories(tags.line, ['Demo']), false);
  assert.equal(geometryMatchesCategories([], [null]), true);
  assert.equal(geometryMatchesCategories([], []), false);
  const drywall = filterConstructionCategories(project, before.model, [
    'Drywall hang/finish',
  ]);
  assert.equal(drywall.pieces.length, 0);
  assert.ok(drywall.surfaces.length > 0);
  assert.ok(
    drywall.surfaces.every(
      (surface) => surface.recipeId === 'drywall-wall-surface',
    ),
  );
  const framing = filterConstructionCategories(project, before.model, [
    'Light-gauge metal framing',
  ]);
  assert.ok(framing.pieces.length > 0);
  assert.equal(framing.surfaces.length, 0);
  const sceneInput = constructionSceneInput(before.model, project);
  const drywallScene = buildConstructionScene(sceneInput, {
    categories: ['Drywall hang/finish'],
  });
  assert.equal(drywallScene.members.length, 0);
  assert.equal(drywallScene.surfaces.length, drywall.surfaces.length);
  assert.ok(
    drywallScene.surfaces.every(
      (source) =>
        source.color === categoryColor(project, 'Drywall hang/finish'),
    ),
  );
  const framingScene = buildConstructionScene(sceneInput, {
    categories: ['Light-gauge metal framing'],
  });
  assert.equal(framingScene.surfaces.length, 0);
  assert.ok(
    framingScene.members.every(
      (source) => source.category === 'Light-gauge metal framing',
    ),
  );
  assert.deepEqual(calculateProject(project), before);
  const framingAssignment = project.assignments['steel-framing'];
  assert.ok(framingAssignment);
  project.assignments.copy = { ...framingAssignment, id: 'copy' };
  assert.deepEqual(geometryCategories(project), tags);
});

void test('hidden groups cannot supply a category through another visible group on the same trace', () => {
  const project = fixture();
  delete project.groups.g;
  project.groups.f = { id: 'f', name: 'Framing', geometryIds: ['line'] };
  project.groups.d = {
    id: 'd',
    name: 'Drywall hang/finish',
    geometryIds: ['line'],
  };
  const framing = project.assignments['steel-framing'];
  const drywall = project.assignments['drywall-wall-surface'];
  assert.ok(framing && drywall);
  framing.groupId = 'f';
  drywall.groupId = 'd';
  const visibility = { hiddenSheets: [], hiddenGroups: { s: ['f'] } };
  assert.deepEqual(visibleCategoryTags(project, visibility).line, [
    'Drywall hang/finish',
  ]);
  assert.equal(
    visibleDrawingIds(project, visibility, ['Light-gauge metal framing']).size,
    0,
  );
  assert.equal(
    visibleDrawingIds(project, visibility, ['Drywall hang/finish']).size,
    1,
  );
  assert.equal(
    visibleDrawingIds(project, { hiddenSheets: ['s'], hiddenGroups: {} }, [
      'Drywall hang/finish',
    ]).size,
    0,
  );
});

void test('inspection keeps unresolved matching applications and ignores local filter state', () => {
  const project = fixture();
  const report = executeCommand(project, {
    name: 'construction.inspect',
    payload: { categories: ['Drywall hang/finish'] },
  }).data as {
    pieces: unknown[];
    surfaces: unknown[];
    applications: { materials: Record<string, unknown> };
  };
  assert.equal(report.pieces.length, 0);
  assert.ok(report.surfaces.length > 0);
  assert.equal(Object.keys(report.applications.materials).length, 1);
  const empty = executeCommand(project, {
    name: 'construction.inspect',
    payload: { categories: [] },
  }).data as { pieces: unknown[]; surfaces: unknown[] };
  assert.equal(empty.pieces.length + empty.surfaces.length, 0);
  const framing = project.recipes['steel-framing'];
  assert.ok(framing?.wallTemplate);
  delete framing.wallTemplate.height;
  const unresolved = executeCommand(project, {
    name: 'construction.inspect',
    payload: { categories: ['Light-gauge metal framing'] },
  }).data as {
    diagnostics: unknown[];
    applications: { walls: Record<string, unknown> };
  };
  assert.ok(Object.keys(unresolved.applications.walls).length);
  assert.ok(unresolved.diagnostics.length);
});

void test('project custom color changes persist, undo and redo without recalculation', async () => {
  const project = fixture();
  const session = new ProjectSession(project, {
    save: () => Promise.resolve(),
  });
  const calculation = session.calculation;
  const run = (name: string, payload?: Record<string, unknown>) =>
    session.dispatch({
      ...session.observation,
      name,
      ...(payload ? { payload } : {}),
    });
  await run('project.category.put', {
    name: 'Special scope',
    color: '#961DCB',
  });
  assert.equal(session.project.categoryColors?.['Special scope'], '#961DCB');
  assert.strictEqual(session.calculation, calculation);
  const writes = recordChanges(project, session.project);
  assert.ok(
    writes.some(
      (change) =>
        change.collection === 'extensions' && change.id === 'categoryColors',
    ),
  );
  await run('history.undo');
  assert.equal(session.project.categoryColors, undefined);
  await run('history.redo');
  assert.equal(session.project.categoryColors['Special scope'], '#961DCB');
  assert.strictEqual(session.calculation, calculation);
  validateProject(session.project);
  const definition = session.project.recipes['steel-framing'];
  assert.ok(definition);
  await run('assembly.put', { ...definition, category: 'Special scope' });
  assert.strictEqual(session.calculation, calculation);
  assert.ok(
    geometryCategories(session.project).line?.includes('Special scope'),
  );
  await run('history.undo');
  assert.strictEqual(session.calculation, calculation);
  assert.ok(
    geometryCategories(session.project).line?.includes(
      'Light-gauge metal framing',
    ),
  );
  assert.throws(() =>
    executeCommand(project, {
      name: 'project.category.put',
      payload: { name: 'Drywall hang/finish', color: '#112233' },
    }),
  );
  assert.throws(() =>
    executeCommand(project, {
      name: 'project.category.put',
      payload: { name: 'Special', color: 'blue' },
    }),
  );
});

void test('render/inspect category payloads support All, none and Uncategorized', () => {
  validateCommand({
    name: 'construction.inspect',
    payload: { categories: [null, 'Drywall hang/finish'] },
  });
  for (const name of ['sheet.render', 'construction.render']) {
    const command = registry.find((entry) => entry.name === name);
    assert.ok(command);
    const payload =
      name === 'sheet.render'
        ? { sheetId: 's', path: 'a.png' }
        : { path: 'a.png' };
    validatePayload(command.schema, {
      ...payload,
      categories: [null, 'Drywall hang/finish'],
    });
    validatePayload(command.schema, { ...payload, categories: [] });
  }
});

void test('parallel strokes offset in display coordinates without changing authored points', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  assert.deepEqual(offsetStroke(points, 2, false), [
    { x: 0, y: 2 },
    { x: 8, y: 2 },
    { x: 8, y: 10 },
  ]);
  assert.deepEqual(points, [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]);
  assert.ok(
    offsetStroke(
      [
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      2,
      false,
    ).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
  );
});
