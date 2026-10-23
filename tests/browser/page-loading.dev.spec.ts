import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import type { PageImages as PageImageCache } from '../../src/pdf/page-images';
import type { RasterResource as Resource } from '../../src/pdf/raster';
import type { RasterLease, RasterProgress } from '../../src/pdf/raster';
import type { Project } from '../../src/core/types';
import { cli } from './wingman';

async function setup(page: Page, cachedPreview: boolean) {
  await page.goto('/tests/browser/wingman-harness.html');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Preview loading');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
  await (await choosing).setFiles('tests/fixtures/sheet-name-plan.pdf');
  await expect(
    page.getByLabel('Drawing canvas', { exact: true }),
  ).toHaveAttribute('aria-busy', 'false');
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
  const project = (await cli<Project>(page, 'project.inspect')).response.data;
  const sheets = Object.values(project.sheets).sort(
    (a, b) => a.pageIndex - b.pageIndex,
  );
  const ids = sheets.map((sheet) => sheet.id);
  expect(ids).toHaveLength(2);
  const control = await page.evaluateHandle(
    async ({ ids, cachedPreview }) => {
      const imagesPath = '/src/pdf/page-images.ts',
        rasterPath = '/src/pdf/raster.ts';
      const { PageImages } = (await import(imagesPath)) as {
        PageImages: typeof PageImageCache;
      };
      const { RasterResource } = (await import(rasterPath)) as {
        RasterResource: typeof Resource;
      };
      // Hold real viewer acquisitions independently so the pending screen is observable.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalAcquire = PageImages.prototype.acquire;
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalPeek = PageImages.prototype.peek;
      const resources = new Map<string, Resource>();
      const pending = new Map<string, (lease: RasterLease) => void>();
      const signals = new Map<string, AbortSignal | undefined>();
      const progress = new Map<string, RasterProgress>();
      const requested: string[] = [],
        released: string[] = [];
      for (const [index, id] of ids.entries()) {
        for (const kind of ['preview', 'full']) {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = kind === 'preview' ? 64 : 128;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Missing fixture context');
          context.fillStyle =
            kind === 'preview'
              ? index
                ? '#00ff00'
                : '#ff0000'
              : index
                ? '#ff00ff'
                : '#0000ff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          resources.set(
            `${id}/${kind}`,
            new RasterResource(
              await createImageBitmap(canvas),
              Promise.resolve(new Uint8Array()),
            ),
          );
        }
      }
      const lease = (key: string): RasterLease => {
        const result = resources.get(key)?.lease();
        if (!result) throw new Error(`Unknown fixture ${key}`);
        return {
          ...result,
          release() {
            released.push(key);
            result.release();
          },
        };
      };
      PageImages.prototype.peek = function (sheet, dimension) {
        return cachedPreview && dimension === 640
          ? lease(`${sheet.id}/preview`)
          : null;
      };
      PageImages.prototype.acquire = function (
        sheet,
        dimension,
        signal,
        observer,
      ) {
        const key = `${sheet.id}/${dimension === 640 ? 'preview' : 'full'}`;
        requested.push(key);
        signals.set(key, signal);
        if (observer) progress.set(sheet.id, observer);
        // Intentionally allow late completion after cancellation, like an in-flight decode.
        return new Promise<RasterLease>((resolve) => {
          pending.set(key, resolve);
        });
      };
      return {
        complete(id: string, kind: string) {
          const key = `${id}/${kind}`,
            resolve = pending.get(key);
          if (!resolve) throw new Error(`No pending ${key}`);
          pending.delete(key);
          resolve(lease(key));
        },
        progress(id: string) {
          const observer = progress.get(id);
          if (!observer) throw new Error(`No progressive request for ${id}`);
          observer.onProgress(lease(`${id}/preview`), 'coarse');
        },
        requested: () => requested.slice(),
        released: () => released.slice(),
        aborted: (id: string, kind: string) =>
          signals.get(`${id}/${kind}`)?.aborted,
        restore() {
          PageImages.prototype.acquire = originalAcquire;
          PageImages.prototype.peek = originalPeek;
          for (const resource of resources.values()) resource.release();
        },
      };
    },
    { ids, cachedPreview },
  );
  return { control, ids };
}

async function color(canvas: Locator) {
  return canvas.evaluate((element: HTMLCanvasElement) => [
    ...(element
      .getContext('2d')
      ?.getImageData(
        Math.floor(element.width / 2),
        Math.floor(element.height / 2),
        1,
        1,
      ).data ?? []),
  ]);
}
function row(page: Page, id: string) {
  return page.locator(`.sheet-branch[data-sheet-id="${id}"] .sheet-row`);
}

for (const cachedPreview of [true, false]) {
  test(`page switch uses progressive pixels with ${cachedPreview ? 'a resident' : 'no'} sidebar preview`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const { control, ids } = await setup(page, cachedPreview);
    const target = ids[1];
    if (!target) throw new Error('Missing target sheet');
    const canvas = page.getByLabel('Drawing canvas', { exact: true });
    try {
      const { artifact } = await captureBrowserArtifact(
        page,
        async () => {
          await row(page, target).click();
          await expect(canvas).toHaveAttribute('aria-busy', 'true');
          await control.evaluate((control, id) => {
            control.progress(id);
          }, target);
          await expect.poll(() => color(canvas)).toEqual([0, 255, 0, 255]);
          // Intermediate pixels must not announce full-resolution completion.
          await expect(canvas).toHaveAttribute('aria-busy', 'true');
          const camera = await canvas.getAttribute('data-camera-zoom');
          await control.evaluate((control, id) => {
            control.complete(id, 'full');
          }, target);
          await expect(canvas).toHaveAttribute('aria-busy', 'false');
          await expect.poll(() => color(canvas)).toEqual([255, 0, 255, 255]);
          await expect(canvas).toHaveAttribute(
            'data-camera-zoom',
            camera ?? '',
          );
          expect(
            await control.evaluate((control) => control.requested()),
          ).toEqual([`${target}/full`]);
          expect(
            await control.evaluate((control) => control.released()),
          ).toContain(`${target}/preview`);
        },
        { scenario: info.title },
      );
      await writeFile(
        info.outputPath('solid-diagnostics.json'),
        JSON.stringify(artifact, null, 2),
      );
      expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
      expectNoDiagnostics(artifact);
      expectNoSilentHolds(artifact);
      expect(errors).toEqual([]);
    } finally {
      await control.evaluate((control) => {
        control.restore();
      });
    }
  });
}

test('late progressive and full-image completions cannot overwrite a newer page or sharper image', async ({
  page,
}) => {
  const { control, ids } = await setup(page, false);
  const [first, second] = ids;
  if (!first || !second) throw new Error('Missing fixture sheets');
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  try {
    await row(page, second).click();
    await expect(canvas).toHaveAttribute('aria-busy', 'true');
    await row(page, first).click();
    await expect(canvas).toHaveAttribute('data-sheet-id', first);
    await control.evaluate((control, id) => {
      control.progress(id);
    }, first);
    await expect.poll(() => color(canvas)).toEqual([255, 0, 0, 255]);
    expect(
      await control.evaluate(
        (control, id) => control.aborted(id, 'full'),
        second,
      ),
    ).toBe(true);
    await control.evaluate((control, id) => {
      control.progress(id);
      control.complete(id, 'full');
    }, second);
    await expect.poll(() => color(canvas)).toEqual([255, 0, 0, 255]);
    await control.evaluate((control, id) => {
      control.complete(id, 'full');
    }, first);
    await expect(canvas).toHaveAttribute('aria-busy', 'false');
    await expect.poll(() => color(canvas)).toEqual([0, 0, 255, 255]);
    await row(page, second).click();
    await control.evaluate((control, id) => {
      control.complete(id, 'full');
    }, second);
    await expect.poll(() => color(canvas)).toEqual([255, 0, 255, 255]);
    await control.evaluate((control, id) => {
      control.progress(id);
    }, second);
    await expect.poll(() => color(canvas)).toEqual([255, 0, 255, 255]);
    expect(await control.evaluate((control) => control.released())).toEqual(
      expect.arrayContaining([
        `${first}/preview`,
        `${second}/preview`,
        `${second}/full`,
      ]),
    );
  } finally {
    await control.evaluate((control) => {
      control.restore();
    });
  }
});
