import { expect, test } from '@playwright/test';
import { calculateAndReopen, drawWall, startProject } from './takeoff';

test('built takeoff workflow imports, calculates, exports and reopens', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startProject(page);
  await drawWall(page);
  await calculateAndReopen(page);
  await page.screenshot({ path: testInfo.outputPath('takeoff.png') });
  expect(errors).toEqual([]);
});
