import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateProject, pieceSchedule } from '../../src/core/calculations';
import type { CalculationSnapshot } from '../../src/core/calculation-state';
import type { ConstructionResult } from '../../src/core/construction-types';
import { ProjectSession } from '../../src/core/session';
import type {
  CalculationResult,
  CommandCall,
  Project,
} from '../../src/core/types';

const ft = 0.3048;
const areaFormula = 'length * height * layers';
type Quantities = Omit<CalculationResult, 'model'>;

function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

function near(actual: number, expected: number) {
  assert.ok(
    Math.abs(actual - expected) < 1e-7,
    `${String(actual)} != ${String(expected)}`,
  );
}

function baseProject(): Project {
  return {
    formatVersion: 4,
    id: 'reuse-project',
    name: 'Calculation reuse',
    revision: 0,
    sheets: {
      plan: {
        id: 'plan',
        name: 'A1',
        assetId: 'pdf',
        pageIndex: 0,
        order: 0,
        width: 100,
        height: 100,
        calibration: { metresPerUnit: 1 },
      },
    },
    geometries: {},
    groups: {},
    recipes: {},
    assignments: {},
  };
}

function modeledProject(): Project {
  const project = baseProject();
  project.geometries.wall = {
    id: 'wall',
    name: 'North partition',
    sheetId: 'plan',
    kind: 'path',
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ],
  };
  project.geometries.room = {
    id: 'room',
    name: 'Office ceiling',
    sheetId: 'plan',
    kind: 'area',
    points: [
      { x: 0, y: 0 },
      { x: 8 * ft, y: 0 },
      { x: 8 * ft, y: 8 * ft },
      { x: 0, y: 8 * ft },
    ],
  };
  project.groups.walls = {
    id: 'walls',
    name: 'Partitions',
    color: '#112233',
    geometryIds: ['wall'],
  };
  project.groups.ceilings = {
    id: 'ceilings',
    name: 'Ceilings',
    geometryIds: ['room'],
  };
  project.recipes.wall = {
    id: 'wall',
    name: 'Partition assembly',
    geometryKinds: ['path'],
    inputs: [],
    outputs: [],
    wallTemplate: {
      height: 3,
      baseElevation: 0,
      studSpacing: 1,
      stud: { materialId: 'stud', width: 0.04, depth: 0.09, stockLength: 5 },
      track: { materialId: 'track', width: 0.09, depth: 0.03, stockLength: 10 },
      finishes: [
        { id: 'board', materialId: 'board', face: 'front', layers: 2 },
      ],
    },
  };
  project.recipes.ceiling = {
    id: 'ceiling',
    name: 'Office ACT',
    geometryKinds: ['area'],
    inputs: [],
    outputs: [],
    ceilingTemplate: {
      elevation: 3,
      materialId: 'tile',
      layers: 1,
      grid: {
        system: '2x2',
        origin: { x: 0, y: 0 },
        rotation: 0,
        main: {
          materialId: 'main',
          width: 0.02,
          depth: 0.04,
          stockLength: 12 * ft,
        },
        crossTee4: {
          materialId: 'tee4',
          width: 0.02,
          depth: 0.04,
          stockLength: 4 * ft,
        },
        crossTee2: {
          materialId: 'tee2',
          width: 0.02,
          depth: 0.04,
          stockLength: 2 * ft,
        },
        wallAngle: {
          materialId: 'angle',
          width: 0.02,
          depth: 0.02,
          stockLength: 10 * ft,
        },
      },
    },
  };
  project.assignments.wall = {
    id: 'wall',
    groupId: 'walls',
    recipeId: 'wall',
    inputs: {},
    allowances: {},
    wallOverrides: { levelId: 'ground' },
  };
  project.assignments.ceiling = {
    id: 'ceiling',
    groupId: 'ceilings',
    recipeId: 'ceiling',
    inputs: {},
    allowances: {},
    ceilingOverrides: { levelId: 'ground' },
  };
  project.construction = {
    openings: {},
    placements: {},
    levels: { ground: { id: 'ground', name: 'Ground floor', elevation: 0 } },
    headers: {
      door: {
        id: 'door',
        name: 'Door header',
        components: [
          {
            id: 'web',
            role: 'header-web',
            member: {
              materialId: 'header',
              width: 0.09,
              depth: 0.03,
              stockLength: 5,
            },
            startExtension: 0,
            endExtension: 0,
            verticalOffset: 0.015,
            faceOffset: 0,
          },
        ],
      },
    },
  };
  return project;
}

function formulaProject(): Project {
  const project = baseProject();
  required(project.sheets.plan).calibration = { metresPerUnit: ft };
  for (const [id, length] of [
    ['wall', 24],
    ['return', 12],
  ] as const)
    project.geometries[id] = {
      id,
      name: id,
      sheetId: 'plan',
      kind: 'path',
      points: [
        { x: 0, y: 0 },
        { x: length, y: 0 },
      ],
    };
  project.groups.walls = {
    id: 'walls',
    name: 'Estimate',
    geometryIds: ['wall'],
  };
  project.recipes.estimate = {
    id: 'estimate',
    name: 'Wall estimate',
    geometryKinds: ['path'],
    inputs: [
      { name: 'height', type: 'number', unit: 'ft', default: 8 },
      { name: 'layers', type: 'number', unit: 'scalar', default: 2 },
      { name: 'spacing', type: 'number', unit: 'in', default: 16 },
      { name: 'stock', type: 'number', unit: 'ft', default: 10 },
    ],
    outputs: [
      {
        id: 'area',
        name: 'Board estimate',
        materialId: 'estimated-board',
        unit: 'ft2',
        formula: areaFormula,
        allowance: { wastePercent: 10, packageSize: 32 },
      },
      {
        id: 'studs',
        name: 'Stud estimate',
        materialId: 'estimated-stud',
        unit: 'ea',
        formula: 'ceil(length / spacing) + 1',
        allowance: { wastePercent: 0 },
        piece: {
          role: 'stud',
          cutLength: { formula: 'height', unit: 'ft' },
          stockLength: { formula: 'stock', unit: 'ft' },
        },
      },
    ],
  };
  project.assignments.estimate = {
    id: 'estimate',
    groupId: 'walls',
    recipeId: 'estimate',
    inputs: {},
    allowances: {},
  };
  return project;
}

function fixture(project: Project) {
  const saves: { before: Project; after: Project }[] = [];
  let fail = false;
  const session = new ProjectSession(project, {
    save: (before, after) => {
      if (fail) return Promise.reject(new Error('disk full'));
      saves.push({ before, after });
      return Promise.resolve();
    },
  });
  return {
    session,
    saves,
    fail: (value: boolean) => {
      fail = value;
    },
  };
}

function dispatch(session: ProjectSession, call: CommandCall) {
  return session.dispatch({ ...call, ...session.observation, origin: 'cli' });
}

function material(result: CalculationSnapshot, materialId: string) {
  return required(
    result.outputs.find((output) => output.materialId === materialId),
  );
}

async function change(session: ProjectSession, call: CommandCall) {
  const before = session.calculation;
  await dispatch(session, call);
  const after = session.calculation;
  assert.notEqual(after, before, call.name);
  assert.deepEqual(after, calculateProject(session.project), call.name);
  assert.equal(after.complete, true, JSON.stringify(after.model.diagnostics));
  return after;
}

function assertFrozen(value: unknown) {
  if (value && typeof value === 'object') {
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) assertFrozen(child);
  }
}

async function countAreaParses<T>(
  operation: (count: () => number) => Promise<T>,
) {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Restore the method and invoke it with .call.
  const slice = String.prototype.slice;
  let count = 0;
  String.prototype.slice = function (start, end) {
    if (start === 0 && this.valueOf() === areaFormula) count++;
    return slice.call(this, start, end);
  };
  try {
    return await operation(() => count);
  } finally {
    String.prototype.slice = slice;
  }
}

void test('session snapshots share deeply frozen modeled pieces and formula sources', () => {
  for (const project of [modeledProject(), formulaProject()]) {
    const { session } = fixture(project);
    const snapshot = session.calculation;
    assert.equal(session.calculation, snapshot);
    assert.deepEqual(snapshot, calculateProject(project));
    assertFrozen(snapshot);
    assert.equal(
      Reflect.set(required(snapshot.totals[0]), 'amount', -1),
      false,
    );
  }
  const modeled = fixture(modeledProject()).session.calculation;
  assert.equal(
    modeled.model.pieces.filter((piece) => piece.role === 'stud').length,
    5,
  );
  assert.equal(
    modeled.model.pieces.filter((piece) => piece.role.endsWith('track')).length,
    2,
  );
  for (const [role, count] of [
    ['ceiling-main', 1],
    ['ceiling-tee-4ft', 6],
    ['ceiling-tee-2ft', 8],
    ['ceiling-wall-angle', 4],
  ] as const)
    assert.equal(
      modeled.model.pieces.filter((piece) => piece.role === role).length,
      count,
    );
  near(material(modeled, 'board').baseAmount, 24 / ft ** 2);
  near(material(modeled, 'tile').baseAmount, 64);
  assert.equal(modeled.coverage.complete, true);
  const estimated = fixture(formulaProject()).session.calculation;
  near(material(estimated, 'estimated-board').baseAmount, 384);
  near(material(estimated, 'estimated-board').purchasedAmount, 448);
  assert.equal(material(estimated, 'estimated-stud').baseAmount, 19);
  assert.deepEqual(estimated.model.pieces, []);
  assert.equal(estimated.coverage.estimateOutputs, 2);
  assert.equal(estimated.coverage.complete, false);
});

void test('names, color, sheet order and review edits preserve the snapshot and use current export labels', async () => {
  const { session } = fixture(modeledProject());
  const snapshot = session.calculation;
  const snippet = {
    id: 'detail',
    name: 'Partition detail',
    sheetId: 'plan',
    bounds: { x: 0, y: 0, width: 10, height: 10 },
    sources: [{ kind: 'wall', id: 'wall/wall' }],
    geometryIds: ['wall'],
    annotations: [],
    note: 'Check the head',
  };
  const calls: CommandCall[] = [
    { name: 'project.rename', payload: { name: 'Accepted estimate' } },
    {
      name: 'group.put',
      payload: {
        ...session.project.groups.walls,
        name: 'Level 1 partitions',
        color: '#abcdef',
      },
    },
    {
      name: 'sheet.put',
      payload: {
        ...session.project.sheets.plan,
        name: 'A101 revised',
        order: 7,
      },
    },
    {
      name: 'geometry.put',
      payload: {
        ...session.project.geometries.wall,
        name: 'North partition revised',
      },
    },
    { name: 'snippet.put', payload: snippet },
    {
      name: 'review.mark',
      payload: {
        id: 'checked',
        target: { kind: 'wall', id: 'wall/wall' },
        status: 'reviewed',
        note: 'Checked',
      },
    },
    { name: 'snippet.put', payload: { ...snippet, note: 'Head confirmed' } },
    { name: 'snippet.delete', payload: { id: 'detail' } },
  ];
  for (const call of calls) {
    await dispatch(session, call);
    assert.equal(session.calculation, snapshot, call.name);
    assert.deepEqual(snapshot, calculateProject(session.project), call.name);
  }
  const pieces = (await dispatch(session, { name: 'pieces.inspect' }))
    .data as ReturnType<typeof pieceSchedule>;
  const row = required(pieces.find((piece) => piece.geometryId === 'wall'));
  assert.equal(row.sheet, 'A101 revised');
  assert.equal(row.group, 'Level 1 partitions');
  assert.equal(row.location, 'North partition revised');
  for (const format of ['csv', 'json']) {
    const exported = (
      await dispatch(session, { name: 'pieces.export', payload: { format } })
    ).data as string;
    assert.match(exported, /A101 revised/);
    assert.match(exported, /Level 1 partitions/);
    assert.match(exported, /North partition revised/);
  }
  const construction = JSON.parse(
    (
      await dispatch(session, {
        name: 'construction.export',
        payload: { format: 'json' },
      })
    ).data as string,
  ) as { revision: number };
  assert.equal(construction.revision, session.project.revision);
  for (const name of ['history.undo', 'history.redo'])
    for (let i = 0; i < calls.length; i++) {
      await dispatch(session, { name });
      assert.equal(session.calculation, snapshot, name);
      assert.deepEqual(snapshot, calculateProject(session.project));
    }
});

void test('modeled edits refresh geometry, calibration, assignments, templates, openings and world placement', async () => {
  const { session } = fixture(modeledProject());
  let result = await change(session, {
    name: 'geometry.put',
    payload: {
      ...session.project.geometries.wall,
      points: [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
      ],
    },
  });
  assert.equal(
    result.model.pieces.filter((piece) => piece.role === 'stud').length,
    7,
  );
  near(material(result, 'board').baseAmount, 36 / ft ** 2);
  result = await change(session, {
    name: 'sheet.put',
    payload: {
      ...session.project.sheets.plan,
      calibration: { metresPerUnit: 0.5 },
    },
  });
  assert.equal(
    result.model.pieces.filter((piece) => piece.role === 'stud').length,
    4,
  );
  near(material(result, 'board').baseAmount, 18 / ft ** 2);
  near(material(result, 'tile').baseAmount, 16);
  result = await change(session, {
    name: 'assignment.put',
    payload: {
      ...session.project.assignments.wall,
      wallOverrides: { levelId: 'ground', height: 4 },
    },
  });
  near(material(result, 'board').baseAmount, 24 / ft ** 2);
  for (const stud of result.model.pieces.filter(
    (piece) => piece.role === 'stud',
  ))
    near(stud.cutLength, 4);
  const recipe = required(session.project.recipes.wall);
  const template = required(recipe.wallTemplate);
  result = await change(session, {
    name: 'assembly.put',
    payload: {
      ...recipe,
      name: 'Revised partition',
      wallTemplate: {
        ...template,
        studSpacing: 0.75,
        stud: { ...template.stud, materialId: 'revised-stud' },
        finishes: [{ ...required(template.finishes?.[0]), layers: 1 }],
      },
    },
  });
  assert.equal(
    result.model.pieces.filter((piece) => piece.role === 'stud').length,
    5,
  );
  assert.equal(material(result, 'revised-stud').name, 'Revised partition');
  near(material(result, 'board').baseAmount, 12 / ft ** 2);
  const labels = (
    await dispatch(session, {
      name: 'quantities.export',
      payload: { format: 'csv' },
    })
  ).data as string;
  assert.match(labels, /Revised partition/);
  result = await change(session, {
    name: 'opening.put',
    payload: {
      id: 'door',
      wallId: 'wall/wall',
      distance: 1,
      width: 1,
      sill: 0,
      height: 2,
      jambCount: 1,
      headerId: 'door',
    },
  });
  near(material(result, 'board').baseAmount, 10 / ft ** 2);
  near(
    required(result.model.pieces.find((piece) => piece.role === 'header-web'))
      .cutLength,
    1,
  );
  result = await change(session, {
    name: 'level.put',
    payload: { id: 'ground', name: 'Ground floor', elevation: 2 },
  });
  near(
    required(result.model.pieces.find((piece) => piece.role === 'stud')).start
      .z,
    2,
  );
  near(
    required(
      result.model.surfaces.find((surface) => surface.face === 'ceiling'),
    ).points[0]?.z ?? NaN,
    5,
  );
  result = await change(session, {
    name: 'placement.put',
    payload: {
      id: 'position',
      sheetId: 'plan',
      pageOrigin: { x: 0, y: 0 },
      worldOffset: { x: 10, y: 20, z: 1 },
      rotation: Math.PI / 2,
    },
  });
  const stud = required(
    result.model.pieces.find((piece) => piece.role === 'stud'),
  );
  near(stud.start.x, 10);
  near(stud.start.y, 20);
  near(stud.start.z, 3);
  near(stud.cutLength, 4);
  near(material(result, 'board').baseAmount, 10 / ft ** 2);
  result = await change(session, {
    name: 'group.members',
    payload: { id: 'walls', geometryIds: [] },
  });
  assert.ok(
    result.model.pieces.every((piece) => piece.assignmentId === 'ceiling'),
  );
  assert.ok(
    result.outputs.every((output) => output.assignmentId === 'ceiling'),
  );
  near(material(result, 'tile').baseAmount, 16);
  assert.deepEqual(session.project.construction?.openings, {});
});

void test('formula membership, input and output edits refresh amounts, purchasing and labels', async () => {
  const { session } = fixture(formulaProject());
  let result = await change(session, {
    name: 'group.put',
    payload: {
      ...session.project.groups.walls,
      geometryIds: ['wall', 'return'],
    },
  });
  near(material(result, 'estimated-board').baseAmount, 576);
  near(material(result, 'estimated-board').purchasedAmount, 640);
  assert.equal(material(result, 'estimated-stud').baseAmount, 29);
  result = await change(session, {
    name: 'assignment.put',
    payload: {
      ...session.project.assignments.estimate,
      geometryInputs: { return: { height: 10 } },
      allowances: { area: { wastePercent: 0, packageSize: 32 } },
    },
  });
  near(material(result, 'estimated-board').baseAmount, 624);
  near(material(result, 'estimated-board').purchasedAmount, 640);
  const recipe = required(session.project.recipes.estimate);
  result = await change(session, {
    name: 'recipe.put',
    payload: {
      ...recipe,
      name: 'Revised estimate',
      outputs: recipe.outputs.map((output) =>
        output.id === 'area'
          ? {
              ...output,
              name: 'Single-layer board',
              formula: `${areaFormula} / 2`,
            }
          : output,
      ),
    },
  });
  near(material(result, 'estimated-board').baseAmount, 312);
  near(material(result, 'estimated-board').purchasedAmount, 320);
  for (const format of ['csv', 'json']) {
    const exported = (
      await dispatch(session, {
        name: 'quantities.export',
        payload: { format },
      })
    ).data as string;
    assert.match(exported, /Single-layer board/);
    assert.doesNotMatch(exported, /Board estimate/);
  }
  const schedule = (await dispatch(session, { name: 'pieces.inspect' }))
    .data as ReturnType<typeof pieceSchedule>;
  assert.ok(schedule.every((piece) => piece.assembly === 'Revised estimate'));
});

void test('read and CSV/JSON export loops share one actual calculation, initialized lazily', async () => {
  await countAreaParses(async (count) => {
    const { session, saves } = fixture(formulaProject());
    assert.equal(count(), 0);
    await dispatch(session, { name: 'project.inspect' });
    assert.equal(count(), 0);
    const reads: CommandCall[] = [
      { name: 'quantities.inspect' },
      { name: 'pieces.inspect' },
      { name: 'construction.inspect' },
      ...['csv', 'json'].flatMap((format) => [
        { name: 'quantities.export', payload: { format } },
        { name: 'pieces.export', payload: { format } },
        { name: 'construction.export', payload: { format } },
      ]),
    ];
    // The first command must populate the same cache later accessed by the getter.
    await dispatch(session, required(reads[0]));
    assert.equal(count(), 1);
    const snapshot = session.calculation;
    for (let i = 0; i < 3; i++)
      for (const call of reads) {
        await dispatch(session, call);
        assert.equal(session.calculation, snapshot);
        assert.equal(count(), 1, call.name);
      }
    await dispatch(session, {
      name: 'project.rename',
      payload: { name: 'Renamed' },
    });
    await dispatch(session, { name: 'quantities.inspect' });
    assert.equal(count(), 1);
    assert.equal(saves.length, 1);
    await dispatch(session, {
      name: 'batch',
      payload: {
        commands: [
          {
            name: 'group.put',
            payload: {
              ...session.project.groups.walls,
              name: 'Renamed group',
              color: '#abcdef',
            },
          },
          { name: 'quantities.inspect' },
          { name: 'quantities.export', payload: { format: 'csv' } },
        ],
      },
    });
    assert.equal(session.calculation, snapshot);
    assert.equal(count(), 1);
    await dispatch(session, { name: 'history.undo' });
    await dispatch(session, { name: 'history.redo' });
    assert.equal(session.calculation, snapshot);
    assert.equal(count(), 1);
    await dispatch(session, {
      name: 'geometry.put',
      payload: {
        ...session.project.geometries.wall,
        points: [
          { x: 0, y: 0 },
          { x: 36, y: 0 },
        ],
      },
    });
    assert.equal(count(), 1);
    assert.notEqual(session.calculation, snapshot);
    assert.equal(count(), 2);
  });
});

void test('batch read/write/read sequences invalidate each draft edit and adopt the last calculation', async () => {
  const { session, saves } = fixture(formulaProject());
  await countAreaParses(async (count) => {
    const baseline = session.calculation;
    const wall = required(session.project.geometries.wall);
    const result = await dispatch(session, {
      name: 'batch',
      payload: {
        commands: [
          { name: 'quantities.inspect' },
          { name: 'pieces.inspect' },
          {
            name: 'geometry.put',
            payload: {
              ...wall,
              points: [
                { x: 0, y: 0 },
                { x: 36, y: 0 },
              ],
            },
          },
          { name: 'quantities.inspect' },
          { name: 'quantities.export', payload: { format: 'json' } },
          {
            name: 'geometry.put',
            payload: {
              ...wall,
              points: [
                { x: 0, y: 0 },
                { x: 48, y: 0 },
              ],
            },
          },
          { name: 'quantities.inspect' },
        ],
      },
    });
    const data = result.data as unknown[];
    for (const [index, amount] of [
      [0, 384],
      [3, 576],
      [6, 768],
    ] as const)
      near(
        required(
          (data[index] as Quantities).outputs.find(
            (output) => output.outputId === 'area',
          ),
        ).baseAmount,
        amount,
      );
    assert.deepEqual(JSON.parse(data[4] as string), data[3]);
    assert.equal(count(), 3);
    assert.notEqual(session.calculation, baseline);
    near(material(session.calculation, 'estimated-board').purchasedAmount, 864);
    assert.equal(count(), 3);
    assert.equal(saves.length, 1);
    assert.equal(session.history.undo.length, 1);
    assert.equal(result.project.revision, 1);
  });
  assert.deepEqual(session.calculation, calculateProject(session.project));
});

void test('pending saves expose the accepted cache and publish the draft cache only after saving', async () => {
  let releaseSave = () => {};
  let enteredSave = () => {};
  const saving = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const started = new Promise<void>((resolve) => {
    enteredSave = resolve;
  });
  const session = new ProjectSession(formulaProject(), {
    save: () => {
      enteredSave();
      return saving;
    },
  });
  let published: CalculationSnapshot | undefined;
  session.subscribe(() => {
    published = session.calculation;
  });
  await countAreaParses(async (count) => {
    const baseline = session.calculation;
    const operation = dispatch(session, {
      name: 'batch',
      payload: {
        commands: [
          {
            name: 'assignment.put',
            payload: {
              ...session.project.assignments.estimate,
              inputs: { height: 10 },
            },
          },
          { name: 'quantities.inspect' },
        ],
      },
    });
    await started;
    assert.equal(session.calculation, baseline);
    assert.equal(session.project.revision, 0);
    assert.equal(published, undefined);
    assert.equal(count(), 2);
    releaseSave();
    await operation;
    assert.notEqual(session.calculation, baseline);
    assert.equal(published, session.calculation);
    near(material(session.calculation, 'estimated-board').baseAmount, 480);
    assert.equal(count(), 2);
  });
});

void test('a cold calculation first read during a metadata save retains its identity after commit', async () => {
  let releaseSave = () => {};
  let enteredSave = () => {};
  const saving = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const started = new Promise<void>((resolve) => {
    enteredSave = resolve;
  });
  const session = new ProjectSession(formulaProject(), {
    save: () => {
      enteredSave();
      return saving;
    },
  });
  let published: CalculationSnapshot | undefined;
  session.subscribe(() => {
    published = session.calculation;
  });
  await countAreaParses(async (count) => {
    const operation = dispatch(session, {
      name: 'project.rename',
      payload: { name: 'Saved metadata' },
    });
    await started;
    assert.equal(count(), 0);
    const warmed = session.calculation;
    assert.equal(count(), 1);
    assert.equal(session.project.name, 'Calculation reuse');
    assert.equal(published, undefined);
    releaseSave();
    await operation;
    assert.equal(session.project.name, 'Saved metadata');
    assert.equal(session.calculation, warmed);
    assert.equal(published, warmed);
    assert.equal(count(), 1);
    await dispatch(session, { name: 'history.undo' });
    await dispatch(session, { name: 'history.redo' });
    assert.equal(session.calculation, warmed);
    assert.equal(count(), 1);
  });
});

void test('failed saves, final validation and previews preserve the accepted calculation and history', async () => {
  const f = fixture(formulaProject());
  const { session, saves } = f;
  const baseline = session.calculation;
  const initial = session.project;
  let publications = 0;
  session.subscribe(() => {
    publications++;
  });
  const commands: CommandCall[] = [
    {
      name: 'geometry.put',
      payload: {
        ...initial.geometries.wall,
        points: [
          { x: 0, y: 0 },
          { x: 48, y: 0 },
        ],
      },
    },
    { name: 'quantities.inspect' },
  ];
  f.fail(true);
  await assert.rejects(
    dispatch(session, { name: 'batch', payload: { commands } }),
    /disk full/,
  );
  assert.equal(session.calculation, baseline);
  assert.deepEqual(session.project, initial);
  f.fail(false);
  const invalid = [
    ...commands,
    {
      name: 'group.members',
      payload: { id: 'walls', geometryIds: ['missing'] },
    },
  ];
  for (const name of ['batch', 'preview']) {
    await assert.rejects(
      dispatch(session, { name, payload: { commands: invalid } }),
      /not found/,
    );
    assert.equal(session.calculation, baseline);
    assert.deepEqual(session.project, initial);
  }
  await assert.rejects(
    dispatch(session, {
      name: 'sheet.put',
      payload: { ...initial.sheets.plan, calibration: { metresPerUnit: -1 } },
    }),
    /metresPerUnit is outside its valid range/,
  );
  const preview = await countAreaParses(async (count) => {
    const result = await dispatch(session, {
      name: 'preview',
      payload: { commands },
    });
    assert.equal(count(), 1);
    assert.equal(session.calculation, baseline);
    assert.equal(count(), 1);
    return result;
  });
  near(
    required((preview.data as Quantities[])[1]).outputs[0]?.baseAmount ?? NaN,
    768,
  );
  const delta = required(
    preview.quantityChanges?.find(
      (item) => item.materialId === 'estimated-board',
    ),
  );
  assert.deepEqual([delta.before, delta.after, delta.delta], [448, 864, 416]);
  const studDelta = required(
    preview.quantityChanges?.find(
      (item) => item.materialId === 'estimated-stud',
    ),
  );
  assert.deepEqual(
    [studDelta.before, studDelta.after, studDelta.delta],
    [19, 37, 18],
  );
  const stockLength = required(studDelta.stockLength);
  near(stockLength.value, 10 * ft);
  assert.notEqual(
    stockLength,
    material(baseline, 'estimated-stud').stockLength,
  );
  assert.equal(Object.isFrozen(stockLength), false);
  assert.equal(Reflect.set(stockLength, 'value', 999), true);
  studDelta.after = -1;
  near(
    required(material(baseline, 'estimated-stud').stockLength).value,
    10 * ft,
  );
  near(
    required(
      (preview.data as Quantities[])[1]?.totals.find(
        (total) => total.materialId === 'estimated-stud',
      )?.stockLength,
    ).value,
    10 * ft,
  );
  assert.equal(preview.preview, true);
  assert.equal(session.calculation, baseline);
  assert.deepEqual(session.project, initial);
  assert.equal(saves.length, 0);
  assert.equal(publications, 0);
  assert.deepEqual(session.history, { undo: [], redo: [] });
  await dispatch(session, { name: 'batch', payload: { commands } });
  assert.notEqual(session.calculation, baseline);
  assert.deepEqual(session.calculation, calculateProject(session.project));
  near(
    required(material(session.calculation, 'estimated-stud').stockLength).value,
    10 * ft,
  );
});

void test('command quantity, construction and piece results remain mutable and isolated from the snapshot', async () => {
  const { session } = fixture(modeledProject());
  const snapshot = session.calculation;
  const quantityResult = await dispatch(session, {
    name: 'quantities.inspect',
  });
  const quantities = quantityResult.data as Quantities;
  assert.notEqual(quantities.outputs, snapshot.outputs);
  assert.equal(Object.isFrozen(quantities.outputs), false);
  required(quantities.outputs[0]).baseAmount = -1;
  required(quantities.outputs[0]?.sources[0]).inputs.layers = 99;
  required(quantities.totals[0]).amount = -1;
  quantityResult.project.name = 'tampered project';
  const construction = (
    await dispatch(session, { name: 'construction.inspect' })
  ).data as ConstructionResult;
  required(construction.pieces[0]).start.x = 999;
  required(construction.surfaces[0]?.points[0]).z = 999;
  required(construction.purchases[0]).pieceIds.length = 0;
  const pieces = (await dispatch(session, { name: 'pieces.inspect' }))
    .data as ReturnType<typeof pieceSchedule>;
  required(pieces[0]).group = 'tampered group';
  required(pieces[0]).quantity = -1;
  assert.equal(session.calculation, snapshot);
  assert.deepEqual(snapshot, calculateProject(session.project));
  const reread = (await dispatch(session, { name: 'quantities.inspect' }))
    .data as Quantities;
  assert.deepEqual(reread.outputs, snapshot.outputs);
  assert.deepEqual(reread.totals, snapshot.totals);
  assert.deepEqual(
    (await dispatch(session, { name: 'pieces.inspect' })).data,
    pieceSchedule(session.project, snapshot),
  );
  const exported = JSON.parse(
    (
      await dispatch(session, {
        name: 'construction.export',
        payload: { format: 'json' },
      })
    ).data as string,
  ) as ConstructionResult;
  // JSON represents both -0 and 0 as 0 in generated orientation vectors.
  assert.equal(
    JSON.stringify(exported.pieces),
    JSON.stringify(snapshot.model.pieces),
  );
  assert.equal(
    JSON.stringify(exported.surfaces),
    JSON.stringify(snapshot.model.surfaces),
  );
});

void test('mixed batch undo/redo recalculates, failed history saves retain the cache, and reopening starts a new cache', async () => {
  const f = fixture(formulaProject());
  const { session } = f;
  const baseline = session.calculation;
  await dispatch(session, {
    name: 'batch',
    payload: {
      commands: [
        { name: 'project.rename', payload: { name: 'Extended wall' } },
        {
          name: 'geometry.put',
          payload: {
            ...session.project.geometries.wall,
            points: [
              { x: 0, y: 0 },
              { x: 36, y: 0 },
            ],
          },
        },
        { name: 'quantities.inspect' },
      ],
    },
  });
  const extended = session.calculation;
  near(material(extended, 'estimated-board').baseAmount, 576);
  f.fail(true);
  await assert.rejects(
    dispatch(session, { name: 'history.undo' }),
    /disk full/,
  );
  assert.equal(session.calculation, extended);
  assert.equal(session.canUndo, true);
  assert.equal(session.canRedo, false);
  f.fail(false);
  const undone = await change(session, { name: 'history.undo' });
  assert.deepEqual(undone, baseline);
  assert.equal(session.project.name, 'Calculation reuse');
  f.fail(true);
  await assert.rejects(
    dispatch(session, { name: 'history.redo' }),
    /disk full/,
  );
  assert.equal(session.calculation, undone);
  assert.equal(session.canRedo, true);
  f.fail(false);
  const redone = await change(session, { name: 'history.redo' });
  assert.deepEqual(redone, extended);
  const reopened = fixture(session.project).session;
  assert.equal(reopened.canUndo, false);
  assert.equal(reopened.canRedo, false);
  assert.notEqual(reopened.calculation, redone);
  assert.equal(reopened.calculation, reopened.calculation);
  assert.deepEqual(reopened.calculation, redone);
});
