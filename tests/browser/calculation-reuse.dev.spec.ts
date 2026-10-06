import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import type { CalculationSnapshot } from '../../src/core/calculation-state';
import type { Project } from '../../src/core/types';
import { captureErrors, cli, startWingmanProject } from './wingman';
import { drawWall } from './takeoff';

declare global {
  interface Window {
    wingmanCalculation(): CalculationSnapshot;
    wingmanWatchModelBuilds(): Promise<{ builds(): number; dispose(): void }>;
    wingmanCli(
      name: string,
      request: unknown,
    ): Promise<{ exitCode: number; response: unknown }>;
  }
}

async function mutate(page: Page, name: string, payload: unknown) {
  const { projectId, revision } = (await cli(page, 'project.inspect')).response;
  const result = await page.evaluate(
    async ({ name, request }) => window.wingmanCli(name, request),
    { name, request: { projectId, expectedRevision: revision, payload } },
  );
  expect(result.exitCode, JSON.stringify(result.response)).toBe(0);
}

test('UI, CLI reports and camera renders share one calculation and metadata retains 3D models', async ({
  page,
}, info) => {
  const errors = captureErrors(page);
  await startWingmanProject(page, true);
  await drawWall(page);
  let project = (await cli<Project>(page, 'project.inspect')).response.data;
  const geometry = Object.values(project.geometries)[0];
  const sheet = Object.values(project.sheets)[0];
  if (!geometry || !sheet) throw new Error('Missing trace');
  await mutate(page, 'level.put', { id: 'floor', name: 'Floor', elevation: 0 });
  await mutate(page, 'wall.put', {
    id: 'reuse-wall',
    geometryId: geometry.id,
    levelId: 'floor',
    baseElevation: 0,
    height: 3,
    studSpacing: 0.4,
    stud: { materialId: 'stud', width: 0.04, depth: 0.09 },
    track: { materialId: 'track', width: 0.09, depth: 0.03 },
    finishes: [],
  });
  // Count formula parses to catch extra calculation work by UI or CLI readers.
  await mutate(page, 'batch', {
    commands: [
      {
        name: 'group.put',
        payload: {
          id: 'probe-group',
          name: 'Measured run',
          geometryIds: [geometry.id],
        },
      },
      {
        name: 'recipe.put',
        payload: {
          id: 'probe-recipe',
          name: 'Measured length',
          geometryKinds: ['path'],
          inputs: [
            { name: 'probeFactor', type: 'number', unit: 'scalar', default: 2 },
          ],
          outputs: [
            {
              id: 'length',
              name: 'Measured length',
              materialId: 'run',
              unit: 'm',
              formula: 'length * probeFactor',
              allowance: { wastePercent: 0 },
            },
          ],
        },
      },
      {
        name: 'assignment.put',
        payload: {
          id: 'probe-use',
          groupId: 'probe-group',
          recipeId: 'probe-recipe',
          inputs: {},
          allowances: {},
        },
      },
    ],
  });
  const accepted = await page.evaluateHandle(() => window.wingmanCalculation());
  const parsing = await page.evaluateHandle(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = String.prototype.slice;
    let parses = 0;
    String.prototype.slice = function (start, end) {
      if (start === 0 && this.valueOf() === 'length * probeFactor') parses++;
      return original.call(this, start, end);
    };
    return {
      count: () => parses,
      dispose: () => {
        String.prototype.slice = original;
      },
    };
  });
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      for (const [name, payload] of [
        ['quantities.inspect', {}],
        ['pieces.export', { format: 'csv' }],
        [
          'construction.render',
          {
            path: 'iso.png',
            view: 'isometric',
            levelId: 'floor',
            width: 320,
            height: 240,
          },
        ],
        [
          'construction.render',
          {
            path: 'front.png',
            view: 'front',
            levelId: 'floor',
            width: 320,
            height: 240,
          },
        ],
      ] as const)
        expect((await cli(page, name, payload)).exitCode).toBe(0);
      expect(await parsing.evaluate((probe) => probe.count())).toBe(0);
      await parsing.evaluate((probe) => {
        probe.dispose();
      });
      const rendering = await page.evaluateHandle(() =>
        window.wingmanWatchModelBuilds(),
      );
      await page
        .getByLabel('Workspace view', { exact: true })
        .selectOption('split');
      const viewer = page.getByRole('region', {
        name: '3D construction viewer',
      });
      await viewer
        .getByRole('combobox', { name: 'Level', exact: true })
        .selectOption('floor');
      await expect(viewer.getByRole('status')).toBeHidden();
      expect((await cli(page, 'wingman.flash')).exitCode).toBe(0);
      await expect(page.locator('.wingman-preview canvas')).toBeVisible();
      await expect(
        page.getByText('Loading 3D preview…', { exact: true }),
      ).toBeHidden();
      await expect
        .poll(() => rendering.evaluate((probe) => probe.builds()))
        .toBeGreaterThanOrEqual(2);
      const modelBuilds = await rendering.evaluate((probe) => probe.builds());
      project = (await cli<Project>(page, 'project.inspect')).response.data;
      const group = Object.values(project.groups).find(
        (item) => item.id !== 'probe-group',
      );
      if (!group) throw new Error('Missing wall group');
      await mutate(page, 'batch', {
        commands: [
          { name: 'project.rename', payload: { name: 'Reviewed project' } },
          {
            name: 'sheet.put',
            payload: { ...sheet, name: 'Renamed plan', order: 5 },
          },
          {
            name: 'group.put',
            payload: { ...group, name: 'Reviewed framing', color: '#aabbcc' },
          },
          {
            name: 'geometry.put',
            payload: { ...geometry, name: 'North partition' },
          },
          {
            name: 'review.mark',
            payload: {
              id: 'review',
              target: { kind: 'wall', id: 'reuse-wall' },
              status: 'reviewed',
              note: 'Checked',
            },
          },
        ],
      });
      await expect(
        page.getByRole('button', { name: 'Renamed plan', exact: true }),
      ).toBeVisible();
      expect(
        await accepted.evaluate(
          (before) => before === window.wingmanCalculation(),
        ),
      ).toBe(true);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                resolve();
              }),
            ),
          ),
      );
      expect(await rendering.evaluate((probe) => probe.builds())).toBe(
        modelBuilds,
      );
      const exported = await cli<string>(page, 'pieces.export', {
        format: 'csv',
      });
      expect(exported.response.data).toContain('Renamed plan');
      expect(exported.response.data).toContain('North partition');
      const before = await accepted.evaluate(
        (value) =>
          value.model.pieces.find((piece) => piece.role === 'stud')?.cutLength,
      );
      await mutate(page, 'sheet.put', {
        ...sheet,
        name: 'Renamed plan',
        calibration: {
          metresPerUnit: (sheet.calibration?.metresPerUnit ?? 1) * 2,
        },
      });
      expect(
        await accepted.evaluate(
          (value) => value === window.wingmanCalculation(),
        ),
      ).toBe(false);
      // Height stays authored, while horizontal layout and total length change.
      expect(
        await page.evaluate(
          () =>
            window
              .wingmanCalculation()
              .model.pieces.find((piece) => piece.role === 'stud')?.cutLength,
        ),
      ).toBe(before);
      await expect
        .poll(() => rendering.evaluate((probe) => probe.builds()))
        .toBeGreaterThan(modelBuilds);
      await rendering.evaluate((probe) => {
        probe.dispose();
      });
      await page
        .getByRole('button', { name: 'Quantities', exact: true })
        .click();
      await expect(
        page.getByRole('table', { name: 'Material totals' }),
      ).toContainText('run');
    },
    { scenario: 'shared-calculation-and-model-identity' },
  );
  const path = info.outputPath('solid-diagnostics.json');
  await writeFile(path, JSON.stringify(artifact, null, 2));
  await info.attach('solid-diagnostics', {
    path,
    contentType: 'application/json',
  });
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});
