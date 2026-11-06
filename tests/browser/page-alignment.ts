import { expect, type Locator, type Page } from '@playwright/test';
import type { Project } from '../../src/core/types';
import { cli, startWingmanProject } from './wingman';

export async function alignmentMutation(
  page: Page,
  name: string,
  payload: unknown,
) {
  const observed = (await cli<Project>(page, 'project.inspect')).response;
  const result = await page.evaluate(
    async ({ name, request }) => {
      const bridge = window as unknown as {
        wingmanCli(
          name: string,
          request: unknown,
        ): Promise<{ response: { ok: boolean; error?: unknown } }>;
      };
      return bridge.wingmanCli(name, request);
    },
    {
      name,
      request: {
        projectId: observed.projectId,
        expectedRevision: observed.revision,
        payload,
      },
    },
  );
  expect(result.response.ok, JSON.stringify(result.response)).toBe(true);
}

export async function alignmentFixture(page: Page) {
  await startWingmanProject(page, true);
  const project = (await cli<Project>(page, 'project.inspect')).response.data;
  const first = Object.values(project.sheets)[0];
  if (!first) throw new Error('Missing imported sheet');
  const sheets = [
    { ...first, name: 'Wall plan', calibration: { metresPerUnit: 0.1 } },
    {
      ...first,
      id: 'ceiling-plan',
      name: 'Ceiling plan',
      calibration: { metresPerUnit: 0.1 },
    },
  ];
  for (const sheet of sheets) await alignmentMutation(page, 'sheet.put', sheet);
  for (const [index, sheet] of sheets.entries()) {
    const geometryId = `alignment-wall-${String(index)}`;
    await alignmentMutation(page, 'geometry.put', {
      id: geometryId,
      name: geometryId,
      sheetId: sheet.id,
      kind: 'path',
      points: [
        { x: 20 + index * 50, y: 40 + index * 50 },
        { x: 120 + index * 50, y: 40 + index * 50 },
      ],
    });
    await alignmentMutation(page, 'wall.put', {
      id: geometryId,
      geometryId,
      baseElevation: 0,
      height: 3,
      studSpacing: 1,
      stud: { materialId: 'stud', width: 0.04, depth: 0.09 },
      track: { materialId: 'track', width: 0.04, depth: 0.09 },
      finishes: [],
    });
  }
  return sheets;
}

interface RenderMetadata {
  sheetIds: string[];
  alignment: 'saved' | 'none';
  appliedAlignments: Record<
    string,
    { offset: { x: number; y: number }; rotation: number }
  >;
  displayedObjects: number;
  camera: { target: { x: number; y: number; z: number }; span: number };
}

export async function alignmentRenderWorkflow(
  page: Page,
  sheets: Project['sheets'][string][],
) {
  const first = sheets[0];
  const second = sheets[1];
  if (!first || !second) throw new Error('Two sheets required');
  const render = async (payload: Record<string, unknown>) => {
    const result = await cli<RenderMetadata>(page, 'construction.render', {
      path: '/tmp/page-alignment.png',
      width: 400,
      height: 300,
      view: 'top',
      ...payload,
    });
    expect(result.response.ok, JSON.stringify(result.response)).toBe(true);
    return result.response.data;
  };
  const original = await render({ sheetIds: [second.id] });
  await alignmentMutation(page, 'construction.alignment.put', {
    sheetId: second.id,
    offset: { x: -5, y: 5 },
    rotation: 0,
  });
  const saved = (await cli<Project>(page, 'project.inspect')).response;
  const single = await render({ sheetIds: [second.id] });
  expect(single.camera).toEqual(original.camera);
  expect(single.appliedAlignments).toEqual({});
  const combined = await render({
    sheetIds: [first.id, second.id],
    geometryIds: ['alignment-wall-1'],
  });
  expect(combined.displayedObjects).toBe(single.displayedObjects);
  expect(combined.camera.target.x).toBeCloseTo(single.camera.target.x - 5);
  expect(combined.camera.target.y).toBeCloseTo(single.camera.target.y + 5);
  expect(combined.camera.span).toBeCloseTo(single.camera.span);
  expect(combined.appliedAlignments[second.id]?.offset).toEqual({
    x: -5,
    y: 5,
  });
  const raw = await render({
    sheetIds: [first.id, second.id],
    geometryIds: ['alignment-wall-1'],
    alignment: 'none',
  });
  expect(raw.camera).toEqual(single.camera);
  expect((await render({ sheetIds: [] })).displayedObjects).toBe(0);
  const invalid = await cli(page, 'construction.render', {
    path: '/tmp/invalid.png',
    sheetIds: ['missing'],
  });
  expect(invalid.response.ok).toBe(false);
  const final = (await cli<Project>(page, 'project.inspect')).response;
  expect(final.revision).toBe(saved.revision);
  expect(final.data.geometries).toEqual(saved.data.geometries);
}

async function pickPagePoint(canvas: Locator, x: number, y: number) {
  const position = await canvas.evaluate(
    (element, point) => {
      const bounds = element.getBoundingClientRect();
      return {
        clientX:
          bounds.x +
          Number(element.getAttribute('data-camera-x')) +
          point.x * Number(element.getAttribute('data-camera-zoom')),
        clientY:
          bounds.y +
          Number(element.getAttribute('data-camera-y')) +
          point.y * Number(element.getAttribute('data-camera-zoom')),
      };
    },
    { x, y },
  );
  const pointer = {
    ...position,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    shiftKey: true,
  };
  await canvas.evaluate((element, pointer) => {
    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        ...pointer,
        bubbles: true,
        buttons: 1,
      }),
    );
    element.dispatchEvent(
      new PointerEvent('pointerup', { ...pointer, bubbles: true, buttons: 0 }),
    );
  }, pointer);
}

export async function alignmentDesktopWorkflow(
  page: Page,
  sheets: Project['sheets'][string][],
) {
  const first = sheets[0];
  const second = sheets[1];
  if (!first || !second) throw new Error('Two sheets required');
  await page.getByLabel('Workspace view', { exact: true }).selectOption('3d');
  const viewer = page.getByRole('region', { name: '3D construction viewer' });
  const scope = viewer.getByLabel('3D page scope', { exact: true });
  await expect(scope).toHaveValue('current');
  await expect(viewer).toContainText('13 objects shown');
  await scope.selectOption('combined');
  await expect(viewer).toContainText('26 objects shown');
  await viewer.locator('summary').filter({ hasText: 'Pages (' }).click();
  await viewer.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(viewer).toContainText('0 objects shown');
  await viewer
    .getByRole('checkbox', { name: second.name, exact: true })
    .check();
  await expect(viewer).toContainText('13 objects shown');
  await viewer.getByRole('button', { name: 'All', exact: true }).click();
  await expect(viewer).toContainText('26 objects shown');
  await viewer.locator('summary').filter({ hasText: 'Pages (' }).click();
  const before = (await cli<Project>(page, 'project.inspect')).response;
  const alignmentMode = viewer.getByRole('combobox', {
    name: 'Alignment',
    exact: true,
  });
  await alignmentMode.selectOption('none');
  await viewer
    .getByRole('button', { name: 'Align pages', exact: true })
    .click();
  const editor = page.getByRole('dialog', {
    name: 'Align pages in combined 3D',
    exact: true,
  });
  await editor.getByLabel('X offset (m)', { exact: true }).fill('7');
  await editor.getByLabel('Rotation (degrees)', { exact: true }).fill('90');
  expect((await cli<Project>(page, 'project.inspect')).response.revision).toBe(
    before.revision,
  );
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(alignmentMode).toHaveValue('none');
  expect(
    (await cli<Project>(page, 'project.inspect')).response.data.sheets,
  ).toEqual(before.data.sheets);

  await viewer
    .getByRole('button', { name: 'Align pages', exact: true })
    .click();
  await editor
    .getByRole('combobox', { name: 'Moving page', exact: true })
    .selectOption(second.id);
  await editor
    .getByRole('combobox', { name: 'Reference page', exact: true })
    .selectOption(first.id);
  await editor
    .getByRole('button', { name: 'Pick reference points', exact: true })
    .click();
  const canvas = editor.getByLabel('Drawing canvas', { exact: true });
  await expect(canvas).toHaveAttribute('data-sheet-id', second.id);
  await expect(canvas).toHaveAttribute('aria-busy', 'false');
  await pickPagePoint(canvas, 70, 90);
  await expect(editor).toContainText('moving page point 2');
  await pickPagePoint(canvas, 170, 90);
  await expect(canvas).toHaveAttribute('data-sheet-id', first.id);
  await expect(canvas).toHaveAttribute('aria-busy', 'false');
  await pickPagePoint(canvas, 20, 40);
  await expect(editor).toContainText('reference page point 2');
  await pickPagePoint(canvas, 20, 140);
  await expect(editor).toContainText('Maximum residual: 0.0000 m');
  await expect(
    editor.getByLabel('Rotation (degrees)', { exact: true }),
  ).toHaveValue('-90');
  await editor
    .getByRole('button', { name: 'Apply alignment', exact: true })
    .click();
  await expect(editor).toBeHidden();
  const aligned = (await cli<Project>(page, 'project.inspect')).response;
  expect(aligned.revision).toBe(before.revision + 1);
  const transform = aligned.data.sheets[second.id]?.combined3dAlignment;
  expect(transform?.rotation).toBeCloseTo(-Math.PI / 2);
  expect(transform?.offset.x).toBeCloseTo(11);
  expect(transform?.offset.y).toBeCloseTo(3);
  expect(aligned.data.geometries).toEqual(before.data.geometries);
  await scope.selectOption('current');
  await expect(viewer).toContainText('13 objects shown');
  // A reference calibration is needed for matching, not numeric entry or reset.
  const uncalibrated = { ...first };
  Reflect.deleteProperty(uncalibrated, 'calibration');
  await alignmentMutation(page, 'sheet.put', uncalibrated);
  await scope.selectOption('combined');
  await viewer
    .getByRole('button', { name: 'Align pages', exact: true })
    .click();
  await editor
    .getByRole('combobox', { name: 'Moving page', exact: true })
    .selectOption(second.id);
  await expect(
    editor.getByRole('button', { name: 'Pick reference points', exact: true }),
  ).toBeDisabled();
  await editor.getByLabel('X offset (m)', { exact: true }).fill('12');
  await editor
    .getByRole('button', { name: 'Apply alignment', exact: true })
    .click();
  await expect(editor).toBeHidden();
  expect(
    (await cli<Project>(page, 'project.inspect')).response.data.sheets[
      second.id
    ]?.combined3dAlignment?.offset.x,
  ).toBe(12);
  await viewer
    .getByRole('button', { name: 'Align pages', exact: true })
    .click();
  await editor
    .getByRole('combobox', { name: 'Moving page', exact: true })
    .selectOption(second.id);
  await editor
    .getByRole('button', { name: 'Reset alignment', exact: true })
    .click();
  await editor
    .getByRole('button', { name: 'Apply alignment', exact: true })
    .click();
  await expect(editor).toBeHidden();
  expect(
    (await cli<Project>(page, 'project.inspect')).response.data.sheets[
      second.id
    ]?.combined3dAlignment,
  ).toBeUndefined();
}
