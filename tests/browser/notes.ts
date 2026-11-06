import { expect, type Page } from '@playwright/test';
import { cli } from './wingman';

export async function notesWorkflow(page: Page, harness = false) {
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  const editor = page.getByLabel('Markdown scratchpad', { exact: true });
  await editor.fill('# Scratchpad\nÄ detail.* detail.*\n😀 another');
  await page.getByLabel('Find in notes', { exact: true }).fill('DETAIL.*');
  await expect(
    page.getByRole('status').filter({ hasText: '2 matches' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Next match', exact: true }).click();
  expect(
    await editor.evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd),
    ),
  ).toBe('detail.*');
  await page.getByRole('button', { name: 'Inspector', exact: true }).click();
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(editor).toHaveValue(
    '# Scratchpad\nÄ detail.* detail.*\n😀 another',
  );
  await editor.press('Control+s');
  await expect(
    page.getByRole('button', { name: 'Save notes', exact: true }),
  ).toBeDisabled();
  if (harness) {
    expect(
      (await cli<{ markdown: string }>(page, 'notes.read')).response.data
        .markdown,
    ).toContain('😀 another');
    const mutate = async (markdown: string) => {
      const current = (await cli(page, 'project.inspect')).response;
      return page.evaluate(
        async ({ projectId, revision, markdown }) => {
          return (
            window as unknown as {
              wingmanCli(name: string, request: unknown): Promise<unknown>;
            }
          ).wingmanCli('notes.write', {
            projectId,
            expectedRevision: revision,
            payload: { markdown },
          });
        },
        { projectId: current.projectId, revision: current.revision, markdown },
      );
    };
    await mutate('Accepted CLI text');
    await expect(editor).toHaveValue('Accepted CLI text');
    await editor.fill('Unsaved draft');
    const closed = await cli(page, 'project.close');
    expect(closed.response.ok).toBe(false);
    await mutate('Concurrent CLI text');
    await expect(editor).toHaveValue('Unsaved draft');
    await page.getByRole('button', { name: 'Save notes', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('conflict');
    await expect(editor).toHaveValue('Unsaved draft');
    expect(
      (await cli<{ markdown: string }>(page, 'notes.read')).response.data
        .markdown,
    ).toBe('Concurrent CLI text');
    await page
      .getByRole('button', { name: 'Cancel notes', exact: true })
      .click();
    await expect(editor).toHaveValue('Concurrent CLI text');
  }
  await editor.fill('Discard me');
  await page.getByRole('button', { name: 'Cancel notes', exact: true }).click();
  await expect(editor).not.toHaveValue('Discard me');
}
