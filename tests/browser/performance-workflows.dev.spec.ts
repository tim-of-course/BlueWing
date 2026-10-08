import { writeFile } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import type { Project, CommandCall } from '../../src/core/types';
import type { PerformanceReport } from '../../src/performance/recorder';
import { PAGE_IMAGE_DIMENSION } from '../../src/pdf/page-images';
import { captureErrors, cli } from './wingman';
import { pagePoint } from './takeoff';

// Small enough for every verify run, populated enough to exercise snapping,
// canvas overlays, navigator filtering, serialization and quantity readers.
const TRACE_COUNT = 300;

async function createProject(page: Page) {
  await page.goto('/tests/browser/wingman-harness.html');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Performance fixture');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
}

async function importPlans(page: Page) {
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
  await (await choosing).setFiles('tests/fixtures/sheet-name-plan.pdf');
  await expect(page.locator('.sheet-row')).toHaveCount(2);
  await ready(page);
}

async function ready(page: Page) {
  await expect(
    page.getByLabel('Drawing canvas', { exact: true }),
  ).toHaveAttribute('aria-busy', 'false');
  // Acquisition resolves before the scheduled canvas paint.
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
}

async function moveAcrossFrames(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
) {
  // Playwright's mouse.move({steps}) is not frame-paced. Fast delivery would
  // coalesce all inputs into a few paints and leave too few timing samples.
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
    );
  }
}

async function populate(page: Page) {
  const current = (await cli<Project>(page, 'project.inspect')).response;
  const sheets = Object.values(current.data.sheets).sort(
    (a, b) => a.pageIndex - b.pageIndex,
  );
  const first = sheets[0];
  if (!first || sheets.length !== 2)
    throw new Error('Missing two-page fixture');
  const commands: CommandCall[] = sheets.map((sheet, index) => ({
    name: 'sheet.put',
    payload: {
      ...sheet,
      name: index ? 'Ceiling plan' : 'Floor plan',
      calibration: { metresPerUnit: 0.01 },
    },
  }));
  for (let i = 0; i < TRACE_COUNT; i++) {
    const x = 50 + (i % 20) * 22;
    const y = 65 + Math.floor(i / 20) * 14;
    commands.push({
      name: 'geometry.put',
      payload: {
        id: `trace-${String(i)}`,
        name: `Partition ${String(i)}`,
        sheetId: first.id,
        kind: 'path',
        points: [
          { x, y },
          { x: x + 18, y },
        ],
      },
    });
  }
  commands.push({
    name: 'recipe.put',
    payload: {
      id: 'length',
      name: 'Measured length',
      geometryKinds: ['path'],
      inputs: [],
      outputs: [
        {
          id: 'length',
          name: 'Measured length',
          materialId: 'run',
          unit: 'm',
          formula: 'length',
          allowance: { wastePercent: 0 },
        },
      ],
    },
  });
  for (let i = 0; i < 15; i++) {
    const id = `group-${String(i)}`;
    commands.push(
      {
        name: 'group.put',
        payload: {
          id,
          name: `Walls ${String(i)}`,
          geometryIds: Array.from(
            { length: 20 },
            (_, j) => `trace-${String(i * 20 + j)}`,
          ),
        },
      },
      {
        name: 'assignment.put',
        payload: {
          id,
          groupId: id,
          recipeId: 'length',
          inputs: {},
          allowances: {},
        },
      },
    );
  }
  commands.push(
    {
      name: 'level.put',
      payload: { id: 'floor', name: 'Floor', elevation: 0 },
    },
    {
      name: 'wall.put',
      payload: {
        id: 'wall',
        geometryId: 'trace-0',
        levelId: 'floor',
        baseElevation: 0,
        height: 3,
        studSpacing: 0.4,
        stud: { materialId: 'stud', width: 0.04, depth: 0.09 },
        track: { materialId: 'track', width: 0.09, depth: 0.03 },
        finishes: [],
      },
    },
  );
  const result = await page.evaluate(
    ({ projectId, revision, commands }) =>
      window.wingmanCli('batch', {
        projectId,
        expectedRevision: revision,
        payload: { commands },
      }),
    { projectId: current.projectId, revision: current.revision, commands },
  );
  expect(result.exitCode, JSON.stringify(result.response)).toBe(0);
  // Prepare both real PDF pages before measuring warm interactions. Background
  // preparation remains enabled and is measured separately during cold import.
  for (const name of ['Ceiling plan', 'Floor plan']) {
    await page.getByRole('button', { name, exact: true }).click();
    await ready(page);
  }
  await expect
    .poll(
      async () =>
        (
          await cli<{ preparation: { running: boolean } }>(
            page,
            'performance.status',
          )
        ).response.data.preparation.running,
    )
    .toBe(false);
  return first.id;
}

async function record(
  page: Page,
  info: TestInfo,
  name: string,
  action: () => Promise<void>,
) {
  expect((await cli(page, 'performance.start')).exitCode).toBe(0);
  let report!: PerformanceReport;
  try {
    await action();
  } finally {
    const stopped = await cli<PerformanceReport>(page, 'performance.stop');
    report = stopped.response.data;
    const path = info.outputPath(`${name}.json`);
    await writeFile(path, JSON.stringify(report, null, 2));
    await info.attach(name, { path, contentType: 'application/json' });
  }
  expect(
    report.droppedEvents,
    'A truncated scenario cannot establish a p95 budget',
  ).toBe(0);
  return report;
}

function budget(
  report: PerformanceReport,
  name: string,
  minSamples: number,
  p95BudgetMs: number,
  purpose?: string,
) {
  const durations = report.events
    .filter(
      (event) =>
        event.name === name &&
        event.kind === 'span' &&
        (purpose === undefined || event.data.purpose === purpose),
    )
    .map((event) => event.durationMs ?? 0)
    .sort((a, b) => a - b);
  expect(
    durations.length,
    `${name} ${purpose ?? ''} recorded samples`,
  ).toBeGreaterThanOrEqual(minSamples);
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
  expect(
    p95,
    `${name} ${purpose ?? ''} p95, budget ${String(p95BudgetMs)} ms`,
  ).toBeLessThanOrEqual(p95BudgetMs);
}

async function solidScenario(
  page: Page,
  info: TestInfo,
  action: () => Promise<void>,
) {
  const { artifact } = await captureBrowserArtifact(page, action, {
    scenario: info.title,
  });
  const path = info.outputPath('solid-diagnostics.json');
  await writeFile(path, JSON.stringify(artifact, null, 2));
  await info.attach('solid-diagnostics', {
    path,
    contentType: 'application/json',
  });
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
}

test('performance: trace, snap and pan on 300 existing traces', async ({
  page,
}, info) => {
  const errors = await captureErrors(page);
  await createProject(page);
  await importPlans(page);
  await populate(page);
  const accepted = await page.evaluateHandle(() => window.wingmanCalculation());
  const report = await record(page, info, 'tracing', () =>
    solidScenario(page, info, async () => {
      await page.getByRole('button', { name: 'Path (L)', exact: true }).click();
      await pagePoint(page, 72, 310);
      const canvas = page.getByLabel('Drawing canvas', { exact: true });
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Missing canvas');
      await moveAcrossFrames(
        page,
        { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 },
        { x: box.x + box.width * 0.8, y: box.y + box.height * 0.65 },
        40,
      );
      expect(
        await accepted.evaluate(
          (before) => before === window.wingmanCalculation(),
        ),
        'Draft movement must reuse the accepted calculation',
      ).toBe(true);
      await pagePoint(page, 360, 310);
      await page.getByRole('button', { name: 'Finish', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Finish', exact: true }),
      ).toBeHidden();
      expect(
        Object.keys(
          (await cli<Project>(page, 'project.inspect')).response.data
            .geometries,
        ),
      ).toHaveLength(TRACE_COUNT + 1);
      expect(
        await accepted.evaluate(
          (before) => before === window.wingmanCalculation(),
        ),
        'Saving geometry must refresh quantities',
      ).toBe(false);
      await page
        .getByRole('button', { name: 'Select (V)', exact: true })
        .click();
      const x = await canvas.getAttribute('data-camera-x');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down({ button: 'middle' });
      await moveAcrossFrames(
        page,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
        { x: box.x + box.width / 2 + 90, y: box.y + box.height / 2 + 30 },
        20,
      );
      await page.mouse.up({ button: 'middle' });
      await expect(canvas).not.toHaveAttribute('data-camera-x', x ?? '');
      await ready(page);
    }),
  );
  budget(report, 'canvas.pointer', 30, 17, 'path');
  budget(report, 'canvas.pointer', 15, 17, 'pan');
  budget(report, 'canvas.paint', 20, 17);
  expect(
    report.events.filter(
      (event) =>
        event.name === 'canvas.paint' &&
        Number(event.data.geometryCount) >= TRACE_COUNT,
    ).length,
  ).toBeGreaterThanOrEqual(20);
  budget(report, 'canvas.commit', 1, 1000, 'path');
  expect(
    report.events
      .filter((event) => event.name === 'canvas.commit')
      .every((event) => event.data.success === true),
  ).toBe(true);
  expect(report.summary.frames.count).toBeGreaterThanOrEqual(20);
  // 17 ms is the target, 33 ms is the sustained-frame regression budget.
  expect(report.summary.frames.p95Ms).toBeLessThanOrEqual(33);
  expect(
    report.events.filter((event) => event.name === 'pdf.raster.request'),
  ).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('performance: cold import, warm page swaps, navigator search and CLI lookups/views', async ({
  page,
}, info) => {
  const errors = await captureErrors(page);
  await createProject(page);
  const cold = await record(page, info, 'cold-import', () => importPlans(page));
  expect(cold.events.some((event) => event.name === 'pdf.raster.request')).toBe(
    true,
  );
  expect(
    cold.events.some(
      (event) => event.name === 'page.display' && event.data.success === true,
    ),
  ).toBe(true);
  const sheetId = await populate(page);
  const accepted = await page.evaluateHandle(() => window.wingmanCalculation());
  const report = await record(page, info, 'navigation-and-cli', () =>
    solidScenario(page, info, async () => {
      for (let i = 0; i < 3; i++) {
        for (const name of ['Ceiling plan', 'Floor plan']) {
          await page.getByRole('button', { name, exact: true }).click();
          await ready(page);
        }
      }
      const filter = page.getByLabel('Filter sheets and groups', {
        exact: true,
      });
      await filter.pressSequentially('Ceiling');
      await expect(page.locator('.sheet-row')).toHaveCount(1);
      await expect(
        page.getByRole('button', { name: 'Ceiling plan', exact: true }),
      ).toBeVisible();
      await filter.fill('');
      await expect(page.locator('.sheet-row')).toHaveCount(2);
      // The CLI's current lookup surface is structured inspection. There is no
      // PDF text-search command; do not substitute a fake search implementation.
      for (let i = 0; i < 5; i++)
        for (const name of [
          'project.inspect',
          'quantities.inspect',
          'pieces.inspect',
          'commands.list',
        ])
          expect((await cli(page, name)).exitCode).toBe(0);
      const download = page.waitForEvent('download');
      const rendered = await cli(page, 'sheet.render', {
        sheetId,
        path: 'performance-sheet.png',
        maxDimension: 320,
        mode: 'combined',
      });
      expect(rendered.exitCode, JSON.stringify(rendered.response)).toBe(0);
      expect(await (await download).failure()).toBeNull();
      expect((await cli(page, 'wingman.flash')).exitCode).toBe(0);
      await expect(page.locator('.wingman-preview canvas')).toBeVisible();
      await expect(
        page.locator('.wingman-preview').getByRole('status'),
      ).toHaveCount(0);
      expect(
        await accepted.evaluate(
          (before) => before === window.wingmanCalculation(),
        ),
        'Lookup, view and filter actions must reuse calculations',
      ).toBe(true);
    }),
  );
  budget(report, 'page.display', 6, 250);
  expect(
    report.events
      .filter((event) => event.name === 'page.display')
      .map((event) => event.data.success),
  ).toEqual(Array<boolean>(6).fill(true));
  for (const name of [
    'project.inspect',
    'quantities.inspect',
    'pieces.inspect',
    'commands.list',
  ])
    budget(report, 'cli.command', 5, 33, name);
  budget(report, 'cli.command', 1, 2000, 'sheet.render');
  const hits = report.events.filter(
    (event) =>
      event.name === 'page.cache.hit' &&
      event.data.cacheSource === 'memory' &&
      event.data.dimension === PAGE_IMAGE_DIMENSION,
  );
  expect(hits.length).toBeGreaterThanOrEqual(6);
  // The explicit export and Wingman's cropped preview need pixels. The six
  // full-page swaps must reuse their cache rather than rasterizing again.
  expect(
    report.events
      .filter((event) => event.name === 'pdf.raster.request')
      .map((event) => event.data.dimension)
      .sort((a, b) => Number(a) - Number(b)),
  ).toEqual([320, 640]);
  expect(errors).toEqual([]);
});
