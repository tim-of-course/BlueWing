import { expect, test } from '@playwright/test';
import type { SheetThumbnails as ThumbnailCache } from '../../src/components/sheet-thumbnails';
import type { PdfDocuments as PdfDocumentCache } from '../../src/pdf/documents';
import { navigatorWorkflow } from './navigation';
import { startProject } from './takeoff';

test('closing detaches the project while PDF cleanup is pending and permits reopening', async ({
  page,
}) => {
  await startProject(page);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const sheetId = await canvas.getAttribute('data-sheet-id');
  await page.evaluate(async () => {
    const modulePath = '/src/pdf/documents.ts';
    const { PdfDocuments } = (await import(modulePath)) as {
      PdfDocuments: typeof PdfDocumentCache;
    };
    // Hold only the completion barrier; actual PDF destruction still runs.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = PdfDocuments.prototype.clear;
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    PdfDocuments.prototype.clear = async function () {
      await Promise.all([original.call(this), pending]);
    };
    Object.assign(window, {
      finishProjectClose: () => {
        PdfDocuments.prototype.clear = original;
        finish();
      },
    });
  });
  try {
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(canvas).toBeHidden();
    await expect(page.locator('.sheet-row')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Create project', exact: true }),
    ).toBeVisible();
  } finally {
    await page.evaluate(() => {
      (
        window as unknown as { finishProjectClose(): void }
      ).finishProjectClose();
    });
  }
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-sheet-id', sheetId ?? '');
  await expect(
    page.getByLabel('Drawing canvas', { exact: true }),
  ).toHaveAttribute('aria-busy', 'false');
});

test('a large sheet list retains only visible thumbnails and prioritizes its open preview', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modulePath = '/src/components/sheet-thumbnails.ts';
    const { SheetThumbnails } = (await import(modulePath)) as {
      SheetThumbnails: typeof ThumbnailCache;
    };
    const idleDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'requestIdleCallback',
    );
    const cancelDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'cancelIdleCallback',
    );
    const scheduled = new Map<number, IdleRequestCallback>();
    let schedules = 0;
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (callback: IdleRequestCallback) => {
        schedules++;
        scheduled.set(schedules, callback);
        return schedules;
      },
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: (id: number) => {
        scheduled.delete(id);
      },
    });
    const rendered: number[] = [];
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Fixture PNG unavailable'));
      }, 'image/png');
    });
    const png = new Uint8Array(await blob.arrayBuffer());
    canvas.width = canvas.height = 0;
    let pendingSignal: AbortSignal | undefined;
    let changed = () => {};
    const thumbnails = new SheetThumbnails(
      (sheet, signal) => {
        rendered.push(sheet.pageIndex);
        if (sheet.pageIndex === 71) {
          pendingSignal = signal;
          return new Promise<Uint8Array>((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                reject(new DOMException('Render cancelled', 'AbortError'));
              },
              { once: true },
            );
          });
        }
        return Promise.resolve(png);
      },
      () => {
        changed();
      },
    );
    const renderNext = async () => {
      const next = scheduled.entries().next().value;
      if (!next) throw new Error('Visible thumbnail was not scheduled');
      const ready = new Promise<void>((resolve) => {
        changed = resolve;
      });
      scheduled.delete(next[0]);
      next[1]({ didTimeout: false, timeRemaining: () => 50 });
      await ready;
    };
    try {
      const sheets = Array.from({ length: 164 }, (_, pageIndex) => ({
        id: `sheet-${String(pageIndex)}`,
        name: `Page ${String(pageIndex + 1)}`,
        assetId: 'large-plan',
        pageIndex,
        width: 100,
        height: 100,
      }));
      const sheet = sheets[37];
      if (!sheet) throw new Error('Requested sheet is missing');
      thumbnails.sync('project', []);
      const afterSync = schedules;
      const visible = sheets.slice(36, 42);
      const duplicate = { ...sheet, id: 'duplicate-page' };
      thumbnails.sync('project', [...visible, duplicate], sheet);
      thumbnails.sync('project', [...visible, duplicate], sheet);
      const afterRequests = schedules;
      await renderNext();
      const cached = thumbnails.get(sheet);
      const decoded = !!cached?.source && cached.image?.complete === true;
      const shared = thumbnails.get(duplicate) === cached;
      const renamed = { ...sheet, name: 'Renamed page' };
      thumbnails.sync(
        'project',
        visible.map((item) => (item === sheet ? renamed : item)),
        renamed,
      );
      const reused = thumbnails.get(renamed) === cached;
      const image = cached?.image;
      // Scroll before the other five visible pages start. The open preview is
      // pinned; its offscreen neighbors must leave both the cache and queue.
      thumbnails.sync('project', sheets.slice(70, 75), renamed);
      const pinned = thumbnails.get(renamed) === cached;
      const oldRowsReleased = visible
        .filter((item) => item.id !== sheet.id)
        .every((item) => !thumbnails.get(item));
      await renderNext();
      const pending = scheduled.entries().next().value;
      if (!pending) throw new Error('Next visible thumbnail was not scheduled');
      scheduled.delete(pending[0]);
      pending[1]({ didTimeout: false, timeRemaining: () => 50 });
      // Hiding the sidebar also closes its preview and cancels queued work.
      thumbnails.sync('project', []);
      await Promise.resolve();
      return {
        afterSync,
        afterRequests,
        rendered,
        decoded,
        shared,
        reused,
        pinned,
        oldRowsReleased,
        offscreenRenderAborted: pendingSignal?.aborted === true,
        pendingAfterHide: scheduled.size,
        released: image?.getAttribute('src') === null,
      };
    } finally {
      thumbnails.clear();
      if (idleDescriptor)
        Object.defineProperty(window, 'requestIdleCallback', idleDescriptor);
      else Reflect.deleteProperty(window, 'requestIdleCallback');
      if (cancelDescriptor)
        Object.defineProperty(window, 'cancelIdleCallback', cancelDescriptor);
      else Reflect.deleteProperty(window, 'cancelIdleCallback');
    }
  });
  expect(result).toEqual({
    afterSync: 0,
    afterRequests: 1,
    rendered: [37, 70, 71],
    decoded: true,
    shared: true,
    reused: true,
    pinned: true,
    oldRowsReleased: true,
    offscreenRenderAborted: true,
    pendingAfterHide: 0,
    released: true,
  });
});

test('sheet navigation preserves previews, groups, layout and saved order', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error')
      errors.push(message.text());
  });
  await navigatorWorkflow(page);
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await page
    .getByRole('button', { name: 'Walls, 1 drawing objects', exact: true })
    .click();
  await page.locator('.sheet-row').last().hover();
  await expect(
    page.getByRole('tooltip', { name: 'Sheet preview' }).getByRole('img'),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('navigator.png') });
});
