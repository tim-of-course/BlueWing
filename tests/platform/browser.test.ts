import { companySizes } from '../../src/core/standard-sizes';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, firefox, webkit } from '@playwright/test';
import type { Browser } from '@playwright/test';
import { requireResourceGuard } from '../../scripts/resources';
import type * as StorageModule from '../../src/platform/browser-storage';

await requireResourceGuard();

async function storagePage(browser: Browser) {
  const page = await browser.newPage();
  const source = await readFile(
    'tests/platform/.compiled/browser-storage.js',
    'utf8',
  );
  await page.route('**/*', async (route) => {
    await route.fulfill(
      route.request().url().endsWith('/storage.js')
        ? { contentType: 'text/javascript', body: source }
        : {
            contentType: 'text/html',
            body: '<!doctype html><title>Storage test</title>',
          },
    );
  });
  await page.goto('http://bluewing.test');
  return page;
}

for (const browserType of [chromium, firefox, webkit]) {
  void test(`${browserType.name()}: IndexedDB failed open preserves the transaction error and closes the database`, async () => {
    const browser = await browserType.launch();
    try {
      const page = await storagePage(browser);
      const result = await page.evaluate(async () => {
        const modulePath = '/storage.js';
        const { BrowserStorage } = (await import(
          modulePath
        )) as typeof StorageModule;
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Called with the original store as the receiver.
        const add = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (
          value: unknown,
          key?: IDBValidKey,
        ) {
          const operation = add.call(this, value, key);
          operation.addEventListener('success', () => {
            // A duplicate key aborts the transaction after the first add succeeds.
            add.call(this, value, key);
          });
          return operation;
        };
        const storage = new BrowserStorage();
        const error = await storage
          .open('project', true)
          .catch((error: unknown) =>
            error instanceof Error ? error.name : String(error),
          )
          .finally(() => {
            IDBObjectStore.prototype.add = add;
          });
        const deleted = await new Promise<boolean>((resolve, reject) => {
          const deletion = indexedDB.deleteDatabase('bluewing-development');
          deletion.onsuccess = () => {
            resolve(true);
          };
          deletion.onblocked = () => {
            resolve(false);
          };
          deletion.onerror = () => {
            reject(deletion.error ?? new Error('IndexedDB deletion failed'));
          };
        });
        return { error, deleted };
      });
      assert.deepEqual(result, { error: 'ConstraintError', deleted: true });
    } finally {
      await browser.close();
    }
  });

  void test(`${browserType.name()}: IndexedDB failed reads leave no unhandled rejections`, async () => {
    const browser = await browserType.launch();
    try {
      const page = await storagePage(browser);
      const result = await page.evaluate(async () => {
        const modulePath = '/storage.js';
        const { BrowserStorage } = (await import(
          modulePath
        )) as typeof StorageModule;
        const storage = new BrowserStorage();
        await storage.open('project', true);
        const unhandled: string[] = [];
        window.addEventListener('unhandledrejection', (event) => {
          unhandled.push(String(event.reason));
        });
        // eslint-disable-next-line @typescript-eslint/unbound-method -- Called with the original store as the receiver.
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function (
          key: IDBValidKey | IDBKeyRange,
        ) {
          const operation = get.call(this, key);
          this.transaction.abort();
          return operation;
        };
        const errorName = (error: unknown) =>
          error instanceof Error ? error.name : String(error);
        try {
          const loadError = await storage.load().catch(errorName);
          const assetError = await storage.readAsset('asset').catch(errorName);
          // Give the browser a task turn to report any unhandled rejection.
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { loadError, assetError, unhandled };
        } finally {
          IDBObjectStore.prototype.get = get;
          await storage.close();
        }
      });
      assert.deepEqual(result, {
        loadError: 'AbortError',
        assetError: 'AbortError',
        unhandled: [],
      });
    } finally {
      await browser.close();
    }
  });

  void test(`${browserType.name()}: IndexedDB reopen, conflicts, and atomic asset failure`, async () => {
    const browser = await browserType.launch();
    try {
      const page = await storagePage(browser);
      const result = await page.evaluate(async (standardSizes) => {
        const modulePath = '/storage.js';
        const { BrowserStorage } = (await import(
          modulePath
        )) as typeof StorageModule;
        const storage = new BrowserStorage();
        const initial = {
          takeoffs: {
            main: {
              id: 'main',
              name: 'Main',
              kind: 'main' as const,
              owned: {},
            },
          },
          annotations: {
            detail: {
              id: 'detail',
              kind: 'text' as const,
              sheetId: 's',
              author: 'agent' as const,
              createdAt: '2026-11-18T00:00:00.000Z',
              points: [{ x: 2, y: 3 }],
              text: 'Verify head detail',
            },
          },
          formatVersion: 10 as const,
          standardSizes,
          allowSpecialOrderStuds: true,
          id: 'p',
          name: 'Original',
          revision: 0,
          sheets: {
            s: {
              id: 's',
              name: 'Plan',
              assetId: 'pdf',
              pageIndex: 0,
              width: 100,
              height: 100,
              calibration: { feetPerUnit: 2 },
            },
          },
          geometries: {},
          groups: {},
          recipes: {},
          assignments: {},
        };
        await storage.open('project', true);
        storage.stageAsset({
          id: 'pdf',
          name: 'plan.pdf',
          data: new Uint8Array([0, 255, 128]),
        });
        await storage.initialize(initial);
        await storage.close();
        await storage.open('project', false);
        const bytes = Array.from(await storage.readAsset('pdf'));
        const next = {
          ...initial,
          name: 'Saved',
          revision: 1,
          takeoffs: {
            ...initial.takeoffs,
            co: {
              id: 'co',
              name: 'CO 1',
              kind: 'change-order' as const,
              mainTakeoffId: 'main',
              owned: { geometries: ['copy'] },
            },
          },
          geometries: {
            copy: {
              id: 'copy',
              name: 'Copied count',
              sheetId: 's',
              kind: 'count' as const,
              points: [{ x: 2, y: 3 }],
            },
          },
          notes: '# Scratchpad\n😀 detail',
          categoryColors: { Special: '#8236DC' },
        };
        await storage.save(initial, next);
        let conflict = false;
        try {
          await storage.save(initial, { ...next, name: 'Stale' });
        } catch {
          conflict = true;
        }
        storage.stageAsset({
          id: 'pdf',
          name: 'duplicate.pdf',
          data: new Uint8Array([99]),
        });
        let duplicate = false;
        try {
          await storage.save(next, { ...next, name: 'Unsaved', revision: 2 });
        } catch {
          duplicate = true;
        }
        const saved = await storage.load();
        const retainedBytes = Array.from(await storage.readAsset('pdf'));
        await storage.close();
        let createConflict = false;
        try {
          await storage.open('project', true);
        } catch {
          createConflict = true;
        }
        return {
          bytes,
          retainedBytes,
          conflict,
          duplicate,
          createConflict,
          saved,
        };
      }, companySizes());
      assert.deepEqual(result.bytes, [0, 255, 128]);
      assert.deepEqual(result.retainedBytes, [0, 255, 128]);
      assert.ok(result.conflict && result.duplicate && result.createConflict);
      assert.equal(result.saved.annotations.detail?.text, 'Verify head detail');
      assert.equal(result.saved.name, 'Saved');
      assert.equal(result.saved.revision, 1);
      assert.equal(result.saved.takeoffs.co?.name, 'CO 1');
      assert.ok(result.saved.takeoffs.co);
      assert.equal(result.saved.sheets.s?.calibration?.feetPerUnit, 2);
      assert.ok(!('calibrations' in result.saved.takeoffs.co));
      assert.deepEqual(result.saved.takeoffs.co.owned.geometries, ['copy']);
      assert.equal(result.saved.sheets.s.assetId, 'pdf');
      assert.deepEqual(result.saved.categoryColors, { Special: '#8236DC' });
      assert.equal(result.saved.formatVersion, 10);
      assert.equal(result.saved.notes, '# Scratchpad\n😀 detail');
    } finally {
      await browser.close();
    }
  });
}
