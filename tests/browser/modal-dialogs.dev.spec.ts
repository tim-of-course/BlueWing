import { expect, test, type Locator, type Page } from '@playwright/test';
import type * as ApplicationModule from '../../src/app/application';
import { startProject } from './takeoff';

async function expectTabCycle(
  page: Page,
  [first, ...rest]: [Locator, ...Locator[]],
) {
  const last = rest.at(-1) ?? first;
  await expect(first).toBeFocused();
  for (const control of rest) {
    await page.keyboard.press('Tab');
    await expect(control).toBeFocused();
  }
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
}

async function holdCommand(page: Page, command: string) {
  await page.evaluate(
    async ({ moduleUrl, command }) => {
      const { Application } = (await import(
        moduleUrl
      )) as typeof ApplicationModule;
      // eslint-disable-next-line @typescript-eslint/unbound-method -- The wrapper calls dispatch with the original receiver.
      const dispatch = Application.prototype.dispatch;
      Application.prototype.dispatch = async function (request) {
        if (request.name === command) {
          Application.prototype.dispatch = dispatch;
          await new Promise<void>((resolve) => {
            window.addEventListener(
              'release-command',
              () => {
                resolve();
              },
              { once: true },
            );
          });
        }
        return dispatch.call(this, request);
      };
    },
    { moduleUrl: '/src/app/application.ts', command },
  );
}

async function expectPendingDialog(
  page: Page,
  dialog: Locator,
  cancel: Locator,
) {
  await expect(cancel).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('release-command')));
}

test('project dialogs contain focus and restore it after Escape or saving', async ({
  page,
}) => {
  await page.goto('/');
  const create = page.getByRole('button', {
    name: 'Create project',
    exact: true,
  });
  await create.click();
  const createDialog = page.getByRole('dialog', { name: 'Create project' });
  const projectName = page.getByRole('textbox', { name: 'Project name' });
  const save = page.getByRole('button', { name: 'Save', exact: true });
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
  await expectTabCycle(page, [projectName, save, cancel]);
  await page.keyboard.press('Escape');
  await expect(createDialog).toBeHidden();
  await expect(create).toBeFocused();

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await projectName.fill('Modal project');
  await save.click();
  await expect(createDialog).toBeHidden();

  const rename = page.getByTitle('Rename project');
  const renameDialog = page.getByRole('dialog', { name: 'Rename project' });
  await rename.click();
  await expectTabCycle(page, [projectName, save, cancel]);
  await page.keyboard.press('Escape');
  await expect(renameDialog).toBeHidden();
  await expect(rename).toBeFocused();

  await rename.click();
  await projectName.fill('Renamed modal project');
  await holdCommand(page, 'project.rename');
  await save.click();
  await expectPendingDialog(page, renameDialog, cancel);
  await expect(renameDialog).toBeHidden();
  await expect(rename).toHaveText('Renamed modal project');
  await expect(rename).toBeFocused();
});

test('Updates contains focus and ignores Escape during an update', async ({
  page,
}) => {
  await page.goto('/');
  const updates = page.getByRole('button', { name: 'Updates', exact: true });
  await updates.click();
  const dialog = page.getByRole('dialog', { name: 'Web application updates' });
  const url = dialog.getByRole('textbox', { name: 'Manifest URL' });
  const close = dialog.getByRole('button', { name: 'Close' });
  const download = dialog.getByRole('button', { name: 'Download update' });
  await expectTabCycle(page, [url, close]);
  await url.fill('https://example.invalid/manifest.json');
  await expectTabCycle(page, [url, download, close]);

  await holdCommand(page, 'web.stage');
  await download.click();
  await expectPendingDialog(page, dialog, close);
  await expect(dialog.getByRole('alert')).toContainText(
    'Web updates require the native application',
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(updates).toBeFocused();
});

test('Sheet details contains focus and restores it to the sheet row', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await startProject(page);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  const zoom = (await canvas.getAttribute('data-camera-zoom')) ?? '';
  expect(Number(zoom)).not.toBe(1);
  const row = page.locator('.sheet-row').first();
  const openDetails = async (action: string) => {
    await row.press('Shift+F10');
    await page.getByRole('menuitem', { name: action }).click();
  };
  const dialog = page.getByRole('dialog', { name: 'Sheet details' });
  await openDetails('Sheet properties');
  await expectTabCycle(page, [dialog.getByRole('button', { name: 'Close' })]);
  await page.keyboard.press('ControlOrMeta+1');
  await page.keyboard.press('q');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(canvas).toHaveAttribute('data-camera-zoom', zoom);
  await expect(row).toBeFocused();

  await openDetails('Delete sheet');
  await expect(
    dialog.getByRole('button', { name: 'Delete sheet' }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(row).toBeFocused();

  await openDetails('Rename sheet');
  const name = dialog.getByRole('textbox', { name: 'Sheet name' });
  const save = dialog.getByRole('button', { name: 'Save sheet' });
  const cancel = dialog.getByRole('button', { name: 'Cancel' });
  await expectTabCycle(page, [name, save, cancel]);
  await name.fill('Renamed modal sheet');
  await holdCommand(page, 'sheet.put');
  await save.click();
  await expectPendingDialog(page, dialog, cancel);
  await expect(dialog).toBeHidden();
  await expect(row).toContainText('Renamed modal sheet');
  await expect(row).toBeFocused();
  expect(errors).toEqual([]);
});
