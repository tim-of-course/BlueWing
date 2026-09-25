import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import {
  acquireSlot,
  inspectSlot,
  parseMacResources,
  resourceProblem,
  tokenVariable,
} from '../../scripts/resources';
import setup from '../browser/global-setup';
import type { FullConfig } from '@playwright/test';

const fixture = resolve('tests/tooling/guard-fixture.ts');
const healthy = {
  availableBytes: 4 * 1024 ** 3,
  pressure: 1,
  load: 1,
  cores: 8,
};
function job(mode: string, port: number, marker = '', cwd?: string) {
  const env = { ...process.env };
  Reflect.deleteProperty(env, tokenVariable);
  const child = spawn(process.execPath, [fixture, mode, String(port), marker], {
    env,
    ...(cwd ? { cwd } : {}),
  });
  let output = '';
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { child, exited, output: () => output };
}
async function eventually(check: () => boolean) {
  const deadline = Date.now() + 6000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Fixture did not become ready');
    await delay(25);
  }
}
async function unusedPort() {
  const slot = await acquireSlot('reserve test port', 0);
  await slot.close();
  return slot.port;
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

void test('preflight and runtime thresholds stop before macOS memory exhaustion', () => {
  assert.equal(resourceProblem(healthy, true), null);
  assert.match(
    resourceProblem({ ...healthy, pressure: 2 }, true) ?? '',
    /warning/,
  );
  assert.match(
    resourceProblem({ ...healthy, pressure: 4 }, false) ?? '',
    /critical/,
  );
  assert.match(
    resourceProblem({ ...healthy, availableBytes: 1.5 * 1024 ** 3 }, true) ??
      '',
    /2 GiB/,
  );
  assert.equal(
    resourceProblem({ ...healthy, availableBytes: 1.5 * 1024 ** 3 }, false),
    null,
  );
  assert.match(
    resourceProblem({ ...healthy, availableBytes: 0.5 * 1024 ** 3 }, false) ??
      '',
    /1 GiB/,
  );
  assert.match(resourceProblem({ ...healthy, load: 100 }, true) ?? '', /load/);
  assert.deepEqual(
    parseMacResources(
      '1\n',
      'The system has 8589934592 (524288 pages with a page size of 16384).\nSystem-wide memory free percentage: 50%',
    ),
    { availableBytes: 4 * 1024 ** 3, pressure: 1 },
  );
  assert.throws(() => parseMacResources('1', 'unexpected'), /Cannot read/);
});
void test('OS-owned slot excludes competing processes from a different checkout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bluewing-guard-'));
  const marker = join(directory, 'started');
  const slot = await acquireSlot('first checkout tests', 0);
  try {
    assert.equal((await inspectSlot(slot.token, slot.port)).authorized, true);
    assert.equal(
      (await inspectSlot('wrong token', slot.port)).authorized,
      false,
    );
    const competing = job('compete', slot.port, marker, directory);
    assert.equal(await competing.exited, 75);
    assert.match(
      competing.output(),
      /Another Bluewing heavy job.*first checkout tests/,
    );
    assert.equal(existsSync(marker), false);
  } finally {
    await slot.close();
    await rm(directory, { recursive: true, force: true });
  }
});
void test('memory refusal never starts the child and releases the slot', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bluewing-guard-'));
  const marker = join(directory, 'started');
  const port = await unusedPort();
  try {
    const blocked = job('blocked', port, marker);
    assert.equal(await blocked.exited, 75);
    assert.match(blocked.output(), /Heavy work blocked.*critical/);
    assert.equal(existsSync(marker), false);
    const slot = await acquireSlot('after refusal', port);
    await slot.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
void test('nested guarded commands reuse their parent slot and preserve failing exit codes', async () => {
  const port = await unusedPort();
  const nested = job('nested', port);
  assert.equal(await nested.exited, 7, nested.output());
  const slot = await acquireSlot('after nested exit', port);
  await slot.close();
});
for (const mode of ['pressure', 'interrupt']) {
  void test(
    `${mode} stops the owned process tree including detached descendants`,
    { skip: process.platform === 'win32' },
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'bluewing-guard-'));
      const marker = join(directory, 'pids');
      const port = await unusedPort();
      const running = job(mode, port, marker);
      let pids: { parent: number; child: number } | undefined;
      try {
        await eventually(() => existsSync(marker));
        pids = JSON.parse(await readFile(marker, 'utf8')) as {
          parent: number;
          child: number;
        };
        if (mode === 'interrupt') running.child.kill('SIGINT');
        assert.equal(
          await running.exited,
          mode === 'interrupt' ? 130 : 75,
          running.output(),
        );
        const { parent, child } = pids;
        await eventually(() => !alive(parent) && !alive(child));
        const slot = await acquireSlot('after cancellation', port);
        await slot.close();
      } finally {
        running.child.kill('SIGKILL');
        for (const pid of pids ? [pids.parent, pids.child] : []) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            /* Fixture already exited. */
          }
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
void test('a killed lock holder leaves no stale lock to remove', async () => {
  const held = job('hold', 0);
  try {
    await eventually(() => held.output().includes('port'));
    const data = JSON.parse(held.output()) as { port: number };
    held.child.kill('SIGKILL');
    await held.exited;
    const slot = await acquireSlot('after crash', data.port);
    await slot.close();
  } finally {
    held.child.kill('SIGKILL');
  }
});
void test('direct browser invocation and a multi-worker override are refused', async () => {
  await assert.rejects(
    setup({ workers: 2 } as FullConfig),
    /require one worker/,
  );
  const previous = process.env[tokenVariable];
  Reflect.deleteProperty(process.env, tokenVariable);
  try {
    await assert.rejects(setup({ workers: 1 } as FullConfig), /guarded/);
  } finally {
    if (previous !== undefined) process.env[tokenVariable] = previous;
  }
});

void test('Python desktop entry points accept only a live parent guard', async () => {
  const slot = await acquireSlot('Python entry fixture', 0);
  const execute = promisify(execFile);
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const args = [resolve('tests/tooling/python-fixture.py'), String(slot.port)];
  try {
    const accepted = await execute(python, args, {
      env: { ...process.env, [tokenVariable]: slot.token },
    });
    assert.match(accepted.stdout, /authorized/);
    await assert.rejects(
      execute(python, args, {
        env: { ...process.env, [tokenVariable]: 'expired-token' },
      }),
      (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 75,
    );
  } finally {
    await slot.close();
  }
});
