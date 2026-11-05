import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('sheet order, history, recent projects and dropped PDFs', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page.getByLabel('Project name', { exact: true }).fill('Navigation job');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
  await (await choosing).setFiles('tests/fixtures/sheet-name-plan.pdf');
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  await expect(page.locator('.sheet-row')).toHaveCount(2);
  const first = await canvas.getAttribute('data-sheet-id');
  if (!first) throw new Error('First sheet not displayed');
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const zoom = await canvas.getAttribute('data-camera-zoom');
  await page.keyboard.press('ArrowDown');
  await expect(canvas).not.toHaveAttribute('data-sheet-id', first);
  const second = await canvas.getAttribute('data-sheet-id');
  if (!second || !zoom) throw new Error('Sheet or zoom missing');
  await page.getByRole('button', { name: 'Previous viewed sheet' }).click();
  await expect(canvas).toHaveAttribute('data-sheet-id', first);
  await expect(canvas).toHaveAttribute('data-camera-zoom', zoom);
  await page.getByRole('button', { name: 'Next viewed sheet' }).click();
  await expect(canvas).toHaveAttribute('data-sheet-id', second);
  await page.locator('.sheet-row').first().click({ button: 'right' });
  await page
    .getByRole('menu', { name: 'Sheet actions' })
    .getByRole('menuitem')
    .first()
    .focus();
  await page.keyboard.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-sheet-id', second);
  await page.keyboard.press('Escape');
  await page
    .getByLabel('Recent projects')
    .selectOption({ label: 'Navigation job' });
  await expect(canvas).toHaveAttribute('data-sheet-id', second);
  await expect(
    page.getByRole('button', { name: 'Previous viewed sheet' }),
  ).toBeEnabled();
  await page.keyboard.press('ArrowUp');
  await expect(canvas).toHaveAttribute('data-sheet-id', first);
  await page.getByLabel('Filter sheets and groups').fill('test');
  await page.keyboard.press('ArrowDown');
  await expect(canvas).toHaveAttribute('data-sheet-id', first);
  await page.getByLabel('Filter sheets and groups').fill('');
  const bytes = Array.from(
    await readFile('tests/fixtures/assessment-plan.pdf'),
  );
  await page.evaluate((data) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array(data)], 'dropped.pdf', {
        type: 'application/pdf',
      }),
    );
    window.dispatchEvent(
      new DragEvent('drop', {
        dataTransfer: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, bytes);
  await expect(page.locator('.sheet-row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByLabel('Recent projects')
    .selectOption({ label: 'Navigation job' });
  await expect(page.locator('.sheet-row')).toHaveCount(3);
});

test('a missing recent project and a failed PDF batch explain what happened', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'bluewing.recentProjects',
      JSON.stringify([{ path: 'browser:missing', name: 'Missing job' }]),
    );
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page.getByLabel('Project name', { exact: true }).fill('Current job');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page
    .getByLabel('Recent projects')
    .selectOption({ label: 'Missing job' });
  await expect(page.getByRole('alert')).toContainText(
    'Could not open recent project',
  );
  await expect(page.getByRole('button', { name: 'Current job' })).toBeVisible();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
  const valid = await readFile('tests/fixtures/assessment-plan.pdf');
  await (
    await choosing
  ).setFiles([
    { name: 'good.pdf', mimeType: 'application/pdf', buffer: valid },
    {
      name: 'broken.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('not a PDF'),
    },
    { name: 'later.pdf', mimeType: 'application/pdf', buffer: valid },
  ]);
  await expect(page.getByRole('alert')).toContainText(
    '1 earlier file was imported',
  );
  await expect(page.getByRole('alert')).toContainText('broken.pdf');
  await expect(page.getByRole('alert')).toContainText(
    '1 later file was not imported',
  );
  await expect(page.locator('.sheet-row')).toHaveCount(1);
});

test('recent projects and header fit with long project names', async ({
  page,
}) => {
  await page.setViewportSize({ width: 760, height: 800 });
  await page.addInitScript(() => {
    localStorage.setItem(
      'bluewing.recentProjects',
      JSON.stringify([
        {
          path: 'C:\\' + 'long-directory\\'.repeat(20) + 'job.bluewing',
          name: 'A very long project name '.repeat(10),
        },
      ]),
    );
  });
  await page.goto('/');
  const recent = page.getByLabel('Recent projects');
  await expect(recent).toBeVisible();
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page
    .getByLabel('Project name', { exact: true })
    .fill('A long project name '.repeat(12));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(
    await recent.evaluate((element) => element.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(145);
  const header = page.locator('.workspace-header');
  expect(
    await header.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expect(page.getByRole('button', { name: 'Updates' })).toBeInViewport();
});
