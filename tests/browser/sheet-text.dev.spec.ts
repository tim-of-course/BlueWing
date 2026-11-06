import { expect, test } from '@playwright/test';
import type {} from './sheet-text-harness';

test('AI Page Naming reads only title blocks, ignoring a large body before the title, and applies names atomically', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/tests/browser/sheet-text-harness.html');
  const result = await page.evaluate(() => window.sheetTextWorkflow());
  expect(result.help.exitCode).toBe(0);
  expect(result.started.exitCode).toBe(0);
  expect(result.result.response.ok).toBe(true);
  expect(result.result.response.revision).toBe(result.before.expectedRevision);
  expect(result.immediate.exitCode).toBe(0);
  const data =
    'data' in result.result.response
      ? (result.result.response.data as {
          sheets: {
            text?: string;
            status: string;
            region?: { x: number; y: number; width: number; height: number };
            truncated?: boolean;
            characterCount?: number;
          }[];
          nextOffset: number | null;
        })
      : undefined;
  expect(data?.sheets[0]?.text).toContain('A101 NORTH WING FLOOR PLAN');
  expect(data?.sheets[0]?.text).not.toContain('UNRELATED');
  expect(data?.sheets[0]?.region).toEqual({
    x: 500,
    y: 400,
    width: 500,
    height: 400,
  });
  expect(data?.sheets[0]?.truncated).toBe(false);
  expect(data?.sheets[0]?.characterCount).toBeLessThan(100);
  expect(data?.sheets[1]?.text).toContain('S201 STRUCTURAL PLAN');
  expect(data?.sheets[2]?.status).toBe('no-title-block-text');
  expect(data?.sheets[3]?.truncated).toBe(true);
  expect(
    data?.sheets.every((sheet) => !sheet.text || sheet.text.length <= 1500),
  ).toBe(true);
  expect(data?.sheets[3]?.characterCount).toBeGreaterThan(1500);
  expect(data?.nextOffset).toBeNull();
  expect(JSON.stringify(data).length).toBeLessThan(6000);
  const started =
    'data' in result.started.response
      ? (result.started.response.data as {
          workflow: string;
          instructions: string;
        })
      : undefined;
  expect(started?.workflow).toBe('page-naming');
  expect(started?.instructions).toContain('sheet.naming.apply');
  expect(started?.instructions).toContain('sheet.render');
  const repeated =
    'data' in result.repeated.response
      ? (result.repeated.response.data as {
          sheets: { text: string }[];
          nextOffset: number | null;
        })
      : undefined;
  expect(repeated?.sheets).toHaveLength(1);
  expect(repeated?.sheets[0]?.text).toBe(data?.sheets[1]?.text);
  expect(repeated?.nextOffset).toBe(2);
  expect(result.status.ready).toBe(4);
  expect(result.invalid.exitCode).toBe(1);
  expect(result.unknown.exitCode).toBe(1);
  expect(result.duplicate.exitCode).toBe(1);
  expect(result.renamed.exitCode).toBe(0);
  expect(result.names.slice(0, 2)).toEqual([
    'A101 · NORTH WING FLOOR PLAN',
    'S201 · STRUCTURAL PLAN',
  ]);
  expect(result.undone).toEqual(result.oldNames);
  expect(result.stale.exitCode).toBe(3);
  expect(result.cacheAfterRename.ready).toBe(4);
  expect(result.cleared.cacheBytes).toBe(0);
  expect(result.reopened.ready).toBe(0);
  expect(result.cancelled.exitCode).toBe(0);
  expect(result.afterCancel.queued + result.afterCancel.reading).toBe(0);
  expect(errors).toEqual([]);
});
