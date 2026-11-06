import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureErrors, cli, startWingmanProject } from './wingman';
import { drawWall } from './takeoff';
import { readDownload } from './estimaker';
import { fixture, importFixture } from '../fixtures/quantity-project';
import type { Project } from '../../src/core/types';
import type { TakeoffEnvelope } from '../../src/core/quantity-presentation';

test('Quantities and CLI share purchased footage and count rows; source/review navigation stays live', async ({
  page,
}, info) => {
  const errors = await captureErrors(page);
  await startWingmanProject(page, true);
  await drawWall(page);
  const project = (await cli<Project>(page, 'project.inspect')).response.data;
  const geometry = Object.values(project.geometries)[0];
  const recipe = fixture().recipes.tee;
  if (!geometry || !recipe) throw new Error('Missing fixture');
  const missingRecipe = importFixture().recipes.gyp;
  if (!missingRecipe) throw new Error('Missing area fixture');
  missingRecipe.geometryKinds = ['path'];
  recipe.geometryKinds = ['path'];
  recipe.outputs.push({
    id: 'count',
    name: 'Count-only clips',
    materialId: 'clip',
    unit: 'ea',
    formula: '3',
    allowance: { wastePercent: 0 },
  });
  const commands = [
    { name: 'recipe.put', payload: recipe },
    { name: 'recipe.put', payload: missingRecipe },
    {
      name: 'group.put',
      payload: { id: 'group', name: 'Ceiling', geometryIds: [geometry.id] },
    },
    {
      name: 'assignment.put',
      payload: {
        id: 'a',
        recipeId: recipe.id,
        groupId: 'group',
        inputs: {},
        allowances: {},
      },
    },
    {
      name: 'assignment.put',
      payload: {
        id: 'finish',
        recipeId: missingRecipe.id,
        groupId: 'group',
        inputs: {},
        allowances: {},
      },
    },
    {
      name: 'review.mark',
      payload: {
        id: 'review',
        target: { kind: 'geometry', id: geometry.id },
        status: 'question',
        note: 'Check',
      },
    },
  ];
  const prepared = await page.evaluate(
    async (request) => window.wingmanCli('batch', request),
    {
      projectId: project.id,
      expectedRevision: project.revision,
      payload: { commands },
    },
  );
  expect(prepared.exitCode, JSON.stringify(prepared.response)).toBe(0);
  const before = (await cli<Project>(page, 'project.inspect')).response.data;
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await page
        .getByRole('button', { name: 'Quantities', exact: true })
        .click();
      const totals = page.getByRole('table', { name: 'Material totals' });
      await expect(totals).toContainText('150 LF');
      await expect(totals).toContainText('75 pc');
      await expect(totals).toContainText('Acoustical ceilings');
      const countRow = totals
        .getByRole('row')
        .filter({ hasText: 'Count-only clips' });
      await expect(countRow).toContainText('3 count');
      await expect(countRow).not.toContainText('Unavailable');
      await expect(countRow).toContainText('Count-only clips (count)');
      const missingRow = totals
        .getByRole('row')
        .filter({ hasText: '5/8 Gyp (missing quantity)' });
      await expect(missingRow).toContainText('0 SF');
      const detail = page
        .locator('details.quantity-output')
        .filter({ has: page.locator('summary').filter({ hasText: 'Tee' }) });
      await expect(detail).not.toHaveAttribute('open');
      await detail.locator('summary').click();
      await expect(detail).toContainText('Net / base');
      await expect(detail).toContainText('Required cuts');
      await expect(detail).toContainText('question');
      const ui = JSON.parse(
        await readDownload(page, () =>
          page
            .getByRole('button', { name: 'Export to EstiMaker', exact: true })
            .click(),
        ),
      ) as TakeoffEnvelope;
      const cliDownload = page.waitForEvent('download');
      const reply = await cli<{ path: string; text: string }>(
        page,
        'quantities.exportEstiMaker',
        { path: 'estimate.json' },
      );
      const downloaded = await cliDownload;
      const path = await downloaded.path();
      if (!path) throw new Error('Missing CLI download');
      expect(
        await (await import('node:fs/promises')).readFile(path, 'utf8'),
      ).toBe(reply.response.data.text);
      const command = JSON.parse(reply.response.data.text) as TakeoffEnvelope;
      expect({ ...command, exportedAt: ui.exportedAt }).toEqual(ui);
      expect(ui.rows[0]?.quantity).toBeCloseTo(150);
      expect(ui.rows[1]?.quantity).toBe(3);
      expect(ui.rows[1]?.unit).toBe('count');
      expect(ui.rows[2]?.description).toBe('5/8 Gyp (missing quantity)');
      expect(ui.rows[2]?.quantity).toBe(0);
      expect(ui.rows[2]?.unit).toBe('SF');
      expect((await cli(page, 'quantities.exportEstiMaker')).exitCode).toBe(1);
      expect(
        (await cli<Project>(page, 'project.inspect')).response.data,
      ).toEqual(before);
      const generic = JSON.parse(
        await readDownload(page, () =>
          page
            .getByRole('button', { name: 'Export JSON', exact: true })
            .click(),
        ),
      ) as { outputs: unknown[] };
      expect(generic.outputs).toHaveLength(3);
      await detail
        .getByRole('table', { name: 'Drawing contributions' })
        .getByRole('button')
        .first()
        .click();
      await expect(
        page.getByLabel('Drawing canvas', { exact: true }),
      ).toBeVisible();
    },
    { scenario: 'quantities-estimaker-export-and-source-navigation' },
  );
  await writeFile(
    info.outputPath('estimaker-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});
