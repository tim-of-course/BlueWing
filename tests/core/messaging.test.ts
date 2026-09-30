import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Messaging,
  type Message,
  type MessagingStorage,
} from '../../src/app/messaging';
import { dispatchCli, parseCli } from '../../src/app/cli';

function fixture() {
  const saved = new Map<string, Message[]>();
  const storage: MessagingStorage = {
    read: (id) => Promise.resolve(structuredClone(saved.get(id) ?? [])),
    write: (id, messages) => {
      saved.set(id, structuredClone(messages));
      return Promise.resolve();
    },
    exportAttachment: (attachment) =>
      Promise.resolve({ ...attachment, path: `/local/${attachment.id}.png` }),
  };
  return { messaging: new Messaging(storage), storage };
}
void test('reconnect preserves IDs, full attachments and nondestructive cursors', async () => {
  const { messaging, storage } = fixture();
  await messaging.bind('one');
  await messaging.send(
    'Review this',
    [
      {
        id: 'image',
        name: 'detail.png',
        dataUrl: 'data:image/png;base64,eA==',
        width: 10,
        height: 20,
      },
    ],
    'user',
  );
  const connected = new Messaging(storage);
  await connected.bind('one');
  const messages = await connected.read();
  assert.equal(messages[0]?.attachments[0]?.path, '/local/image.png');
  assert.deepEqual(await connected.read(), messages);
  assert.deepEqual(await connected.read(1), []);
  assert.equal((await connected.send('Received', [], 'agent')).id, 2);
  await connected.bind('two');
  assert.deepEqual(await connected.read(), []);
  await connected.bind('one');
  assert.equal((await connected.read()).length, 2);
});
void test('multiple waiters receive the same reply and do not block sends', async () => {
  const { messaging } = fixture();
  await messaging.bind('one');
  const a = messaging.read(0, 1000);
  const b = messaging.read(0, 1000);
  const message = await messaging.send('reply', [], 'user');
  assert.deepEqual(await a, [message]);
  assert.deepEqual(await b, [message]);
  assert.deepEqual(await messaging.read(message.id, 5), []);
  const waiting = messaging.read(message.id, 1000);
  await messaging.bind(null);
  assert.deepEqual(await waiting, []);
});
void test('failed persistence does not publish a message or consume an ID', async () => {
  const { messaging, storage } = fixture();
  await messaging.bind('one');
  const write = storage.write.bind(storage);
  storage.write = () => Promise.reject(new Error('Disk full'));
  await assert.rejects(messaging.send('lost', [], 'agent'), /Disk full/);
  assert.deepEqual(messaging.snapshot().messages, []);
  storage.write = write;
  assert.equal((await messaging.send('saved', [], 'agent')).id, 1);
});
void test('pause invalidates queued actions across immediate resume, while chat continues', async () => {
  const { messaging } = fixture();
  await messaging.bind('one');
  const beforePause = messaging.cliTicket();
  messaging.setPaused(true);
  const duringPause = messaging.cliTicket();
  await messaging.send('Please wait', [], 'user');
  messaging.setPaused(false);
  assert.throws(beforePause, /Wingman is paused/);
  assert.throws(duringPause, /Wingman is paused/);
  assert.doesNotThrow(messaging.cliTicket());
  assert.equal(messaging.snapshot().messages.length, 1);
});
void test('CLI parsing owns origin and validates the envelope cursor', () => {
  assert.equal(parseCli(['help']).origin, 'cli');
  assert.equal(
    parseCli(['project.inspect', '{"messagesAfter":3}']).messagesAfter,
    3,
  );
  assert.throws(
    () => parseCli(['project.inspect', '{"origin":"ui"}']),
    /Unknown request field/,
  );
  assert.throws(
    () => parseCli(['project.inspect', '{"messagesAfter":-1}']),
    /nonnegative integer/,
  );
});
void test('queued CLI cancellation returns before a running action ends and never replays', async () => {
  const { messaging } = fixture();
  let release!: () => void;
  const busy = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const queued = messaging.scheduleCli(
    (operation) => busy.then(operation),
    () => {
      calls++;
      return Promise.resolve('ran');
    },
  );
  const rejected = assert.rejects(queued, { code: 'WINGMAN_PAUSED' });
  messaging.setPaused(true);
  messaging.setPaused(false);
  await rejected;
  assert.equal(calls, 0);
  release();
  await busy;
  await Promise.resolve();
  assert.equal(calls, 0);
  assert.equal(
    await messaging.scheduleCli(
      (operation) => Promise.resolve().then(operation),
      () => Promise.resolve('fresh'),
    ),
    'fresh',
  );
});
void test('an executing CLI operation may finish after pause', async () => {
  const { messaging } = fixture();
  let release!: () => void;
  const operation = new Promise<string>((resolve) => {
    release = () => {
      resolve('finished');
    };
  });
  const running = messaging.scheduleCli(
    (fn) => Promise.resolve().then(fn),
    () => operation,
  );
  await Promise.resolve();
  messaging.setPaused(true);
  release();
  assert.equal(await running, 'finished');
});
void test('success and failure envelopes carry full unconsumed messages', async () => {
  const { messaging } = fixture();
  await messaging.bind('one');
  await messaging.send('first', [], 'user');
  const message = await messaging.send('second', [], 'user');
  const application = {
    messaging,
    project: null,
    dispatch: () =>
      Promise.resolve({ data: {}, projectId: 'one', revision: 0 }),
  };
  const args = ['project.inspect', '{"messagesAfter":1}'];
  assert.deepEqual((await dispatchCli(application, args)).response.messages, [
    message,
  ]);
  application.dispatch = () =>
    Promise.reject(
      Object.assign(new Error('Paused'), { code: 'WINGMAN_PAUSED' }),
    );
  const failed = await dispatchCli(application, args);
  assert.equal(failed.exitCode, 1);
  assert.deepEqual(failed.response.messages, [message]);
  assert.deepEqual((await dispatchCli(application, args)).response.messages, [
    message,
  ]);
});
void test('CLI strips image data from message results and identifies the cursor project', async () => {
  const { messaging } = fixture();
  await messaging.bind('one');
  const message = await messaging.send(
    'image',
    [
      {
        id: 'a',
        name: 'a.png',
        dataUrl: 'data:image/png;base64,eA==',
        width: 1,
        height: 1,
      },
    ],
    'user',
  );
  const application = {
    messaging,
    project: null,
    dispatch: (): Promise<{
      data: unknown;
      projectId: string;
      revision: number;
    }> =>
      Promise.resolve({
        data: message,
        projectId: 'one',
        revision: 0,
      }),
  };
  const sent = await dispatchCli(application, ['messages.send']);
  assert.equal(sent.response.messagesProjectId, 'one');
  assert.ok(!JSON.stringify(sent).includes('dataUrl'));
  assert.ok(JSON.stringify(sent).includes('/local/a.png'));
  application.dispatch = () =>
    Promise.resolve({ data: [message], projectId: 'one', revision: 0 });
  const read = await dispatchCli(application, ['messages.read']);
  assert.ok(!JSON.stringify(read).includes('dataUrl'));
  const changed = await dispatchCli(application, [
    'messages.read',
    '{"projectId":"old","messagesAfter":900}',
  ]);
  assert.equal(changed.response.messages?.length, 1);
  assert.equal(changed.response.messagesProjectId, 'one');
});
