import { expect, test } from '@playwright/test';
import type {} from './sheet-text-harness';

test('CLI prefetch retrieves actual page text and bulk renames atomically without the dialog', async ({
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
            titleBlockText?: string;
            truncated?: boolean;
            characterCount?: number;
            lines?: { x: number; y: number }[];
          }[];
          nextOffset: number | null;
        })
      : undefined;
  expect(data?.sheets[0]?.text).toContain('A101 NORTH WING FLOOR PLAN');
  expect(data?.sheets[0]?.titleBlockText).toBe('');
  expect(data?.sheets[0]?.lines?.[0]?.y).toBeCloseTo(50, 0);
  expect(data?.sheets[1]?.text).toContain('S201 STRUCTURAL PLAN');
  expect(data?.sheets[2]?.status).toBe('no-embedded-text');
  expect(data?.sheets[3]?.truncated).toBe(true);
  expect(data?.sheets[3]?.characterCount).toBeGreaterThan(32768);
  expect(data?.nextOffset).toBeNull();
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
