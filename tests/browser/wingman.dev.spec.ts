import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Locator } from '@playwright/test';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import {
  activityWorkflow,
  captureErrors,
  cli,
  mutate,
  sendText,
  captureWorkflow,
  draftWorkflow,
  messagingWorkflow,
  keyboardWorkflow,
  promptWorkflow,
  modelWorkflow,
  startWingmanProject,
  transcriptWorkflow,
  unreadWorkflow,
  viewWorkflow,
  warmSwapWorkflow,
} from './wingman';
import { drawWall } from './takeoff';
import type { Project } from '../../src/core/types';
import { openPanel } from './panels';

for (const [name, workflow] of [
  ['CLI activity since opening the project', activityWorkflow],
  ['connection prompts and clipboard fallback', promptWorkflow],
  ['Enter sends, Shift+Enter and composition do not', keyboardWorkflow],
  ['chat follows the reader or their own message', transcriptWorkflow],
  ['reopened chat only badges new replies', unreadWorkflow],
  [
    'Wingman drafts protect project switches and allow view swaps',
    draftWorkflow,
  ],
  ['CLI renders and exact view restoration', viewWorkflow],
  [
    'warm swaps and collapse reuse source pixels with live annotations',
    warmSwapWorkflow,
  ],
  ['message cursors, long polling, pause and project close', messagingWorkflow],
  ['live 3D preview, split restoration and draft protection', modelWorkflow],
  ['screenshot pixels, editing and conversation persistence', captureWorkflow],
] as const) {
  test(name, async ({ page }, testInfo) => {
    const errors = await captureErrors(page);
    // Preserve the drawing bounds during swaps and include all visible panels in the capture workflow.
    if (
      workflow === viewWorkflow ||
      workflow === modelWorkflow ||
      workflow === captureWorkflow
    )
      await page.setViewportSize({ width: 1760, height: 720 });
    await startWingmanProject(page, true);
    await openPanel(page, 'Wingman');
    const { artifact } = await captureBrowserArtifact(
      page,
      () => workflow(page),
      { scenario: `wingman-${testInfo.title}` },
    );
    const path = testInfo.outputPath('solid-diagnostics.json');
    await writeFile(path, JSON.stringify(artifact, null, 2));
    await testInfo.attach('solid-diagnostics', {
      path,
      contentType: 'application/json',
    });
    expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
    expectNoDiagnostics(artifact);
    expectNoSilentHolds(artifact);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('wingman.png') });
  });
}

test('plan and 3D views travel inside Wingman messages', async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 1490, height: 940 });
  await startWingmanProject(page, true);
  await openPanel(page, 'Wingman');
  await drawWall(page);
  const project = (await cli<Project>(page, 'project.inspect')).response.data;
  const geometry = Object.values(project.geometries)[0];
  if (!geometry) throw new Error('Wall is missing');
  await mutate(page, 'wall.put', {
    id: 'header-wall',
    geometryId: geometry.id,
    baseElevation: 0,
    height: 10,
    studSpacing: 1.333,
    stud: { materialId: 'stud', width: 0.125, depth: 0.292 },
    track: { materialId: 'track', width: 0.125, depth: 0.292 },
    finishes: [],
  });
  const before = (await cli(page, 'project.inspect')).response;
  const render = async (name: string, payload: object) => {
    const result = await cli<{ viewId: string }>(page, name, payload);
    expect(result.response.ok, JSON.stringify(result.response)).toBe(true);
    return result.response.data.viewId;
  };
  const plan = await render('sheet.render', {
    sheetId: geometry.sheetId,
    path: 'wingman-plan.png',
    maxDimension: 640,
  });
  const model = await render('construction.render', {
    path: 'wingman-model.png',
    width: 800,
    height: 480,
  });
  const sheet = project.sheets[geometry.sheetId];
  const ends = geometry.points;
  if (!sheet || !ends[0] || !ends[1])
    throw new Error('Wall endpoints are missing');
  const wall = {
    x: (ends[0].x + ends[1].x) / (2 * sheet.width),
    y: (ends[0].y + ends[1].y) / (2 * sheet.height),
  };
  const marks = [
    { kind: 'arrow', points: [{ x: wall.x + 0.18, y: wall.y + 0.28 }, wall] },
  ];
  const framing = [
    {
      kind: 'ellipse',
      points: [
        { x: 0.39, y: 0.32 },
        { x: 0.58, y: 0.66 },
      ],
    },
  ];
  const result = await cli(page, 'messages.send', {
    text: 'Please check this wall in plan and framing.',
    views: [
      { viewId: plan, caption: 'Wall location', annotations: marks },
      { viewId: model, caption: 'Framing detail', annotations: framing },
    ],
  });
  expect(result.response.ok).toBe(true);
  const article = page
    .locator('article')
    .filter({ hasText: 'Please check this wall' });
  const planCard = article.getByRole('button', {
    name: 'Open view: Wall location',
  });
  const modelCard = article.getByRole('button', {
    name: 'Open view: Framing detail',
  });
  const pink = (canvas: Locator) =>
    canvas.evaluate((el) => {
      const ctx = (el as HTMLCanvasElement).getContext('2d');
      if (!ctx) return false;
      const bytes = ctx.getImageData(
        0,
        0,
        ctx.canvas.width,
        ctx.canvas.height,
      ).data;
      for (let i = 0; i < bytes.length; i += 4)
        if (bytes[i] === 158 && bytes[i + 1] === 23 && bytes[i + 2] === 77)
          return true;
      return false;
    });
  await expect
    .poll(() => pink(planCard.getByLabel('View annotations')))
    .toBe(true);
  await expect
    .poll(() => pink(modelCard.getByLabel('View annotations')))
    .toBe(true);
  const screenshot = async (name: string) => {
    if (browserName === 'chromium') {
      await mkdir('tmp/wingman-views', { recursive: true });
      await page.screenshot({ path: `tmp/wingman-views/${name}.png` });
    }
  };
  await expect(article.getByRole('status')).toHaveCount(0);
  await screenshot('agent-reply');
  await modelCard.click();
  await expect
    .poll(() =>
      pink(
        page
          .locator('.construction-viewport')
          .getByLabel('View annotations', { exact: true }),
      ),
    )
    .toBe(true);
  const screen = await page
    .locator('.construction-viewport canvas')
    .first()
    .boundingBox();
  if (!screen) throw new Error('3D canvas is missing');
  expect(screen.width / screen.height).toBeCloseTo(800 / 480, 1);
  await page.getByRole('button', { name: 'Return to your view' }).click();
  const button = (name: string) =>
    page.getByRole('button', { name, exact: true });
  await button('Attach view').click();
  await button('Cancel').click();
  await expect(button('Send')).toBeDisabled();
  await page
    .getByLabel('Workspace view', { exact: true })
    .selectOption('split');
  await button('Attach view').click();
  await button('3D').click();
  const dialog = page.getByRole('dialog', { name: 'Annotate view' });
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeEnabled();
  await dialog.getByLabel('View annotation tool').selectOption('freehand');
  const box = await dialog.getByLabel('View annotation surface').boundingBox();
  if (!box) throw new Error('View annotation editor is missing');
  await page.mouse.move(box.x + box.width * 0.48, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.47, {
    steps: 4,
  });
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.54, {
    steps: 4,
  });
  await page.mouse.up();
  await expect
    .poll(() => pink(dialog.getByLabel('View annotation surface')))
    .toBe(true);
  await screenshot('annotating-view');
  await button('Done').click();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Please check the marked framing.');
  await button('Send').click();
  const sentCard = page
    .locator('article')
    .filter({ hasText: 'Please check the marked framing.' })
    .getByRole('button', { name: 'Open view: 3D view' });
  await expect
    .poll(() => pink(sentCard.getByLabel('View annotations')))
    .toBe(true);
  const row = (await cli(page, 'messages.read')).response.messages.at(-1);
  if (!row) throw new Error('User message is missing');
  expect(row.views?.[0]).toMatchObject({
    view: { kind: '3d' },
    annotations: [{ kind: 'freehand' }],
    image: { name: '3D view' },
  });
  expect(JSON.stringify(row)).not.toContain('data:image');
  expect((await cli(page, 'project.inspect')).response.revision).toBe(
    before.revision,
  );
  await screenshot('user-message');
});

test('turn log, editor continuity and visible saved views', async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await startWingmanProject(page, true);
  const errors = await captureErrors(page);
  const panel = page.getByRole('complementary', { name: 'Wingman' });
  const log = panel.getByRole('log');
  await expect(
    panel.locator('form').getByRole('button', { name: 'Collapse Wingman' }),
  ).toBeVisible();
  const button = (name: string) =>
    page.getByRole('button', { name, exact: true });
  const screenshot = async (name: string, sidebarOnly = false) => {
    if (browserName === 'chromium') {
      await mkdir('tmp/wingman-sidebar', { recursive: true });
      await (sidebarOnly ? panel : page).screenshot({
        path: `tmp/wingman-sidebar/${name}.png`,
      });
    }
  };
  await expect(button('Pin Inspector')).toBeVisible();
  await expect(button('Collapse Wingman')).toBeVisible();
  await expect(button('Collapse Sheets')).toBeVisible();
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  expect((await canvas.boundingBox())?.width).toBeGreaterThanOrEqual(600);
  await button('Pin Inspector').click();
  await expect(button('Collapse Inspector')).toBeVisible();
  await expect(button('Pin Sheets')).toBeVisible();
  await page.setViewportSize({ width: 760, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    760,
  );
  await expect(button('Pin Wingman')).toBeInViewport();
  await expect(button('Pin Sheets')).toBeInViewport();
  await button('Pin Wingman').click();
  await expect(panel).toBeVisible();
  expect((await canvas.boundingBox())?.width).toBeGreaterThanOrEqual(598);
  await page.setViewportSize({ width: 1760, height: 900 });
  await expect(button('Collapse Sheets')).toBeVisible();
  await button('Collapse Inspector').click();
  await page.setViewportSize({ width: 1400, height: 900 });
  const resizer = page.getByRole('separator', { name: 'Resize Wingman' });
  await expect(resizer).toHaveAttribute('aria-valuenow', '380');
  await resizer.press('ArrowLeft');
  await expect(resizer).toHaveAttribute('aria-valuenow', '396');
  await resizer.press('ArrowRight');
  const composer = panel.locator('form');
  await expect(
    composer.getByRole('button', { name: 'Collapse Wingman' }),
  ).toBeVisible();
  await expect(
    composer.getByRole('button', { name: 'Attach screenshot' }),
  ).toHaveAttribute('title', 'Attach screenshot');
  await expect(composer.getByRole('button', { name: 'Send' })).toHaveAttribute(
    'title',
    /Shift\+Enter/,
  );
  await resizer.evaluate((element) => {
    (element as HTMLElement).blur();
  });
  await expect(panel.getByRole('status')).toHaveText('Not connected');
  await screenshot('expanded-idle');
  await expect(
    composer
      .getByRole('button', { name: 'Collapse Wingman' })
      .locator('svg rect'),
  ).toHaveCount(1);
  await screenshot('header-not-connected', true);
  await sendText(page, 'Check the partition along the east wall.');
  const sheetId = await page
    .getByLabel('Drawing canvas')
    .getAttribute('data-sheet-id');
  const turnStart = Date.now();
  await page.clock.setFixedTime(new Date(turnStart));
  await cli(page, 'messages.read');
  await cli(page, 'wingman.inspect');
  await mutate(page, 'batch', {
    commands: [
      {
        name: 'geometry.put',
        payload: {
          id: 'east-wall',
          kind: 'path',
          name: 'East partition',
          sheetId,
          points: [
            { x: 72, y: 144 },
            { x: 360, y: 144 },
          ],
        },
      },
    ],
  });
  await cli(page, 'sheet.render', {
    sheetId,
    path: 'detail.png',
    caption: 'East partition',
    maxDimension: 640,
    highlightIds: ['east-wall'],
  });
  await expect(
    log.getByRole('img', { name: 'Live workspace preview' }),
  ).toBeVisible();
  await expect(log.getByText('Loading plan…')).toBeHidden();
  await expect(panel.locator('.wingman-status')).toHaveText('Working');
  await expect(button('Copy AI prompt')).toBeHidden();
  await screenshot('mid-turn');
  await screenshot('header-working', true);
  await sendText(page, 'Include the return at the doorway.');
  await page.clock.setFixedTime(new Date(turnStart + 161_000));
  await cli(page, 'messages.send', {
    text: 'I traced the east partition. The doorway return still needs a dimension.',
  });
  const rollup = button('Worked for 2m 41s');
  await expect(rollup).toBeVisible();
  const waiting = cli(page, 'messages.wait', { timeoutMs: 25000 }, 3);
  await expect(panel.locator('.wingman-status')).toHaveText('Waiting for you');
  await screenshot('header-idle', true);
  await button('Wingman options').click();
  await panel.getByRole('menuitem', { name: 'End conversation' }).click();
  expect((await waiting).exitCode).toBe(0);
  await button('Wingman options').press('Enter');
  await panel.getByRole('menuitem', { name: 'Copy AI prompt' }).press('Enter');
  await expect(
    panel.getByRole('region', { name: 'Connect your AI' }),
  ).toBeVisible();
  await button('Wingman options').press('Enter');
  await panel.getByRole('menuitem', { name: 'Copy AI prompt' }).press('Enter');
  await expect(log.locator('.wingman-preview')).toHaveCount(0);
  await rollup.click();
  await screenshot('finished-turn');
  await log.getByRole('button', { name: /Changed/ }).click();
  await log
    .getByRole('button', { name: 'East partition', exact: true })
    .click();
  await expect(page.getByLabel('Object name', { exact: true })).toHaveValue(
    'East partition',
  );
  await log.getByRole('button', { name: /Rendered/ }).click();
  await expect(log.locator('.wingman-preview canvas')).toHaveCount(1);
  await sendText(
    page,
    Array.from({ length: 40 }, (_, i) => `Field note ${String(i + 1)}`).join(
      '\n',
    ),
  );
  await expect(log.locator('.wingman-preview canvas')).toHaveCount(0);
  await log
    .getByRole('button', { name: 'Swap to agent view' })
    .scrollIntoViewIfNeeded();
  await expect(log.locator('.wingman-preview canvas')).toHaveCount(1);
  await rollup.click();
  await page
    .getByLabel('Message', { exact: true })
    .fill('Waiting on the field dimension.');
  for (const [command, dialog] of [
    ['Assemblies', 'Assembly editor'],
    ['Construction', 'Construction editor'],
    ['Review', 'Takeoff review'],
  ] as const) {
    expect(errors).toEqual([]);
    await button(command).click();
    const editor = page.getByRole('dialog', { name: dialog });
    const bounds = await editor.boundingBox();
    expect(bounds).toBeTruthy();
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
      (await panel.boundingBox())?.x ?? 0,
    );
    await page.getByLabel('Message', { exact: true }).click();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
      'Waiting on the field dimension.',
    );
    expect(errors).toEqual([]);
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(editor).toBeHidden();
  }
  await button('Quantities').click();
  await expect(page.locator('.quantities')).toBeVisible();
  await expect(log).toContainText('I traced the east partition');
  await log.evaluate((el) => {
    el.scrollTop = 0;
  });
  await screenshot('quantities');
  await button('Drawing').click();
  await composer.getByRole('button', { name: 'Collapse Wingman' }).click();
  await page.mouse.move(0, 0);
  await cli(page, 'messages.send', { text: 'The field dimension is in.' });
  await expect(button('Pin Wingman (1 unread)')).toBeVisible();
  await expect(
    button('Pin Wingman (1 unread)').locator('svg rect'),
  ).toHaveCount(0);
  await screenshot('collapsed-unread');
  await button('Pin Wingman (1 unread)').click();
  await expect(log).toContainText('The field dimension is in.');
  await page.getByLabel('Message', { exact: true }).fill('');
  await button('Close').click();
  await button('Open project').click();
  await expect(rollup).toBeVisible();
  await expect(rollup).toHaveAttribute('aria-expanded', 'false');
  expect(errors).toEqual([]);
});
