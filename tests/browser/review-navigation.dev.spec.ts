import { expect, test, type Page } from '@playwright/test';
import type { WorkspaceViewSnapshot } from '../../src/app/wingman-types';
import { captureErrors, cli, mutate, startWingmanProject } from './wingman';

const assembly = {
  id: 'review-assembly',
  name: 'Review assembly',
  category: 'Insulation',
  geometryKinds: ['path'],
  inputs: [],
  outputs: [
    {
      id: 'length',
      name: 'Length',
      materialId: 'review-material',
      unit: 'ft',
      formula: 'length',
      allowance: { wastePercent: 0 },
    },
  ],
};

async function setupReviewSource(page: Page) {
  await startWingmanProject(page, true);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const sheetId = await canvas.getAttribute('data-sheet-id');
  if (!sheetId) throw new Error('Expected an imported sheet');
  const geometryId = 'review-trace';
  await mutate(page, 'geometry.put', {
    id: geometryId,
    name: 'Review trace',
    sheetId,
    kind: 'path',
    points: [
      { x: 80, y: 100 },
      { x: 200, y: 150 },
    ],
  });
  return { canvas, geometryId };
}

async function openReview(page: Page) {
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  return page.getByRole('dialog', { name: 'Takeoff review' });
}

async function inspectView(page: Page) {
  return (await cli<{ main: WorkspaceViewSnapshot }>(page, 'wingman.inspect'))
    .response.data.main;
}

for (const start of [
  'plan',
  '3d',
  'split',
  'quantities',
  'filtered',
] as const) {
  test(`Review reveals and selects its source from ${start}`, async ({
    page,
  }) => {
    const errors = await captureErrors(page);
    const { canvas, geometryId } = await setupReviewSource(page);
    const view = page.getByLabel('Workspace view', { exact: true });
    if (start === '3d' || start === 'split') await view.selectOption(start);
    if (start === 'quantities') {
      await view.selectOption('split');
      await page
        .getByRole('button', { name: 'Quantities', exact: true })
        .click();
      await expect(canvas).toBeHidden();
    }
    const hideGroup = page.getByRole('button', {
      name: /^Hide Review scope on /,
    });
    if (start === 'filtered') {
      await mutate(page, 'group.put', {
        id: 'review-scope',
        name: 'Review scope',
        geometryIds: [geometryId],
      });
      await mutate(page, 'recipe.put', assembly);
      await mutate(page, 'assignment.put', {
        id: 'review-assignment',
        groupId: 'review-scope',
        recipeId: assembly.id,
        inputs: {},
        allowances: {},
      });
      const filter = page.locator('details.category-filter').first();
      await filter.locator('summary').click();
      await filter.getByLabel('All', { exact: true }).uncheck();
      await filter.getByLabel('Uncategorized', { exact: true }).check();
      await filter.locator('summary').click();
      expect((await inspectView(page)).plan?.visibleGeometryIds).toEqual([]);
      await hideGroup.click();
      await expect(
        page.getByRole('button', { name: /^Show Review scope on / }),
      ).toBeVisible();
      const before = await inspectView(page);
      expect(before.plan?.categories).toEqual([null]);
      expect(before.plan?.visibleGeometryIds).toEqual([]);
    }
    expect((await inspectView(page)).context.selection).toEqual([]);
    const review = await openReview(page);
    await review
      .getByRole('button', { name: 'geometry · Review trace' })
      .click();
    await review.getByRole('button', { name: 'Show on plan' }).click();
    await expect(review).toBeHidden();
    await expect(canvas).toBeVisible();
    await expect(view).toHaveValue(start === 'split' ? 'split' : 'plan');
    await expect
      .poll(async () => (await inspectView(page)).context.selection)
      .toEqual([geometryId]);
    const after = await inspectView(page);
    expect(after.plan?.visibleGeometryIds).toEqual([geometryId]);
    if (start === 'filtered') {
      await expect(hideGroup).toBeVisible();
      expect(after.plan?.categories).toBeUndefined();
    }
    expect(errors).toEqual([]);
  });
}

test('Review hides Show on plan for an assembly without source geometry', async ({
  page,
}) => {
  await setupReviewSource(page);
  await mutate(page, 'recipe.put', assembly);
  await mutate(page, 'review.mark', {
    id: 'review-mark',
    target: { kind: 'assembly', id: assembly.id },
    status: 'question',
    note: '',
  });
  const review = await openReview(page);
  await review
    .getByRole('button', { name: 'assembly · Review assembly' })
    .click();
  await expect(
    review.getByRole('heading', { name: 'assembly · Review assembly' }),
  ).toBeVisible();
  await expect(
    review.getByRole('button', { name: 'Show on plan' }),
  ).toHaveCount(0);
});
