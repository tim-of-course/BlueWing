import { test, expect } from '@playwright/test';
import { detailedWorkflow, systemWorkflow } from './detailed';
import { startProject } from './takeoff';
test('production detailed takeoff and review workflow', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await detailedWorkflow(page);
  await page.getByLabel('Workspace view').selectOption('split');
  const viewer = page.getByRole('region', { name: '3D construction viewer' });
  await expect(viewer.getByRole('status')).toBeHidden();
  // GPU frames use a transient drawing buffer. Let the reopened view paint,
  // then capture its presented pixels through the browser compositor.
  await viewer.getByRole('img').evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
      ),
  );
  await page.screenshot({ path: info.outputPath('construction-split.png') });
  expect(errors).toEqual([]);
});

test('rejected PDF imports release their workers and preserve the open project', async ({
  page,
}) => {
  await startProject(page);
  const sheetId = await page
    .getByLabel('Drawing canvas', { exact: true })
    .getAttribute('data-sheet-id');
  let created = 0;
  let closed = 0;
  page.on('worker', (worker) => {
    created++;
    worker.on('close', () => {
      closed++;
    });
  });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
    await (
      await choosing
    ).setFiles({
      name: 'invalid.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('This is not a PDF'),
    });
    await expect(page.getByRole('alert')).toContainText('Invalid PDF');
    await expect.poll(() => closed).toBe(attempt);
    expect(created).toBe(attempt);
    await expect(
      page.getByLabel('Drawing canvas', { exact: true }),
    ).toHaveAttribute('data-sheet-id', sheetId ?? '');
  }
});

test('production reusable component systems share inputs and survive reopening', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await systemWorkflow(page);
  expect(errors).toEqual([]);
});
