import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import type { PdfDocuments as PdfDocumentCache } from '../../src/pdf/documents';
import type { PageImages as PageImageCache } from '../../src/pdf/page-images';
import { captureErrors } from './wingman';

declare global {
  interface Window {
    sidebarPreviews: {
      state(): {
        queued: number;
        renders: { pageIndex: number; visible: boolean; aborted: boolean }[];
      };
      advance(): void;
      restore(): void;
    };
  }
}

test('the real sidebar requests only visible previews and cancels work on scroll and collapse', async ({
  page,
}, info) => {
  const errors = captureErrors(page);
  await page.goto('/');
  await page.evaluate(async () => {
    const modulePath = '/src/pdf/documents.ts';
    const { PdfDocuments } = (await import(modulePath)) as {
      PdfDocuments: typeof PdfDocumentCache;
    };
    const imagesPath = '/src/pdf/page-images.ts';
    const { PageImages } = (await import(imagesPath)) as {
      PageImages: typeof PageImageCache;
    };
    const descriptors = [
      [PdfDocuments.prototype, 'import'],
      [PageImages.prototype, 'render'],
      [PageImages.prototype, 'prepare'],
    ].map(
      ([target, key]) =>
        [
          target as object,
          key as string,
          Object.getOwnPropertyDescriptor(target, key as string),
        ] as const,
    );
    // Background preparation has separate coverage. This test observes the
    // sidebar's requests to the cache, whether a request hits disk or renders.
    PageImages.prototype.prepare = () => {};
    const idleDescriptors = ['requestIdleCallback', 'cancelIdleCallback'].map(
      (key) => [key, Object.getOwnPropertyDescriptor(window, key)] as const,
    );
    const queued = new Map<number, IdleRequestCallback>();
    let nextId = 0;
    Object.assign(window, {
      requestIdleCallback: (callback: IdleRequestCallback) => {
        queued.set(++nextId, callback);
        return nextId;
      },
      cancelIdleCallback: (id: number) => {
        queued.delete(id);
      },
    });
    // Real import UI and sheet rows, without parsing or rasterizing a large PDF.
    PdfDocuments.prototype.import = (assetId) =>
      Promise.resolve(
        Array.from({ length: 164 }, (_, pageIndex) => ({
          id: `viewport-sheet-${String(pageIndex)}`,
          name: `Page ${String(pageIndex + 1)}`,
          assetId,
          pageIndex,
          width: 100,
          height: 100,
        })),
      );
    const renders: {
      pageIndex: number;
      visible: boolean;
      signal: AbortSignal;
    }[] = [];
    PageImages.prototype.render = (sheet, size, signal) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      if (size !== 640) return Promise.resolve(canvas);
      if (!signal)
        throw new Error('Thumbnail render has no cancellation signal');
      const list = document.querySelector('.sheet-list');
      const row = document.querySelector(
        `.sheet-branch[data-sheet-id="${sheet.id}"] .sheet-row`,
      );
      if (!list || !row) throw new Error('Sidebar row is missing');
      const viewport = list.getBoundingClientRect();
      const bounds = row.getBoundingClientRect();
      renders.push({
        pageIndex: sheet.pageIndex,
        visible:
          list.closest('aside')?.getAttribute('aria-hidden') === 'false' &&
          bounds.bottom > viewport.top &&
          bounds.top < viewport.bottom,
        signal,
      });
      // Hold the raster so scrolling and collapse must cancel actual UI work.
      return new Promise<HTMLCanvasElement>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(new DOMException('Thumbnail left view', 'AbortError'));
          },
          { once: true },
        );
      });
    };
    window.sidebarPreviews = {
      state: () => ({
        queued: queued.size,
        renders: renders.map(({ pageIndex, visible, signal }) => ({
          pageIndex,
          visible,
          aborted: signal.aborted,
        })),
      }),
      advance: () => {
        const next = queued.entries().next().value;
        if (!next) throw new Error('No visible thumbnail is queued');
        queued.delete(next[0]);
        next[1]({ didTimeout: false, timeRemaining: () => 50 });
      },
      restore: () => {
        for (const [target, key, descriptor] of descriptors)
          if (descriptor) Object.defineProperty(target, key, descriptor);
        for (const [key, descriptor] of idleDescriptors) {
          if (descriptor) Object.defineProperty(window, key, descriptor);
          else Reflect.deleteProperty(window, key);
        }
      },
    };
  });
  const state = () => page.evaluate(() => window.sidebarPreviews.state());
  try {
    await page
      .getByRole('button', { name: 'Create project', exact: true })
      .click();
    await page.getByLabel('Project name', { exact: true }).fill('Visible rows');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
    await (await choosing).setFiles('tests/fixtures/assessment-plan.pdf');
    await expect(page.locator('.sheet-row')).toHaveCount(164);
    await expect.poll(async () => (await state()).queued).toBe(1);
    // Measure updates to the loaded list, independently of its initial mount.
    const { artifact } = await captureBrowserArtifact(
      page,
      async () => {
        await page.evaluate(() => {
          window.sidebarPreviews.advance();
        });
        expect((await state()).renders).toEqual([
          { pageIndex: 0, visible: true, aborted: false },
        ]);
        await page.locator('.sheet-row').nth(1).click();
        await expect(page.locator('.sheet-row').nth(1)).toHaveAttribute(
          'aria-current',
          'page',
        );
        await expect(
          page.getByLabel('Drawing canvas', { exact: true }),
        ).toHaveAttribute('data-sheet-id', 'viewport-sheet-1');

        await page.locator('.sheet-list').evaluate((list) => {
          list.scrollTop = list.scrollHeight;
        });
        await expect
          .poll(async () => (await state()).renders[0]?.aborted)
          .toBe(true);
        await expect.poll(async () => (await state()).queued).toBe(1);
        await page.evaluate(() => {
          window.sidebarPreviews.advance();
        });
        const scrolled = (await state()).renders;
        expect(scrolled).toHaveLength(2);
        expect(scrolled[1]?.pageIndex).toBeGreaterThan(100);
        expect(scrolled[1]?.visible).toBe(true);

        await page
          .getByRole('button', { name: 'Collapse Sheets', exact: true })
          .click();
        await page.mouse.move(700, 600);
        await expect(
          page.getByRole('complementary', { name: 'Sheets', exact: true }),
        ).toBeHidden();
        await expect
          .poll(async () => (await state()).renders[1]?.aborted)
          .toBe(true);
        expect((await state()).queued).toBe(0);
        expect((await state()).renders).toHaveLength(2);
      },
      { scenario: 'sidebar-visible-thumbnail-rendering' },
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
    await page.evaluate(() => {
      window.sidebarPreviews.restore();
    });
  }
});
