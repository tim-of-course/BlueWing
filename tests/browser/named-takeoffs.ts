import { expect, type Page } from '@playwright/test';
import { startWingmanProject } from './wingman';
import type { Project } from '../../src/core/types';
interface ReturnTypeOfCli {
  exitCode: number;
  response: { projectId: string; revision: number; data: unknown };
}

export async function namedTakeoffs(page: Page) {
  await startWingmanProject(page, true);
  const cli = (name: string, request: object = {}) =>
    page.evaluate(
      async ({ name, request }) => {
        const bridge = window as unknown as {
          wingmanCli(name: string, request: object): Promise<ReturnTypeOfCli>;
        };
        return bridge.wingmanCli(name, request);
      },
      { name, request },
    );
  const mutate = async (name: string, payload: unknown, takeoffId = 'main') => {
    const observed = (await cli('project.inspect')).response;
    const result = await cli(name, {
      projectId: observed.projectId,
      expectedRevision: observed.revision,
      takeoffId,
      payload,
    });
    expect(result.exitCode, JSON.stringify(result.response)).toBe(0);
    return result.response.data;
  };
  const project = (await cli('project.inspect')).response.data as Project;
  const sheetId = Object.keys(project.sheets)[0];
  await mutate('batch', {
    commands: [
      {
        name: 'geometry.put',
        payload: {
          id: 'g',
          name: 'Main markers',
          sheetId,
          kind: 'count',
          points: [
            { x: 100, y: 100 },
            { x: 150, y: 100 },
            { x: 200, y: 100 },
          ],
        },
      },
      {
        name: 'group.put',
        payload: { id: 'group', name: 'Main scope', geometryIds: ['g'] },
      },
      {
        name: 'recipe.put',
        payload: {
          id: 'r',
          name: 'Count steel',
          geometryKinds: ['count'],
          inputs: [{ name: 'cut', type: 'number', unit: 'ft', default: 2 }],
          outputs: [
            {
              id: 'o',
              name: 'Pieces',
              materialId: 'steel',
              unit: 'ea',
              formula: 'count',
              piece: {
                role: 'stud',
                cutLength: { formula: 'cut', unit: 'ft' },
              },
              allowance: { wastePercent: 10, packageSize: 2 },
            },
          ],
        },
      },
      {
        name: 'assignment.put',
        payload: {
          id: 'a',
          groupId: 'group',
          recipeId: 'r',
          inputs: {},
          allowances: {},
        },
      },
    ],
  });
  expect((await cli('quantities.inspect')).exitCode).toBe(1);
  await page.getByRole('button', { name: 'Takeoffs', exact: true }).click();
  await page.getByLabel('Takeoff name', { exact: true }).fill('CO 01');
  await page.getByLabel('New takeoff kind').selectOption('change-order');
  await page
    .getByRole('button', { name: 'Create takeoff', exact: true })
    .click();
  await expect(page.getByLabel('Active takeoff')).not.toHaveValue('main');
  const co = await page.getByLabel('Active takeoff').inputValue();
  expect(co).not.toBe('main');
  await page.getByLabel('Copy direction').selectOption('deduct');
  await page
    .getByRole('checkbox', { name: 'Main markers', exact: true })
    .check();
  await page
    .getByRole('button', { name: 'Copy selected items', exact: true })
    .click();
  const report = (await cli('quantities.inspect', { takeoffId: co })).response
    .data as {
    totals: { amount: number; deductions: number }[];
    context: { takeoffId: string };
  };
  expect(report.totals[0]?.amount).toBe(-4);
  expect(report.totals[0]?.deductions).toBe(4);
  await page.getByLabel('Active takeoff').selectOption('main');
  await mutate('takeoff.rename', { id: co, name: 'CO renamed' }, co);
  await mutate(
    'geometry.move',
    {
      ids: Object.keys(
        (
          (await cli('takeoff.inspect', { takeoffId: co })).response.data as {
            geometries: object;
          }
        ).geometries,
      ),
      dx: 4,
      dy: 0,
    },
    co,
  );
  await expect(page.getByLabel('Active takeoff')).toHaveValue('main');
  const main = (await cli('takeoff.inspect', { takeoffId: 'main' })).response
    .data as { geometries: Project['geometries'] };
  expect(main.geometries.g?.points[0]?.x).toBe(100);
  const exported = (
    await cli('quantities.export', {
      takeoffId: co,
      payload: { format: 'json' },
    })
  ).response.data as string;
  expect(JSON.parse(exported)).toMatchObject({
    context: { takeoffId: co, name: 'CO renamed' },
    totals: [{ amount: -4, deductions: 4 }],
  });
  const quantityDownload = page.waitForEvent('download');
  const purchased = await cli('quantities.exportEstiMaker', {
    takeoffId: co,
    payload: { path: 'co.estimaker.json' },
  });
  expect(purchased.exitCode, JSON.stringify(purchased.response)).toBe(0);
  expect(
    JSON.parse((purchased.response.data as { text: string }).text),
  ).toMatchObject({
    version: 2,
    takeoff: { id: co, name: 'CO renamed', kind: 'change-order' },
    rows: [
      { quantity: -8, grossQuantity: 8, direction: 'deduct', pieceCount: 4 },
    ],
  });
  expect((await quantityDownload).suggestedFilename()).toContain(co);
  const download = page.waitForEvent('download');
  const rendered = await cli('sheet.render', {
    takeoffId: co,
    payload: {
      sheetId,
      mode: 'takeoff',
      maxDimension: 320,
      path: 'takeoff.png',
    },
  });
  expect(rendered.exitCode, JSON.stringify(rendered.response)).toBe(0);
  expect(rendered.response.data).toMatchObject({
    takeoffId: co,
    takeoffName: 'CO renamed',
  });
  expect((await download).suggestedFilename()).toContain(co);
  const wingman = async () =>
    (await cli('wingman.inspect')).response.data as {
      main: { takeoffId: string };
      agent: { takeoffId: string } | null;
    };
  expect(await wingman()).toMatchObject({
    main: { takeoffId: 'main' },
    agent: null,
  });
  const renderPreview = async (takeoffId: string) => {
    const downloaded = page.waitForEvent('download');
    const reply = await cli('sheet.render', {
      takeoffId,
      payload: {
        sheetId,
        mode: 'takeoff',
        maxDimension: 320,
        path: 'preview.png',
      },
    });
    expect(reply.exitCode, JSON.stringify(reply.response)).toBe(0);
    await downloaded;
  };
  await renderPreview('main');
  expect(await wingman()).toMatchObject({ agent: { takeoffId: 'main' } });
  await page.getByLabel('Active takeoff').selectOption(co);
  await expect.poll(async () => (await wingman()).agent).toBeNull();
  await renderPreview(co);
  expect(await wingman()).toMatchObject({ agent: { takeoffId: co } });
  await page.getByLabel('Active takeoff').selectOption('main');
  await expect.poll(async () => (await wingman()).agent).toBeNull();
  await page.getByRole('button', { name: 'Takeoffs', exact: true }).click();
  await page.getByRole('button', { name: 'Path (L)', exact: true }).click();
  await page
    .getByLabel('Drawing canvas', { exact: true })
    .click({ position: { x: 200, y: 200 } });
  await expect(page.getByLabel('Active takeoff')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Active takeoff')).toBeEnabled();
  await page.getByLabel('Active takeoff').selectOption(co);
  await page.reload();
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByLabel('Active takeoff')).toHaveValue('main');
  await page.getByLabel('Active takeoff').selectOption(co);
  expect(
    (await cli('quantities.inspect', { takeoffId: co })).response.data,
  ).toMatchObject({ totals: [{ amount: -4 }] });
  await mutate('takeoff.delete', { id: co });
  await expect(page.getByLabel('Active takeoff')).toHaveValue('main');
  await page
    .getByLabel('New group name', { exact: true })
    .fill('Post-delete Main');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByLabel('Group name', { exact: true })).toHaveValue(
    'Post-delete Main',
  );
  await mutate('history.undo', {});
  await mutate('history.undo', {});
  await page.getByLabel('Active takeoff').selectOption(co);
}
