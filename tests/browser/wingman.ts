import { expect, type Page } from '@playwright/test';
import { drawWall, pagePoint } from './takeoff';
import type { Project } from '../../src/core/types';
import type { Message, MessageWait } from '../../src/app/messaging';
import type {
  ModelView,
  WingmanVisual,
  WorkspaceViewSnapshot,
} from '../../src/app/wingman-types';

interface CliResult<T = unknown> {
  exitCode: number;
  response: {
    ok: boolean;
    data: T;
    revision: number;
    projectId: string;
    messages: Message[];
    error?: { code: string };
  };
}
async function mutate(page: Page, name: string, payload: unknown) {
  const current = (await cli(page, 'project.inspect')).response;
  const result = await page.evaluate(
    async ({ name, request }) => {
      const bridge = window as unknown as {
        wingmanCli(name: string, request: unknown): Promise<CliResult>;
      };
      return bridge.wingmanCli(name, request);
    },
    {
      name,
      request: {
        payload,
        projectId: current.projectId,
        expectedRevision: current.revision,
      },
    },
  );
  expect(result.response.ok, JSON.stringify(result.response)).toBe(true);
}
interface Inspection {
  main: WorkspaceViewSnapshot;
  agent: WingmanVisual | null;
  swapped: boolean;
  expanded: boolean;
}
export function cli<T = unknown>(
  page: Page,
  name: string,
  payload = {},
  messagesAfter = 0,
): Promise<CliResult<T>> {
  return page.evaluate(
    async ({ name, payload, messagesAfter }) => {
      const bridge = window as unknown as {
        wingmanCli(name: string, request: unknown): Promise<CliResult<T>>;
      };
      return bridge.wingmanCli(name, { payload, messagesAfter });
    },
    { name, payload, messagesAfter },
  );
}
async function inspect(page: Page) {
  const result = await cli<Inspection>(page, 'wingman.inspect');
  expect(result.exitCode).toBe(0);
  return result.response;
}
export async function captureErrors(page: Page) {
  const errors: string[] = [];
  const browser = page.context().browser()?.browserType().name();
  const chromium = browser === 'chromium';
  const disposalMarker = 'bluewing-test:explicit-webgl-context-loss';
  const explicitLosses = new Map<string, number>();
  if (browser === 'firefox')
    await page.addInitScript((marker) => {
      const wrapped = new WeakSet<WEBGL_lose_context>();
      WebGL2RenderingContext.prototype.getExtension = new Proxy(
        // The proxy forwards the native receiver below.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        WebGL2RenderingContext.prototype.getExtension,
        {
          apply(method, receiver: unknown, args: unknown[]) {
            const extension: unknown = Reflect.apply(method, receiver, args);
            if (args[0] === 'WEBGL_lose_context' && extension) {
              const context = extension as WEBGL_lose_context;
              if (!wrapped.has(context)) {
                wrapped.add(context);
                const lose = context.loseContext.bind(context);
                context.loseContext = () => {
                  console.debug(marker);
                  lose();
                };
              }
            }
            return extension;
          },
        },
      );
    }, disposalMarker);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    const location = message.location();
    if (
      browser === 'firefox' &&
      message.type() === 'debug' &&
      message.text() === disposalMarker
    ) {
      // Native warnings number lines from one; ordinary console locations start
      // at zero. Attribute each warning to the native call on the following line.
      const key = JSON.stringify([location.url, location.lineNumber + 2]);
      explicitLosses.set(key, (explicitLosses.get(key) ?? 0) + 1);
      return;
    }
    const lossKey = JSON.stringify([location.url, location.lineNumber]);
    const expectedLosses = explicitLosses.get(lossKey) ?? 0;
    // Keep unprompted context loss and every other warning/error as failures.
    if (
      browser === 'firefox' &&
      message.type() === 'warning' &&
      expectedLosses > 0 &&
      /^\[JavaScript Warning: "WebGL context was lost\." \{file: ".*" line: \d+\}\]$/.test(
        message.text(),
      )
    ) {
      explicitLosses.set(lossKey, expectedLosses - 1);
      return;
    }
    // CLI renders and screenshot tests intentionally read the GPU buffer.
    // Pixel assertions still verify the result; keep all other warnings/errors.
    if (
      chromium &&
      message.type() === 'warning' &&
      /^\[\.WebGL-0x[\da-f]+\]GL Driver Message \(OpenGL, Performance, GL_CLOSE_PATH_NV, High\): GPU stall due to ReadPixels(?: \(this message will no longer repeat\))?$/i.test(
        message.text(),
      )
    )
      return;
    if (message.type() === 'error' || message.type() === 'warning')
      errors.push(message.text());
  });
  return errors;
}
export async function startWingmanProject(page: Page, harness = false) {
  await page.goto(harness ? '/tests/browser/wingman-harness.html' : '/');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .click();
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Wingman fixture');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import PDF', exact: true }).click();
  await (await choosing).setFiles('tests/fixtures/assessment-plan.pdf');
  await expect(
    page.getByLabel('Drawing canvas', { exact: true }),
  ).toHaveAttribute('data-sheet-id', /.+/);
  await expect(
    page.getByLabel('Drawing canvas', { exact: true }),
  ).toHaveAttribute('aria-busy', 'false');
}
export async function sendText(page: Page, text: string) {
  const chat = page.getByRole('button', { name: 'Wingman chat', exact: true });
  if ((await chat.getAttribute('aria-expanded')) !== 'true') await chat.click();
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log', { name: 'Messages' })).toContainText(text);
}
export async function keyboardWorkflow(page: Page) {
  await page.getByRole('button', { name: 'Wingman chat', exact: true }).click();
  const input = page.getByLabel('Message', { exact: true });
  const log = page.getByRole('log', { name: 'Messages' });
  await input.fill('First line');
  await input.press('Shift+Enter');
  await input.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(element.value.length, element.value.length);
  });
  await input.press('a');
  await expect(input).toHaveValue('First line\na');
  await expect(log).not.toContainText('First line');
  await input.press('Enter');
  await expect(log).toContainText('First line\na');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await input.fill('Composed message');
  await input.dispatchEvent('compositionstart');
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(input).toHaveValue('Composed message');
  await expect(log).not.toContainText('Composed message');
  await input.dispatchEvent('compositionend');
  await input.dispatchEvent('keydown', { key: 'Enter', repeat: true });
  await expect(log).not.toContainText('Composed message');
  await input.press('Enter');
  await expect(log).toContainText('Composed message');
  await expect(input).toHaveValue('');
}

export async function browserPromptWorkflow(page: Page) {
  await page
    .getByRole('button', { name: 'Copy AI prompt', exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Connect your AI' });
  await expect(panel).toContainText(
    'Connecting an AI needs the Bluewing desktop app.',
  );
  await expect(
    page.getByRole('button', { name: 'Wingman + chat', exact: true }),
  ).toBeHidden();
}

export async function promptWorkflow(page: Page) {
  await browserPromptWorkflow(page);
  await page.evaluate(() => {
    const bridge = window as unknown as {
      wingmanConnection(info: {
        cliPath: string;
        shell: 'posix';
        dataDir: string;
      }): void;
      copiedPrompts: string[];
    };
    bridge.wingmanConnection({
      cliPath: '/Applications/Bluewing.app/Contents/MacOS/bluewing',
      shell: 'posix',
      dataDir: '/Users/test/Library/Application Support/com.bluewing.Bluewing',
    });
    bridge.copiedPrompts = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          bridge.copiedPrompts.push(text);
          return Promise.resolve();
        },
      },
    });
  });
  await expect(
    page.getByText('Talk here or in your AI’s chat.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Keep the conversation in your AI’s chat.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Wingman + chat', exact: true })
    .click();
  await expect(
    page.getByText('Prompt copied. Paste it into your AI’s chat.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Chat only', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { copiedPrompts: string[] }).copiedPrompts
            .length,
      ),
    )
    .toBe(2);
  const prompts = await page.evaluate(
    () => (window as unknown as { copiedPrompts: string[] }).copiedPrompts,
  );
  expect(prompts[0]).toContain(
    '/Applications/Bluewing.app/Contents/MacOS/bluewing',
  );
  expect(prompts[0]).toContain('Wingman fixture');
  expect(prompts[0]).toContain('Wingman + chat:');
  expect(prompts[0]).toContain('messages.wait');
  expect(prompts[1]).toContain('Wingman fixture');
  expect(prompts[1]).toContain('Chat only:');
  expect(prompts[0]).not.toEqual(prompts[1]);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    }),
  );
  await page
    .getByRole('button', { name: 'Wingman + chat', exact: true })
    .click();
  const fallback = page.getByLabel('AI connection prompt', { exact: true });
  await expect(fallback).toHaveValue(prompts[0] ?? '');
  await fallback.focus();
  expect(
    await fallback.evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      return input.selectionEnd - input.selectionStart;
    }),
  ).toBe(prompts[0]?.length);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error('Clipboard denied')),
      },
    }),
  );
  await page.getByRole('button', { name: 'Chat only', exact: true }).click();
  await expect(fallback).toHaveValue(prompts[1] ?? '');
}
export async function viewWorkflow(page: Page) {
  await drawWall(page);
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  await canvas.press('Control+1');
  const camera = await canvas.evaluate((element) =>
    ['data-camera-x', 'data-camera-y', 'data-camera-zoom'].map((name) =>
      element.getAttribute(name),
    ),
  );
  const before = await inspect(page);
  const sheetId = await canvas.getAttribute('data-sheet-id');
  const bounds = { x: 72, y: 144, width: 240, height: 180 };
  expect(
    (
      await cli(page, 'sheet.render', {
        sheetId,
        path: 'wingman.png',
        bounds,
        maxDimension: 640,
        caption: 'Check this detail',
      })
    ).exitCode,
  ).toBe(0);
  const quiet = await inspect(page);
  expect(quiet.data.expanded).toBe(false);
  expect(quiet.data.main).toEqual(before.data.main);
  expect(quiet.data.agent?.view).toMatchObject({
    kind: 'plan',
    sheetId,
    bounds,
  });
  expect((await cli(page, 'wingman.flash')).exitCode).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Swap to agent view', exact: true }),
  ).toContainText('Check this detail');
  const preview = page.getByRole('img', { name: 'Live workspace preview' });
  await expect(preview).toBeVisible();
  await expect(page.getByText('Loading plan…', { exact: true })).toBeHidden();
  const pixels = await preview.evaluate((element) =>
    (element as HTMLCanvasElement).toDataURL(),
  );
  expect(
    (
      await cli(page, 'wingman.annotate', {
        annotations: [
          {
            points: [
              { x: 90, y: 160 },
              { x: 180, y: 220 },
            ],
            color: '#ff0000',
            label: 'Check opening',
          },
        ],
        highlightIds: [],
      })
    ).exitCode,
  ).toBe(0);
  await expect
    .poll(() =>
      preview.evaluate((element) => (element as HTMLCanvasElement).toDataURL()),
    )
    .not.toBe(pixels);
  const annotated = await inspect(page);
  expect(annotated.revision).toBe(before.revision);
  expect(annotated.data.main).toEqual(before.data.main);
  await page
    .getByRole('button', { name: 'Swap to agent view', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Return to your view', exact: true }),
  ).toBeEnabled();
  const firstSwap = (await inspect(page)).data.main.plan;
  expect(firstSwap?.bounds).not.toEqual(before.data.main.plan?.bounds);
  // A later render must update the agent view without replacing the saved user view.
  expect(
    (
      await cli(page, 'sheet.render', {
        sheetId,
        path: 'wingman-next.png',
        bounds: { x: 180, y: 220, width: 100, height: 100 },
        maxDimension: 320,
      })
    ).exitCode,
  ).toBe(0);
  await expect
    .poll(async () => (await inspect(page)).data.main.plan?.bounds)
    .not.toEqual(firstSwap?.bounds);
  await page
    .getByRole('button', { name: 'Return to your view', exact: true })
    .click();
  await expect
    .poll(async () => (await inspect(page)).data.main)
    .toEqual(before.data.main);
  expect(
    await canvas.evaluate((element) =>
      ['data-camera-x', 'data-camera-y', 'data-camera-zoom'].map((name) =>
        element.getAttribute(name),
      ),
    ),
  ).toEqual(camera);
  expect((await inspect(page)).revision).toBe(before.revision);
}
export async function messagingWorkflow(page: Page) {
  await expect(
    page.getByText('Waiting for your message', { exact: true }),
  ).toBeHidden();
  await sendText(page, 'Please check this wall');
  const originalRow = await page
    .getByRole('log', { name: 'Messages' })
    .locator('.wingman-message')
    .first()
    .elementHandle();
  const sheetId = await page
    .getByLabel('Drawing canvas', { exact: true })
    .getAttribute('data-sheet-id');
  expect(
    (
      await cli(page, 'sheet.render', {
        sheetId,
        path: 'chat-view.png',
        maxDimension: 320,
      })
    ).exitCode,
  ).toBe(0);
  await cli(page, 'wingman.flash');
  const log = page.getByRole('log', { name: 'Messages' });
  await expect(
    page.getByRole('img', { name: 'Live workspace preview' }),
  ).toBeVisible();
  expect((await log.boundingBox())?.height).toBeGreaterThan(60);
  const success = await cli(page, 'project.inspect');
  expect(success.exitCode).toBe(0);
  expect(success.response.messages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sender: 'user',
        text: 'Please check this wall',
      }),
    ]),
  );
  expect((await cli(page, 'project.inspect')).response.messages).toEqual(
    success.response.messages,
  );
  const failed = await cli(page, 'sheet.render', {
    sheetId: 'missing',
    path: 'missing.png',
  });
  expect(failed.exitCode).not.toBe(0);
  expect(failed.response.messages).toEqual(success.response.messages);
  const cursor = success.response.messages.at(-1)?.id ?? 0;
  expect(
    (await cli(page, 'project.inspect', {}, cursor)).response.messages,
  ).toEqual([]);
  // A pending long poll must leave the application command queue available.
  const waiting = cli<Message[]>(
    page,
    'messages.read',
    { after: cursor, waitMs: 25000 },
    cursor,
  );
  const conversationWait = cli<MessageWait>(
    page,
    'messages.wait',
    { after: cursor, timeoutMs: 25000 },
    cursor,
  );
  await expect(
    page.getByText('Waiting for your message', { exact: true }),
  ).toBeVisible();
  expect(
    await originalRow.evaluate(
      (row) => row === document.querySelector('.wingman-message'),
    ),
  ).toBe(true);
  expect((await cli(page, 'project.inspect', {}, cursor)).exitCode).toBe(0);
  await sendText(page, 'The read must not block editing');
  expect((await waiting).response.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ text: 'The read must not block editing' }),
    ]),
  );
  expect((await conversationWait).response.data).toMatchObject({
    status: 'messages',
    messages: expect.arrayContaining([
      expect.objectContaining({ text: 'The read must not block editing' }),
    ]),
  });
  await expect(
    page.getByText('Waiting for your message', { exact: true }),
  ).toBeHidden();
  expect(
    await originalRow.evaluate(
      (row) => row === document.querySelector('.wingman-message'),
    ),
  ).toBe(true);
  const latest =
    (await cli(page, 'project.inspect')).response.messages.at(-1)?.id ?? 0;
  const stopped = cli<MessageWait>(
    page,
    'messages.wait',
    { after: latest, timeoutMs: 25000 },
    latest,
  );
  await page
    .getByRole('button', { name: 'End conversation', exact: true })
    .click();
  expect((await stopped).response.data).toMatchObject({
    status: 'ended',
    messages: [],
  });
  await expect(
    page.getByText('Waiting for your message', { exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'End conversation', exact: true }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Pause CLI', exact: true }).click();
  for (const name of [
    'commands.list',
    'project.inspect',
    'wingman.inspect',
    'undo',
    'performance.start',
    'performance.status',
    'performance.stop',
    'performance.export',
  ]) {
    const paused = await cli(page, name);
    expect(paused.exitCode, name).not.toBe(0);
    expect(paused.response.error?.code, name).toBe('WINGMAN_PAUSED');
  }
  expect((await cli(page, 'messages.read')).exitCode).toBe(0);
  expect(
    (
      await cli(page, 'messages.send', {
        text: 'I can still reply while paused',
      })
    ).exitCode,
  ).toBe(0);
  await expect(page.getByRole('log', { name: 'Messages' })).toContainText(
    'I can still reply while paused',
  );
  await page.getByRole('button', { name: 'Resume CLI', exact: true }).click();
  expect((await cli(page, 'project.inspect')).exitCode).toBe(0);
  expect(
    await originalRow.evaluate(
      (row) => row === document.querySelector('.wingman-message'),
    ),
  ).toBe(true);
}

export async function modelWorkflow(page: Page) {
  await drawWall(page);
  const project = (await cli<Project>(page, 'project.inspect')).response.data;
  const geometry = Object.values(project.geometries)[0];
  if (!geometry) throw new Error('Missing wall geometry');
  await mutate(page, 'wall.put', {
    id: 'wingman-wall',
    geometryId: geometry.id,
    baseElevation: 0,
    height: 3,
    studSpacing: 0.4,
    stud: { materialId: 'stud', width: 0.04, depth: 0.09 },
    track: { materialId: 'track', width: 0.04, depth: 0.09 },
    finishes: [],
  });
  await page
    .getByLabel('Workspace view', { exact: true })
    .selectOption('split');
  const viewer = page.getByRole('region', { name: '3D construction viewer' });
  await viewer
    .getByRole('combobox', { name: 'Role', exact: true })
    .selectOption('stud');
  await expect(viewer.getByRole('status')).toBeHidden();
  const view = viewer.getByRole('combobox', { name: 'View', exact: true });
  const display = viewer.getByRole('combobox', {
    name: 'Display',
    exact: true,
  });
  await view.selectOption('front');
  await display.selectOption('framing');
  await viewer
    .getByRole('button', { name: 'Fit selection', exact: true })
    .click();
  const fitted = (await inspect(page)).data.main.model;
  if (!fitted?.camera.target || !fitted.camera.span)
    throw new Error(
      'Fit selection did not set a physical camera target and span',
    );
  expect(fitted.camera.yaw).toBe(-Math.PI / 2);
  expect(fitted.camera.pitch).toBe(0);
  expect(fitted.camera.zoom).toBe(1);
  expect(fitted.camera.span).toBeGreaterThan(3);
  expect(fitted.displayMode).toBe('framing');
  const bounds = await viewer.getByRole('img').boundingBox();
  if (!bounds) throw new Error('Missing construction canvas');
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 35,
    bounds.y + bounds.height / 2 + 20,
    { steps: 4 },
  );
  await page.mouse.up({ button: 'right' });
  await expect
    .poll(async () => (await inspect(page)).data.main.model?.camera.target)
    .not.toEqual(fitted.camera.target);
  await viewer.getByRole('img').press('ArrowLeft');
  await viewer.getByRole('img').press('+');
  await expect(view).toHaveValue('');
  const before = (await inspect(page)).data.main;
  expect(before.model?.role).toBe('stud');
  expect(before.model?.camera.span).toBe(fitted.camera.span);
  expect(before.model?.camera.zoom).toBeCloseTo(1.2);
  const target = { ...fitted.camera.target, z: 2.75 };
  const span = fitted.camera.span * 1.25;
  const rendered = await cli<{
    camera: ModelView['camera'];
    displayMode: string;
  }>(page, 'construction.render', {
    path: 'model.png',
    width: 640,
    height: 480,
    role: 'top-track',
    view: 'front',
    target,
    span,
    zoom: 1.3,
    displayMode: 'xray',
    caption: 'Track detail',
  });
  expect(rendered.exitCode).toBe(0);
  expect(rendered.response.data.camera).toEqual({
    yaw: -Math.PI / 2,
    pitch: 0,
    target,
    span,
    zoom: 1.3,
  });
  expect(rendered.response.data.displayMode).toBe('xray');
  const validView = await inspect(page);
  expect(validView.data.agent?.view).toMatchObject({
    kind: '3d',
    camera: rendered.response.data.camera,
    displayMode: 'xray',
  });
  for (const invalid of [
    { zoom: 0.001 },
    { zoom: 10_001 },
    { elevation: -2 },
    { elevation: 2 },
  ]) {
    const rejected = await cli(page, 'construction.render', {
      path: 'invalid-camera.png',
      ...invalid,
    });
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.response.ok).toBe(false);
    expect(rejected.response.revision).toBe(validView.revision);
  }
  expect((await inspect(page)).data).toEqual(validView.data);
  await cli(page, 'wingman.flash');
  const preview = page.getByRole('img', { name: 'Live workspace preview' });
  await expect(preview).toBeVisible();
  const pixels = await preview.evaluate((el) =>
    (el as HTMLCanvasElement).toDataURL(),
  );
  // Accepted geometry edits repaint the live preview without another render command.
  await mutate(page, 'geometry.put', {
    ...geometry,
    points: [
      { x: 72, y: 144 },
      { x: 260, y: 300 },
    ],
  });
  await expect
    .poll(() => preview.evaluate((el) => (el as HTMLCanvasElement).toDataURL()))
    .not.toBe(pixels);
  await page
    .getByRole('button', { name: 'Swap to agent view', exact: true })
    .click();
  await expect(page.getByLabel('Workspace view', { exact: true })).toHaveValue(
    '3d',
  );
  await expect(
    viewer.getByRole('combobox', { name: 'Role', exact: true }),
  ).toHaveValue('top-track');
  await expect(view).toHaveValue('front');
  await expect(display).toHaveValue('xray');
  await expect
    .poll(async () => (await inspect(page)).data.main.model?.camera)
    .toEqual(rendered.response.data.camera);
  await page
    .getByRole('button', { name: 'Return to your view', exact: true })
    .click();
  await expect
    .poll(async () => (await inspect(page)).data.main)
    .toEqual(before);
  // An unfinished drawing gesture must not be discarded by swapping or a render.
  await page.getByLabel('Workspace view', { exact: true }).selectOption('plan');
  await page.getByRole('button', { name: 'Path (L)', exact: true }).click();
  await pagePoint(page, 110, 200);
  await expect(
    page.getByRole('button', { name: 'Finish', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Swap to agent view', exact: true }),
  ).toBeDisabled();
  expect(
    (
      await cli(page, 'sheet.render', {
        sheetId: geometry.sheetId,
        path: 'draft.png',
        maxDimension: 320,
      })
    ).exitCode,
  ).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Finish', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Drawing canvas', { exact: true }).press('Escape');
  await expect(
    page.getByRole('button', { name: 'Swap to agent view', exact: true }),
  ).toBeEnabled();
}

async function crop(
  page: Page,
  rect: { x: number; y: number; width: number; height: number },
  shortcut: boolean,
) {
  if (shortcut) await page.keyboard.press('Control+Shift+X');
  else
    await page
      .getByRole('button', { name: 'Attach screenshot', exact: true })
      .click();
  await expect(
    page.getByText('Drag to capture · Escape to cancel', { exact: true }),
  ).toBeVisible();
  const frozen = page.locator('.screenshot-capture canvas');
  await expect(frozen).toBeVisible();
  await expect(page.locator('.screenshot-capture img')).toHaveCount(0);
  const expectedPixels = await frozen.evaluate((element, rect) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Missing frozen screenshot context');
    const scaleX = canvas.width / innerWidth;
    const scaleY = canvas.height / innerHeight;
    const left = Math.round(rect.x * scaleX);
    const top = Math.round(rect.y * scaleY);
    const width = Math.round((rect.x + rect.width) * scaleX) - left;
    const height = Math.round((rect.y + rect.height) * scaleY) - top;
    const pixels = context.getImageData(left, top, width, height).data;
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619);
    const markerX = Math.round(26 * scaleX) - left;
    const markerY = Math.round(26 * scaleY) - top;
    const markerIndex = (markerY * width + markerX) * 4;
    // A visible child of a hidden, offscreen parent must still be included.
    return {
      hash: hash >>> 0,
      width,
      height,
      marker:
        markerX >= 0 && markerX < width && markerY >= 0 && markerY < height
          ? Array.from(pixels.slice(markerIndex, markerIndex + 4))
          : undefined,
    };
  }, rect);
  if (rect.x === 5 && rect.y === 5)
    expect(expectedPixels.marker).toEqual([231, 31, 151, 255]);
  await page.mouse.move(rect.x, rect.y);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width, rect.y + rect.height, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(
    page.getByRole('dialog', {
      name: 'Capture screenshot: drag a rectangle, or press Escape to cancel',
    }),
  ).toBeHidden();
  const pixels = await page
    .locator('.wingman-attachments img')
    .last()
    .evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Missing canvas context');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      const colors = new Set<number>();
      let hash = 2166136261;
      for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619);
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3])
          colors.add(
            (pixels[i] ?? 0) * 65536 +
              (pixels[i + 1] ?? 0) * 256 +
              (pixels[i + 2] ?? 0),
          );
      }
      return {
        width: canvas.width,
        height: canvas.height,
        colors: colors.size,
        ratio: devicePixelRatio,
        hash: hash >>> 0,
      };
    });
  expect(pixels.width).toBe(Math.round(rect.width * pixels.ratio));
  expect(pixels.height).toBe(Math.round(rect.height * pixels.ratio));
  expect(pixels.colors).toBeGreaterThan(20);
  expect({
    hash: pixels.hash,
    width: pixels.width,
    height: pixels.height,
  }).toEqual({
    hash: expectedPixels.hash,
    width: expectedPixels.width,
    height: expectedPixels.height,
  });
}
export async function captureWorkflow(page: Page) {
  await sendText(page, 'Screenshot review');
  const instrumentation = await page.evaluateHandle(() => {
    // Retain the original method and call it with each canvas via apply below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = HTMLCanvasElement.prototype.toDataURL;
    let fullViewportEncodes = 0;
    let hiddenEncodes = 0;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      if (
        this.width === Math.floor(innerWidth * devicePixelRatio) &&
        this.height === Math.floor(innerHeight * devicePixelRatio)
      )
        fullViewportEncodes++;
      return original.apply(this, args);
    };
    const fixtures: HTMLElement[] = [];
    for (const kind of ['hidden', 'display', 'canvas']) {
      const parent = document.createElement('div');
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 12;
      if (kind === 'hidden') parent.hidden = true;
      else if (kind === 'display') parent.style.display = 'none';
      else canvas.hidden = true;
      canvas.toDataURL = function (...args) {
        hiddenEncodes++;
        return original.apply(this, args);
      };
      parent.append(canvas);
      document.body.append(parent);
      fixtures.push(parent);
    }
    const parent = document.createElement('div');
    parent.style.cssText =
      'display:block;position:absolute;left:-10000px;visibility:hidden';
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 12;
    canvas.style.cssText =
      'position:fixed;left:20px;top:20px;visibility:visible;z-index:9999';
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Missing marker context');
    context.fillStyle = '#e71f97';
    context.fillRect(0, 0, 12, 12);
    parent.append(canvas);
    document.body.append(parent);
    fixtures.push(parent);
    return {
      counts: () => ({ fullViewportEncodes, hiddenEncodes }),
      dispose: () => {
        HTMLCanvasElement.prototype.toDataURL = original;
        fixtures.forEach((fixture) => {
          fixture.remove();
        });
      },
    };
  });
  await crop(page, { x: 5, y: 5, width: 500, height: 70 }, false);
  const sidebar = await page
    .getByRole('complementary', { name: 'Sheets', exact: true })
    .boundingBox();
  if (!sidebar) throw new Error('Missing sheets sidebar');
  await crop(
    page,
    {
      x: Math.ceil(sidebar.x + 5),
      y: Math.ceil(sidebar.y + 5),
      width: 180,
      height: 180,
    },
    true,
  );
  const canvas = await page
    .getByLabel('Drawing canvas', { exact: true })
    .boundingBox();
  if (!canvas) throw new Error('Missing drawing canvas');
  await crop(
    page,
    {
      x: Math.ceil(canvas.x + canvas.width / 2 - 100),
      y: Math.ceil(canvas.y + canvas.height / 2 - 100),
      width: 200,
      height: 200,
    },
    true,
  );
  await expect(page.locator('.wingman-attachments img')).toHaveCount(3);
  await page
    .getByRole('button', { name: 'Remove Screenshot 2', exact: true })
    .click();
  await expect(page.locator('.wingman-attachments img')).toHaveCount(2);
  await page.keyboard.press('Control+Shift+X');
  const overlay = page.getByRole('dialog', {
    name: 'Capture screenshot: drag a rectangle, or press Escape to cancel',
  });
  await expect(overlay).toBeVisible();
  await expect(page.locator('.screenshot-capture canvas')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await expect(page.locator('.wingman-attachments img')).toHaveCount(2);
  expect(
    await instrumentation.evaluate((instrumentation) =>
      instrumentation.counts(),
    ),
  ).toEqual({ fullViewportEncodes: 0, hiddenEncodes: 0 });
  await instrumentation.evaluate((instrumentation) => {
    instrumentation.dispose();
  });
  await instrumentation.dispose();
  const urls = await page
    .locator('.wingman-attachments img')
    .evaluateAll((images) => images.map((image) => image.getAttribute('src')));
  await sendText(page, 'Two captured details');
  await expect(page.locator('.wingman-attachments img')).toHaveCount(0);
  const sentImage = await page
    .getByRole('log', { name: 'Messages' })
    .locator('img')
    .first()
    .elementHandle();
  await page.getByRole('button', { name: 'Pause CLI', exact: true }).click();
  expect(
    await sentImage.evaluate(
      (image) => image === document.querySelector('.wingman-message img'),
    ),
  ).toBe(true);
  await sendText(page, 'Capture stays fixed');
  expect(
    await sentImage.evaluate(
      (image) => image === document.querySelector('.wingman-message img'),
    ),
  ).toBe(true);
  await page
    .getByLabel('New group name', { exact: true })
    .fill('UI still edits');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  const chat = page.getByRole('button', { name: 'Wingman chat', exact: true });
  if ((await chat.getAttribute('aria-expanded')) !== 'true') await chat.click();
  const log = page.getByRole('log', { name: 'Messages' });
  await expect(log).toContainText('Screenshot review');
  await expect(log).toContainText('Two captured details');
  await expect(log.locator('img')).toHaveCount(2);
  expect(
    await log
      .locator('img')
      .evaluateAll((images) =>
        images.map((image) => image.getAttribute('src')),
      ),
  ).toEqual(urls);
}
