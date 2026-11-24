import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { detailedWorkflow, systemWorkflow } from './detailed';
import { drawWall } from './takeoff';
import { startWingmanProject } from './wingman';

for (const editor of ['construction', 'review note', 'snippet'] as const) {
  test(`${editor} keeps its draft locked until the save settles`, async ({
    page,
  }) => {
    await startWingmanProject(page, true);
    const construction = editor === 'construction';
    if (!construction) await drawWall(page);
    await page
      .getByRole('button', {
        name: construction ? 'Construction' : 'Review',
        exact: true,
      })
      .click();
    const dialog = page.getByRole('dialog', {
      name: construction ? 'Construction editor' : 'Takeoff review',
    });
    if (construction) {
      await dialog.getByLabel('Construction type').selectOption('levels');
      await dialog.getByRole('button', { name: 'New level' }).click();
    } else if (editor === 'review note') {
      await dialog.getByRole('button', { name: /geometry · Path 1/ }).click();
    } else {
      await dialog.getByRole('button', { name: 'Plan snippets' }).click();
      await dialog
        .getByRole('button', { name: 'New snippet from selection' })
        .click();
    }
    const field = dialog.getByLabel(
      construction
        ? 'Name'
        : editor === 'review note'
          ? 'Review note'
          : 'Snippet name',
      { exact: true },
    );
    const save = dialog.getByRole('button', {
      name: construction
        ? 'Save construction'
        : editor === 'review note'
          ? 'Mark reviewed'
          : 'Save snippet',
      exact: true,
    });
    const cancel = dialog.getByRole('button', {
      name: editor === 'review note' ? 'Discard note edits' : 'Cancel edits',
    });
    const close = dialog.getByRole('button', { name: 'Close', exact: true });
    await field.fill('Draft to preserve');

    for (const fail of [true, false]) {
      const release = await page.evaluateHandle(() =>
        (
          window as unknown as {
            holdNextProjectSave(): (fail: boolean) => void;
          }
        ).holdNextProjectSave(),
      );
      await save.click();
      try {
        await expect(field).toBeDisabled();
        await expect(cancel).toBeDisabled();
        await expect(save).toBeDisabled();
        await expect(close).toBeDisabled();
      } finally {
        await release.evaluate((finish, reject) => {
          finish(reject);
        }, fail);
        await release.dispose();
      }
      await expect(field).toBeEnabled();
      await expect(cancel).toBeEnabled();
      await expect(field).toHaveValue('Draft to preserve');
      if (fail) {
        await expect(dialog.getByRole('alert')).toHaveText('Test save failed');
        await expect(close).toBeDisabled();
      } else {
        await expect(close).toBeEnabled();
      }
    }
  });
}

test('positioned takeoff, linked 3D and highlighted review survive reopening', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('[STRICT_'))
      errors.push(message.text());
  });
  await detailedWorkflow(page);
  await page.getByLabel('Workspace view', { exact: true }).hover();
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await page
        .getByLabel('Workspace view', { exact: true })
        .selectOption('3d');
      const viewer = page.getByRole('region', {
        name: '3D construction viewer',
      });
      await expect(viewer).toBeVisible();
      await viewer
        .getByRole('combobox', { name: 'Role', exact: true })
        .selectOption('stud');
      await expect(viewer).toContainText('19 objects shown');
      const plan = viewer.getByRole('checkbox', { name: 'Show plan' });
      await expect(plan).toBeChecked();
      await plan.uncheck();
      await page
        .getByLabel('Workspace view', { exact: true })
        .selectOption('plan');
      await page
        .getByLabel('Workspace view', { exact: true })
        .selectOption('3d');
      await expect(plan).not.toBeChecked();
      await expect(viewer.getByRole('status')).toBeHidden();
      const canvas = viewer.locator('canvas');
      const withoutPlan = await canvas.screenshot();
      await plan.check();
      await expect
        .poll(async () => (await canvas.screenshot()).equals(withoutPlan))
        .toBe(false);
    },
    { scenario: 'construction-view' },
  );
  await writeFile(
    info.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});

test('component system editing updates both materials without reactive warnings', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.text().includes('[STRICT_'))
      errors.push(message.text());
  });
  await systemWorkflow(page);
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await page.getByLabel('height', { exact: true }).fill('11');
      await page
        .getByRole('button', { name: 'Save assignment', exact: true })
        .click();
      await expect(
        page.getByRole('table', { name: 'Material totals' }),
      ).toContainText('264 ft²');
      await expect(
        page.getByRole('table', { name: 'Piece schedule' }),
      ).toContainText("11'");
    },
    { scenario: 'shared-system-dimensions' },
  );
  await writeFile(
    info.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});
