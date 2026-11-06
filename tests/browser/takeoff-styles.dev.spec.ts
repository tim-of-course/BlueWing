import { expect, test } from '@playwright/test';
import type * as PainterModule from '../../src/components/canvas/paint';
import type * as CoreModule from '../../src/core';
import type * as TakeoffModule from '../../src/core/takeoffs';
import type * as SceneModule from '../../src/three/scene';
import type * as RendererModule from '../../src/three/renderer';

test('deductions preserve colors with dashed plan strokes and hatched 3D members and surfaces', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const painterPath = '/src/components/canvas/paint.ts';
    const corePath = '/src/core/index.ts';
    const takeoffPath = '/src/core/takeoffs.ts';
    const scenePath = '/src/three/scene.ts';
    const rendererPath = '/src/three/renderer.ts';
    const { paintTakeoff } = (await import(
      painterPath
    )) as typeof PainterModule;
    const { createProject, executeCommand, calculateProject } = (await import(
      corePath
    )) as typeof CoreModule;
    const { takeoffProject } = (await import(
      takeoffPath
    )) as typeof TakeoffModule;
    const { buildConstructionScene, constructionSceneInput, viewPresets } =
      (await import(scenePath)) as typeof SceneModule;
    const { acquireConstructionSnapshot } = (await import(
      rendererPath
    )) as typeof RendererModule;
    const canvas = () => {
      const element = document.createElement('canvas');
      element.width = 400;
      element.height = 240;
      return element;
    };
    const context = (element: HTMLCanvasElement) => {
      const ctx = element.getContext('2d');
      if (!ctx) throw new Error('Missing test canvas context');
      return ctx;
    };
    const pixels = (element: HTMLCanvasElement) =>
      context(element).getImageData(0, 0, element.width, element.height).data;
    const count = (
      data: Uint8ClampedArray,
      predicate: (r: number, g: number, b: number, a: number) => boolean,
    ) => {
      let total = 0;
      for (let i = 0; i < data.length; i += 4)
        if (
          predicate(
            data[i] ?? 0,
            data[i + 1] ?? 0,
            data[i + 2] ?? 0,
            data[i + 3] ?? 0,
          )
        )
          total++;
      return total;
    };
    const plan = (deduct: boolean, selected = false) => {
      const element = canvas();
      paintTakeoff(
        context(element),
        [
          {
            id: 'path',
            sheetId: 's',
            name: 'Path',
            kind: 'path',
            points: [
              { x: 20, y: 30 },
              { x: 360, y: 30 },
            ],
          },
          {
            id: 'area',
            sheetId: 's',
            name: 'Area',
            kind: 'area',
            points: [
              { x: 20, y: 70 },
              { x: 180, y: 70 },
              { x: 180, y: 190 },
              { x: 20, y: 190 },
            ],
          },
          {
            id: 'count',
            sheetId: 's',
            name: 'Count',
            kind: 'count',
            points: [
              { x: 250, y: 110 },
              { x: 310, y: 110 },
            ],
          },
        ],
        {
          colors: { path: '#b71942', area: '#b71942', count: '#b71942' },
          deductionIds: deduct ? ['path', 'area', 'count'] : [],
          selectedIds: selected ? ['path', 'area', 'count'] : [],
        },
      );
      return count(
        pixels(element),
        (r, g, b, a) =>
          a > 200 &&
          (selected
            ? r === 96 && g === 165 && b === 250
            : r === 183 && g === 25 && b === 66),
      );
    };
    let project = createProject('Style');
    project.sheets.s = {
      id: 's',
      name: 'Plan',
      assetId: 'pdf',
      pageIndex: 0,
      width: 100,
      height: 100,
      calibration: { metresPerUnit: 1 },
    };
    const call = (name: string, payload: unknown) => {
      project = executeCommand(project, { name, payload }).project;
    };
    call('geometry.put', {
      id: 'g',
      name: 'Wall',
      sheetId: 's',
      kind: 'path',
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
      ],
    });
    call('wall.put', {
      id: 'wall',
      geometryId: 'g',
      baseElevation: 0,
      height: 3,
      studSpacing: 0.4,
      stud: { materialId: 'steel', width: 0.04, depth: 0.09 },
      track: { materialId: 'steel', width: 0.04, depth: 0.09 },
      finishes: [
        {
          id: 'finish',
          materialId: 'gypsum',
          face: 'front',
          layers: 1,
          thickness: 0.0127,
        },
      ],
    });
    call('takeoff.create', {
      id: 'co',
      name: 'Deduction',
      kind: 'change-order',
    });
    project = executeCommand(project, {
      name: 'takeoff.copyItems',
      takeoffId: 'co',
      payload: {
        sourceTakeoffId: 'main',
        geometryIds: ['g'],
        direction: 'deduct',
      },
    }).project;
    const snapshot = acquireConstructionSnapshot();
    const render = (id: string, displayMode: 'solid' | 'framing') => {
      const element = canvas();
      const calculation = calculateProject(takeoffProject(project, id));
      const scene = buildConstructionScene(
        constructionSceneInput(calculation.model),
      );
      snapshot.render(element, scene, {
        width: 400,
        height: 240,
        pixelRatio: 1,
        displayMode,
        camera: {
          ...viewPresets.front,
          zoom: 1,
          target: { x: 1.5, y: 0, z: 1.5 },
          span: 4,
        },
      });
      const data = pixels(element);
      return {
        colored: count(
          data,
          (r, g, b, a) => a > 200 && (r !== 237 || g !== 241 || b !== 245),
        ),
        palette: [
          ...new Set(
            Array.from(
              { length: data.length / 4 },
              (_, i) =>
                `${String(data[i * 4])},${String(data[i * 4 + 1])},${String(data[i * 4 + 2])}`,
            ),
          ),
        ],
      };
    };
    const solid = render('main', 'solid'),
      deduction = render('co', 'solid');
    const framing = render('main', 'framing'),
      framingDeduction = render('co', 'framing');
    snapshot.dispose();
    return {
      plan: plan(false),
      dashed: plan(true),
      selected: plan(false, true),
      selectedDashed: plan(true, true),
      solid,
      deduction,
      framing,
      framingDeduction,
    };
  });
  expect(result.dashed).toBeGreaterThan(0);
  expect(result.dashed).toBeLessThan(result.plan);
  expect(result.selectedDashed).toBeGreaterThan(0);
  expect(result.selectedDashed).toBeLessThan(result.selected);
  for (const [base, deduction] of [
    [result.solid, result.deduction],
    [result.framing, result.framingDeduction],
  ] as const) {
    expect(deduction.colored).toBeGreaterThan(base.colored * 0.25);
    // Thin framing retains solid silhouette edges; hatching still removes interior pixels.
    expect(deduction.colored).toBeLessThan(base.colored * 0.99);
    expect(
      deduction.palette.some(
        (color) => color !== '237,241,245' && base.palette.includes(color),
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
