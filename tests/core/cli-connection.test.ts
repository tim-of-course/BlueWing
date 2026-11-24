import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { Application } from '../../src/app/application';
import { connectCli } from '../../src/app/cli';

void test('CLI bridge startup failure unregisters the listener and propagates the original error', async () => {
  const commands: string[] = [];
  const startupError = new Error('bridge unavailable');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { crypto: globalThis.crypto },
  });
  try {
    mockIPC((command) => {
      commands.push(command);
      if (command === 'bridge_ready') throw startupError;
      return 1;
    });
    await assert.rejects(connectCli(new Application(false)), (error) => {
      assert.equal(error, startupError);
      return true;
    });
    assert.deepEqual(commands, [
      'plugin:event|listen',
      'bridge_ready',
      'plugin:event|unlisten',
    ]);
  } finally {
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

void test('successful CLI activation reloads after an expired reply, while failed activation does not', async () => {
  const commands: string[] = [];
  const responseError = new Error('CLI request expired');
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalError = console.error;
  const errors: unknown[][] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      crypto: globalThis.crypto,
      location: {
        reload: () => {
          commands.push('reload');
        },
      },
    },
  });
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    mockIPC(
      (command) => {
        commands.push(command);
        if (command === 'cli_respond') throw responseError;
        return {};
      },
      { shouldMockEvents: true },
    );
    const app = new Application(false);
    const unlisten = await connectCli(app);
    try {
      app.dispatch = () => Promise.reject(new Error('activation failed'));
      await emit('bluewing:cli-request', {
        id: 'failed',
        args: ['web.activate'],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(commands, ['bridge_ready', 'cli_respond']);

      app.dispatch = () =>
        Promise.resolve({ data: {}, projectId: null, revision: null });
      await emit('bluewing:cli-request', {
        id: 'active',
        args: ['web.activate'],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(commands, [
        'bridge_ready',
        'cli_respond',
        'cli_respond',
        'reload',
      ]);
      assert.deepEqual(errors, [
        ['CLI response failed', responseError],
        ['CLI response failed', responseError],
      ]);
    } finally {
      unlisten();
    }
  } finally {
    console.error = originalError;
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
