import { test, expect, type Page } from '@playwright/test';
import type { PlanSnippet } from '../../src/core/review';
import { cli, mutate, startWingmanProject } from './wingman';

async function openSnippets(page: Page, importSecondPlan = false) {
  await startWingmanProject(page, true);
  if (importSecondPlan) {
    const choosing = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
    await (await choosing).setFiles('tests/fixtures/sheet-name-plan.pdf');
    await expect(
      page.getByRole('button', { name: 'Import PDF', exact: true }),
    ).toBeEnabled();
  }
  const sheetId = await page
    .getByLabel('Drawing canvas', { exact: true })
    .getAttribute('data-sheet-id');
  if (!sheetId) throw new Error('Expected an imported sheet');
  const snippet: PlanSnippet = {
    id: 'snippet-a',
    name: 'Snippet A',
    sheetId,
    bounds: { x: 10, y: 20, width: 200, height: 100 },
    sources: [],
    geometryIds: [],
    annotations: [],
    note: '',
  };
  await mutate(page, 'snippet.put', snippet);
  await mutate(page, 'snippet.put', {
    ...snippet,
    id: 'snippet-b',
    name: 'Snippet B',
  });
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Takeoff review' });
  await review.getByRole('button', { name: 'Plan snippets' }).click();
  await review.getByRole('button', { name: 'Snippet A' }).click();
  return { review, snippet };
}

function holdSheetRender(page: Page) {
  return page.evaluateHandle(() =>
    (
      window as unknown as {
        holdNextReviewSheetRender(): (fail: boolean) => void;
      }
    ).holdNextReviewSheetRender(),
  );
}

test('opening another snippet clears the pending preview', async ({ page }) => {
  const { review } = await openSnippets(page);
  const release = await holdSheetRender(page);
  await review.getByRole('button', { name: 'Pick region on sheet' }).click();
  await expect(review.getByRole('status')).toBeVisible();
  await review.getByRole('button', { name: 'Snippet B' }).click();
  await expect(review.getByLabel('Snippet name')).toHaveValue('Snippet B');
  await expect(review.getByRole('status')).toBeHidden();
  await release.evaluate((finish) => {
    finish(false);
  });
  await release.dispose();
  await expect(
    review.getByRole('button', { name: 'Preview snippet' }),
  ).toBeEnabled();
  await expect(review.getByRole('img')).toHaveCount(0);
});

for (const fail of [false, true]) {
  test(`switching source sheet discards obsolete ${fail ? 'errors' : 'pixels'}`, async ({
    page,
  }) => {
    const { review, snippet } = await openSnippets(page, true);
    const release = await holdSheetRender(page);
    const source = review.getByLabel('Source sheet');
    await expect(source.locator('option')).toHaveCount(3);
    const otherSheet = await source
      .locator('option')
      .evaluateAll(
        (options, current) =>
          options
            .map((option) => (option as HTMLOptionElement).value)
            .find((value) => value !== current),
        snippet.sheetId,
      );
    await review.getByRole('button', { name: 'Pick region on sheet' }).click();
    await expect(review.getByRole('status')).toBeVisible();
    if (!otherSheet) throw new Error('Expected another source sheet');
    await source.selectOption(otherSheet);
    await expect(source).toHaveValue(otherSheet);
    await expect(review.getByRole('status')).toBeHidden();
    await release.evaluate((finish, fail) => {
      finish(fail);
    }, fail);
    await release.dispose();
    await expect(review.getByRole('img')).toHaveCount(0);
    await expect(page.getByText('Obsolete sheet render failed')).toHaveCount(0);
  });
}

test('callouts use the displayed crop after bounds are edited', async ({
  page,
}) => {
  const { review, snippet } = await openSnippets(page);
  await review.getByRole('button', { name: 'Preview snippet' }).click();
  const preview = review.getByRole('img', {
    name: 'Highlighted plan snippet preview',
  });
  await expect(preview).toBeVisible();
  const src = await preview.getAttribute('src');
  if (!src) throw new Error('Expected a rendered crop');
  await review.getByLabel('x (page units)', { exact: true }).fill('50');
  await expect(preview).toHaveAttribute('src', src);
  await review.getByLabel('Callout text').fill('Center of displayed crop');
  await preview.click();
  await expect(review.getByText('Center of displayed crop')).toBeVisible();
  await review.getByRole('button', { name: 'Save snippet' }).click();
  await expect(
    review.getByRole('button', { name: 'Export PNG' }),
  ).toBeEnabled();
  const { response } = await cli<{ snippets: PlanSnippet[] }>(
    page,
    'review.inspect',
  );
  const saved = response.data.snippets.find(({ id }) => id === snippet.id);
  expect(saved?.bounds.x).toBe(50);
  expect(saved?.annotations[0]?.points[0]?.x).toBeCloseTo(110, 0);
  expect(saved?.annotations[0]?.points[0]?.y).toBeCloseTo(70, 0);
});
