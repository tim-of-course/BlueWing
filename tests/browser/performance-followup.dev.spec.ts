import { expect, test, type Page } from '@playwright/test';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import type { Project } from '../../src/core/types';
import { captureErrors, cli, startWingmanProject } from './wingman';
import { drawWall } from './takeoff';

async function mutate(page: Page, name: string, payload: unknown) {
  const current = (await cli(page, 'project.inspect')).response;
  const result = await page.evaluate(
    async ({ name, request }) => {
      return (
        window as unknown as {
          wingmanCli(
            name: string,
            request: unknown,
          ): Promise<{ response: { ok: boolean } }>;
        }
      ).wingmanCli(name, request);
    },
    {
      name,
      request: {
        payload,
        projectId: current.projectId,
        expectedRevision: current.revision,
      },
    },
  );
  expect(result.response.ok).toBe(true);
}

test('navigator retains sheet and group elements while their live labels update', async ({
  page,
}, info) => {
  const errors = await captureErrors(page);
  await startWingmanProject(page, true);
  await drawWall(page);
  const project = (await cli<Project>(page, 'project.inspect')).response.data;
  const sheet = Object.values(project.sheets)[0];
  const geometry = Object.values(project.geometries)[0];
  if (!sheet || !geometry) throw new Error('Missing drawing fixture');
  const group = {
    id: 'framing',
    name: 'Framing',
    color: '#123456',
    geometryIds: [geometry.id],
  };
  await mutate(page, 'group.put', group);
  const groupRow = page.getByRole('button', {
    name: 'Framing, 1 drawing objects',
    exact: true,
  });
  await expect(groupRow).toBeVisible();
  await page.evaluate(() => {
    Object.assign(window, {
      retainedRows: [
        document.querySelector('.sheet-row'),
        document.querySelector('.group-row'),
      ],
    });
  });
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await mutate(page, 'project.rename', { name: 'Renamed project' });
      await mutate(page, 'sheet.put', { ...sheet, name: 'Updated plan' });
      await mutate(page, 'group.put', {
        ...group,
        name: 'Updated framing',
        color: '#654321',
      });
      await expect(
        page.getByRole('button', { name: 'Updated plan', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: 'Updated framing, 1 drawing objects',
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => {
          const rows = (window as unknown as { retainedRows: Element[] })
            .retainedRows;
          return (
            rows[0] === document.querySelector('.sheet-row') &&
            rows[1] === document.querySelector('.group-row')
          );
        }),
      ).toBe(true);
    },
    { scenario: 'stable-navigator-records' },
  );
  await info.attach('diagnostics', {
    body: JSON.stringify(artifact),
    contentType: 'application/json',
  });
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});

test('assembly preview is lazy while closed and current when reopened', async ({
  page,
}, info) => {
  const errors = await captureErrors(page);
  await startWingmanProject(page, true);
  await drawWall(page);
  await page.getByRole('button', { name: 'Assemblies', exact: true }).click();
  const editor = page.getByRole('dialog', {
    name: 'Assembly editor',
    exact: true,
  });
  await editor
    .getByLabel('Choose assembly', { exact: true })
    .selectOption('wall-area');
  const preview = editor.locator('details').filter({
    has: page.locator('summary', { hasText: 'Preview on selected drawing' }),
  });
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await expect(preview.locator('strong')).toHaveCount(0);
      await editor
        .getByLabel('Description', { exact: true })
        .fill('Description edit with preview closed');
      await expect(preview.locator('strong')).toHaveCount(0);
      await preview.locator('summary').click();
      await expect(preview).toContainText('192 ft2');
      await preview.locator('summary').click();
      await expect(preview.locator('strong')).toHaveCount(0);
      await editor
        .getByRole('group', { name: 'Input 1', exact: true })
        .getByLabel('Default', { exact: true })
        .fill('10');
      await expect(preview.locator('strong')).toHaveCount(0);
      await preview.locator('summary').click();
      await expect(preview).toContainText('240 ft2');
    },
    { scenario: 'lazy-assembly-preview' },
  );
  await info.attach('diagnostics', {
    body: JSON.stringify(artifact),
    contentType: 'application/json',
  });
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});

test('warm Wingman plan updates once without clearing, resizing or rerasterizing', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await startWingmanProject(page, true);
  const sheetId = await page
    .getByLabel('Drawing canvas', { exact: true })
    .getAttribute('data-sheet-id');
  expect(
    (
      await cli(page, 'sheet.render', {
        sheetId,
        path: 'preview.png',
        bounds: { x: 72, y: 144, width: 240, height: 180 },
        maxDimension: 640,
      })
    ).exitCode,
  ).toBe(0);
  await cli(page, 'wingman.flash');
  const canvas = page.getByLabel('Live workspace preview');
  await expect(canvas).toBeVisible();
  await expect(page.getByText('Loading plan…', { exact: true })).toBeHidden();
  await canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext('2d');
    if (!context) throw new Error('Missing preview context');
    const counts = { draws: 0, clears: 0, resizes: 0 };
    const draw = context.drawImage.bind(context);
    const clear = context.clearRect.bind(context);
    Object.defineProperty(context, 'drawImage', {
      configurable: true,
      value: (...args: unknown[]) => {
        counts.draws++;
        Reflect.apply(draw, context, args);
      },
    });
    context.clearRect = (...args) => {
      counts.clears++;
      clear(...args);
    };
    const observer = new MutationObserver((records) => {
      counts.resizes += records.length;
    });
    observer.observe(element, {
      attributes: true,
      attributeFilter: ['width', 'height'],
    });
    Object.assign(window, { previewCounts: counts, previewObserver: observer });
  });
  await mutate(page, 'project.rename', { name: 'Changed metadata' });
  expect(
    await page.evaluate(
      () => (window as unknown as { previewCounts: unknown }).previewCounts,
    ),
  ).toEqual({ draws: 1, clears: 0, resizes: 0 });
  await expect(page.getByText('Loading plan…', { exact: true })).toBeHidden();
  expect(errors).toEqual([]);
});
