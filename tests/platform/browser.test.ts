import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, webkit } from '@playwright/test';
import type * as StorageModule from '../../src/platform/browser-storage';

for (const browserType of [chromium, webkit]) {
  void test(`${browserType.name()}: IndexedDB reopen, conflicts, and atomic asset failure`, async () => {
    const browser = await browserType.launch();
    try {
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
      const result = await page.evaluate(async () => {
        const modulePath = '/storage.js';
        const { BrowserStorage } = (await import(
          modulePath
        )) as typeof StorageModule;
        const storage = new BrowserStorage();
        const initial = {
          formatVersion: 1 as const,
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
        const next = { ...initial, name: 'Saved', revision: 1 };
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
      });
      assert.deepEqual(result.bytes, [0, 255, 128]);
      assert.deepEqual(result.retainedBytes, [0, 255, 128]);
      assert.ok(result.conflict && result.duplicate && result.createConflict);
      assert.equal(result.saved.name, 'Saved');
      assert.equal(result.saved.revision, 1);
      assert.equal(result.saved.sheets.s?.assetId, 'pdf');
    } finally {
      await browser.close();
    }
  });
}
