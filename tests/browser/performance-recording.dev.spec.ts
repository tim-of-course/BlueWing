import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { PdfDocuments as PdfDocumentCache } from '../../src/pdf/documents';
import type { Project } from '../../src/core/types';
import type { PerformanceReport } from '../../src/performance/recorder';
import { captureErrors, cli, startWingmanProject } from './wingman';

test('performance recording stops during queued PDF work and exports the same report', async ({
  page,
}) => {
  const errors = await captureErrors(page);
  await startWingmanProject(page, true);
  const project = (await cli<Project>(page, 'project.inspect')).response.data;
  const sheetId = Object.keys(project.sheets)[0];
  if (!sheetId) throw new Error('Missing performance fixture sheet');
  await page
    .getByRole('button', { name: 'Record performance', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Save performance recording',
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/pdf/documents.ts';
    const { PdfDocuments } = (await import(path)) as {
      PdfDocuments: typeof PdfDocumentCache;
    };
    // Hold an actual export inside the ordinary application queue. Recording
    // commands must still complete before this barrier is released.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = PdfDocuments.prototype.rasterRegion;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    Object.assign(window, {
      performanceRenderStarted: false,
      releasePerformanceRender: release,
    });
    PdfDocuments.prototype.rasterRegion = async function (...args) {
      Object.assign(window, { performanceRenderStarted: true });
      await pending;
      PdfDocuments.prototype.rasterRegion = original;
      return original.apply(this, args);
    };
  });
  const rendering = cli(page, 'sheet.render', {
    sheetId,
    path: 'performance-sheet.png',
    maxDimension: 128,
    mode: 'plan',
  });
  try {
    await Promise.race([
      page.waitForFunction(
        () =>
          (window as unknown as { performanceRenderStarted: boolean })
            .performanceRenderStarted,
      ),
      rendering.then((result) => {
        throw new Error(
          `sheet.render completed before the PDF barrier: ${JSON.stringify(result.response)}`,
        );
      }),
    ]);
    const status = await cli<{
      active: boolean;
      preparation: { total: number };
    }>(page, 'performance.status');
    expect(status.response.data.active).toBe(true);
    expect(status.response.data.preparation.total).toBe(1);
    const stopped = await cli<PerformanceReport>(page, 'performance.stop');
    expect(stopped.response.ok).toBe(true);
    expect(stopped.response.data.active).toBe(false);
    expect(stopped.response.data.metadata.rendererVersion).toBe(
      'pdfjs-6.4.299-display-worker-v2',
    );
    await expect(
      page.getByRole('button', { name: 'Record performance', exact: true }),
    ).toBeVisible();
    const download = page.waitForEvent('download');
    const exported = await cli(page, 'performance.export');
    expect(exported.response.ok).toBe(true);
    const path = await (await download).path();
    if (!path) throw new Error('Performance report download is unavailable');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(
      stopped.response.data,
    );
  } finally {
    await page.evaluate(() => {
      (
        window as unknown as { releasePerformanceRender(): void }
      ).releasePerformanceRender();
    });
  }
  const rendered = await rendering;
  expect(rendered.response.ok, JSON.stringify(rendered.response)).toBe(true);
  expect(errors).toEqual([]);
});
