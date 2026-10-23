/** Windows WebView2 regression: interact throughout cold full-size preparation.
 * Build this probe for Node (Bun's Windows CDP handshake is incompatible).
 */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, cp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { requireResourceGuard } from '../../scripts/resources';
import { preparationPdf } from '../browser/pdf-fixtures';
import type { PerformanceReport } from '../../src/performance/recorder';

await requireResourceGuard();
assert.equal(process.platform, 'win32', 'This probe targets native WebView2');
const root = fileURLToPath(new URL('../../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'bluewing-preparation-'));
const evidence = resolve(
  root,
  'tmp/preparation',
  process.env['BLUEWING_PROFILE_LABEL'] ?? 'current',
);
await mkdir(evidence, { recursive: true });
await mkdir(join(temporary, 'web'), { recursive: true });
await cp(join(root, 'dist'), join(temporary, 'web/probe'), { recursive: true });
await writeFile(join(temporary, 'web/active'), 'probe');
const source = join(temporary, 'plans.pdf');
await writeFile(source, preparationPdf());
const bin = resolve(
  root,
  process.env['BLUEWING_NATIVE_BIN_DIR'] ?? 'src-tauri/target/release',
);
const port = 9427;
const env = {
  ...process.env,
  BLUEWING_DATA_DIR: temporary,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${String(port)}`,
};
const desktop = spawn(join(bin, 'bluewing-desktop.exe'), [], {
  env,
  windowsHide: true,
});
let log = '';
desktop.stdout.on('data', (chunk: Buffer) => {
  log += chunk.toString();
});
desktop.stderr.on('data', (chunk: Buffer) => {
  log += chunk.toString();
});
const execute = promisify(execFile);
let projectId: string | undefined, revision: number | undefined;
async function call<T>(
  name: string,
  payload = {},
  mutates = false,
): Promise<T> {
  const input = JSON.stringify({
    payload,
    ...(mutates ? { projectId, expectedRevision: revision } : {}),
  });
  // execFile has no input option. Own stdin explicitly; keep the driver responsive.
  const result = await new Promise<string>((resolveResult, reject) => {
    const child = spawn(join(bin, 'bluewing.exe'), [name, '--stdin'], {
      env,
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code) reject(new Error(output));
      else resolveResult(output);
    });
    child.stdin.end(input);
  });
  const response = JSON.parse(result) as {
    ok: boolean;
    data: T;
    projectId: string;
    revision: number;
  };
  assert(response.ok, result);
  projectId = response.projectId;
  revision = response.revision;
  return response.data;
}
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try {
      browser = await chromium.connectOverCDP(
        `http://127.0.0.1:${String(port)}`,
        { timeout: 2000 },
      );
      break;
    } catch (error) {
      if (attempt > 80) throw error;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  const page = browser.contexts()[0]?.pages()[0];
  assert(page, 'Missing native WebView');
  await page
    .getByRole('button', { name: 'Create project', exact: true })
    .waitFor();
  await page.evaluate(() => {
    const errors: unknown[] = [];
    Reflect.set(window, '__nativeWorkerErrors', errors);
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener(
          'message',
          (event: MessageEvent<{ error?: unknown }>) => {
            if (event.data.error)
              errors.push({ worker: String(url), error: event.data.error });
          },
        );
        this.addEventListener('error', (event) => {
          errors.push({ worker: String(url), error: event.message });
        });
      }
    };
  });
  await call('project.create', {
    name: 'Preparation responsiveness',
    path: join(temporary, 'test.bluewing'),
  });
  await call('project.import', { path: source }, true);
  await page
    .getByRole('button', { name: 'Pause preparation', exact: true })
    .click();
  const canvas = page.getByLabel('Drawing canvas', { exact: true });
  await canvas.waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Drawing canvas"]')
        ?.getAttribute('aria-busy') === 'false',
  );
  await page.getByRole('button', { name: 'Path (L)', exact: true }).click();
  const box = await canvas.boundingBox();
  assert(box);
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolveFrame();
          }),
        ),
      ),
  );
  const before = await call<{ preparation: { completed: number } }>(
    'performance.status',
  );
  const crosshair = page.locator('.crosshair-vertical');
  await crosshair.waitFor({ state: 'visible' });
  const initialCrosshair = await crosshair.getAttribute('style');
  await call('performance.start');
  const trace = process.env['BLUEWING_PROFILE_TRACE']
    ? await page.context().newCDPSession(page)
    : undefined;
  const traceEvents: unknown[] = [];
  trace?.on('Tracing.dataCollected', (event: { value: unknown[] }) =>
    traceEvents.push(...event.value),
  );
  if (trace)
    await trace.send('Tracing.start', {
      categories: 'devtools.timeline,v8,disabled-by-default-devtools.timeline',
      transferMode: 'ReportEvents',
    });
  await page
    .getByRole('button', { name: 'Resume preparation', exact: true })
    .click();
  const begin = Date.now();
  let movements = 0;
  while (Date.now() - begin < 60_000) {
    await page.mouse.move(
      box.x + box.width * (0.5 + Math.sin(movements / 12) * 0.15),
      box.y + box.height * 0.5,
    );
    movements++;
    if (movements % 20 === 0) {
      const text = await page.locator('.page-preparation').innerText();
      const match = /Prepared (\d+) of (\d+)/.exec(text);
      if (match && Number(match[1]) >= Math.min(7, Number(match[2]))) break;
    }
    await new Promise((r) => setTimeout(r, 16));
  }
  const status = await call<{
    preparation: { completed: number; failed: number };
  }>('performance.status');
  const report = await call<PerformanceReport>('performance.stop');
  if (trace) {
    const ended = new Promise<void>((resolveTrace) =>
      trace.once('Tracing.tracingComplete', () => {
        resolveTrace();
      }),
    );
    await trace.send('Tracing.end');
    await ended;
    await writeFile(
      join(evidence, 'trace.json'),
      JSON.stringify({ traceEvents }),
    );
  }
  await writeFile(
    join(evidence, 'performance.json'),
    JSON.stringify(report, null, 2),
  );
  const gaps = report.events
    .filter((event) => event.name === 'frame.gap')
    .map((event) => event.durationMs ?? 0);
  const summary = {
    preparation: status.preparation,
    movements,
    worstFrameMs: report.summary.frames.worstMs,
    frames: report.summary.frames,
  };
  await writeFile(
    join(evidence, 'summary.json'),
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary));
  const workerErrors: unknown = await page.evaluate(
    () => Reflect.get(window, '__nativeWorkerErrors') as unknown,
  );
  await writeFile(
    join(evidence, 'worker-errors.json'),
    JSON.stringify(workerErrors, null, 2),
  );
  console.log(JSON.stringify({ workerErrors }));
  assert.equal(status.preparation.failed, 0);
  assert(
    status.preparation.completed >= 7,
    'Must complete seven pages during interaction',
  );
  assert(
    status.preparation.completed - before.preparation.completed >= 5,
    'At least five pages must complete while the crosshair moves',
  );
  assert(movements >= 20, 'Must continuously exercise pointer updates');
  assert.notEqual(
    await crosshair.getAttribute('style'),
    initialCrosshair,
    'Crosshair must visibly follow the pointer',
  );
  assert(
    report.events.filter(
      (event) =>
        event.name === 'canvas.pointer' && event.data.purpose === 'path',
    ).length >= 20,
    'Must handle pointer moves while the path is active',
  );
  assert(gaps.length > 60, 'Must record visible frames throughout preparation');
  assert(
    report.summary.activities
      .filter(
        (activity) =>
          activity.name === 'pdf.raster.request' &&
          Number(activity.dimensions.dimension) >= 7000,
      )
      .reduce((count, activity) => count + activity.count, 0) >= 5,
    'Must render full-size cold masters',
  );
  assert(
    report.summary.frames.worstMs !== null &&
      report.summary.frames.worstMs <= 150,
    'No frame may stall longer than 150ms during preparation',
  );
  // Exercise the saved master after all decoded images and document workers close.
  await page.keyboard.press('Escape');
  await call('project.close', {}, true);
  await call('performance.start');
  await call('project.open', { path: join(temporary, 'test.bluewing') });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="Drawing canvas"]')
        ?.getAttribute('aria-busy') === 'false',
  );
  const reopened = await call<PerformanceReport>('performance.stop');
  await writeFile(
    join(evidence, 'reopened.json'),
    JSON.stringify(reopened, null, 2),
  );
  const displays = reopened.events.filter((event) =>
    ['page.firstDisplay', 'page.display', 'page.progress'].includes(event.name),
  );
  console.log(JSON.stringify({ reopened: displays }));
  assert(
    reopened.events.some(
      (event) =>
        event.name === 'page.firstDisplay' &&
        event.data.purpose === 'progressive',
    ),
    'A real JPEG XL pass must paint before the full master',
  );
  assert(
    reopened.events.some(
      (event) =>
        event.name === 'page.cache.hit' &&
        event.data.cacheSource === 'disk' &&
        Number(event.data.dimension) >= 7000,
    ),
    'Reopen must decode the complete master from disk',
  );
  assert(
    !reopened.events.some((event) => event.name === 'pdf.raster.request'),
    'Saved master must reopen without another PDF render',
  );
} finally {
  await execute('taskkill', ['/PID', String(desktop.pid), '/T', '/F']).catch(
    () => undefined,
  );
  await browser?.close().catch(() => undefined);
  await writeFile(join(evidence, 'native.log'), log);
  await rm(temporary, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
