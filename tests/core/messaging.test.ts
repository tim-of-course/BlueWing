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
void test('message results and CLI metadata cannot mutate the accepted conversation', async () => {
  const { messaging } = fixture();
  await messaging.bind('one');
  const attachment = {
    id: 'isolated',
    name: 'detail.png',
    dataUrl: 'data:image/png;base64,eA==',
    width: 10,
    height: 20,
  };
  const sending = messaging.send('original', [attachment], 'user');
  attachment.name = 'changed input';
  const sent = await sending;
  const expected = structuredClone(sent);
  assert.equal(expected.attachments[0]?.name, 'detail.png');
  sent.text = 'changed return';
  assert.ok(sent.attachments[0]);
  sent.attachments[0].dataUrl = 'changed return';
  const snapshot = messaging.snapshot();
  assert.ok(snapshot.messages[0]?.attachments[0]);
  snapshot.messages[0].attachments[0].name = 'changed snapshot';
  const read = await messaging.read();
  assert.ok(read[0]);
  read[0].attachments.length = 0;
  const wait = await messaging.wait(0, 0);
  assert.ok(wait.messages[0]);
  wait.messages[0].text = 'changed wait';
  const delivery = messaging.delivery();
  assert.ok(delivery.messages[0]?.attachments[0]);
  delivery.messages[0].attachments[0].name = 'changed metadata';
  delivery.messages.length = 0;
  assert.deepEqual(await messaging.read(), [expected]);
});
void test('reads clone once and status notifications do not clone pending results', async () => {
  const { messaging } = fixture();
  await messaging.bind('one');
  await messaging.send(
    'old screenshot',
    [
      {
        id: 'large',
        name: 'large.png',
        dataUrl: 'x'.repeat(1024 * 1024),
        width: 100,
        height: 100,
      },
    ],
    'user',
  );
  const clone = globalThis.structuredClone;
  let calls = 0;
  globalThis.structuredClone = ((
    ...args: Parameters<typeof structuredClone>
  ) => {
    calls++;
    return clone(...args);
  }) as typeof structuredClone;
  try {
    assert.equal((await messaging.read()).length, 1);
    assert.equal(calls, 1);
    calls = 0;
    const pending = messaging.read(1, 5);
    messaging.setPaused(true);
    messaging.setPaused(false);
    assert.equal(messaging.status().paused, false);
    assert.equal(calls, 0);
    assert.deepEqual(await pending, []);
    assert.equal(calls, 1);
  } finally {
    globalThis.structuredClone = clone;
  }
});
void test('CLI envelopes project-scope and filter messages without transcript clones', async () => {
  const { messaging } = fixture();
  await messaging.bind('one');
  await messaging.send(
    'old screenshot',
    [
      {
        id: 'large',
        name: 'large.png',
        dataUrl: 'x'.repeat(1024 * 1024),
        width: 100,
        height: 100,
      },
    ],
    'user',
  );
  await messaging.send('latest', [], 'agent');
  const application = {
    messaging,
    project: null,
    dispatch: () =>
      Promise.resolve({ data: {}, projectId: 'one', revision: 0 }),
  };
  const clone = globalThis.structuredClone;
  let calls = 0;
  globalThis.structuredClone = ((
    ...args: Parameters<typeof structuredClone>
  ) => {
    calls++;
    return clone(...args);
  }) as typeof structuredClone;
  try {
    const empty = await dispatchCli(application, [
      'project.inspect',
      '{"messagesAfter":2}',
    ]);
    assert.deepEqual(empty.response.messages, []);
    const latest = await dispatchCli(application, [
      'project.inspect',
      '{"messagesAfter":1}',
    ]);
    assert.deepEqual(
      latest.response.messages?.map((message) => message.text),
      ['latest'],
    );
    const changed = await dispatchCli(application, [
      'project.inspect',
      '{"projectId":"other","messagesAfter":900}',
    ]);
    assert.equal(changed.response.messagesProjectId, 'one');
    assert.equal(changed.response.messages?.length, 2);
    assert.ok(!JSON.stringify(changed).includes('dataUrl'));
    assert.ok(JSON.stringify(changed).includes('/local/large.png'));
    assert.equal(calls, 0);
  } finally {
    globalThis.structuredClone = clone;
  }
});
void test('message and status publications let presentation retain unchanged rows', async () => {
  const { messaging, storage } = fixture();
  const changes: string[] = [];
  messaging.subscribe((change) => changes.push(change));
  await messaging.bind('one');
  await messaging.send('first', [], 'user');
  messaging.setPaused(true);
  const waiting = messaging.wait(1, 1000);
  messaging.stopWaiting();
  await waiting;
  assert.deepEqual(changes, [
    'bind',
    'message',
    'status',
    'status',
    'status',
    'status',
  ]);
  const before = changes.length;
  storage.write = () => Promise.reject(new Error('Disk full'));
  await assert.rejects(messaging.send('lost', [], 'user'), /Disk full/);
  assert.equal(changes.length, before);
  assert.deepEqual(messaging.snapshot(1).messages, []);
});
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
void test('short help and command help parse without requesting the full registry', () => {
  assert.equal(parseCli([]).name, 'help');
  assert.equal(parseCli(['--help']).name, 'help');
  assert.deepEqual(parseCli(['help', 'messages.wait']).payload, {
    command: 'messages.wait',
  });
  assert.equal(parseCli(['commands.list']).name, 'commands.list');
  assert.deepEqual(
    parseCli(['help'], '{"payload":{"command":"sheet.render"}}').payload,
    {
      command: 'sheet.render',
    },
  );
});
void test('Wingman wait wakes for user input, permits agent sends, and shows only active waiters', async () => {
  const { messaging } = fixture();
  await messaging.bind('one');
  const pending = messaging.wait(0, 1000);
  assert.equal(messaging.snapshot().waiting, true);
  await messaging.send('Still checking', [], 'agent');
  assert.equal(messaging.snapshot().waiting, true);
  const user = await messaging.send('Use 12 feet', [], 'user');
  const reply = await pending;
  assert.equal(reply.status, 'messages');
  assert.equal(reply.after, user.id);
  assert.equal(reply.messages.length, 2);
  assert.equal(reply.projectId, 'one');
  assert.equal(messaging.snapshot().waiting, false);
  assert.deepEqual((await messaging.wait(0, 0)).messages, reply.messages);
});
void test('ending a conversation wakes all waits, prevents renewal, and permits a new conversation', async () => {
  const { messaging } = fixture();
  await messaging.bind('one');
  const a = messaging.wait(0, 1000);
  const b = messaging.wait(0, 1000);
  messaging.setPaused(true);
  assert.equal(messaging.snapshot().waiting, true);
  messaging.stopWaiting();
  const ended = await a;
  assert.equal(ended.status, 'ended');
  assert.equal((await b).status, 'ended');
  assert.equal(messaging.snapshot().waiting, false);
  assert.equal(
    (await messaging.wait(0, 1000, ended.waitToken)).status,
    'ended',
  );
  const next = messaging.wait(0, 1000);
  await messaging.send('Start again', [], 'user');
  assert.equal((await next).status, 'messages');
});
void test('project switching and reopening stop waits without borrowing another conversation', async () => {
  const { messaging } = fixture();
  await messaging.bind('two');
  await messaging.send('Other project', [], 'user');
  await messaging.bind('one');
  const first = messaging.wait(0, 1000);
  await messaging.bind('two');
  const changed = await first;
  assert.equal(changed.status, 'project_changed');
  assert.equal(changed.projectId, 'one');
  assert.deepEqual(changed.messages, []);
  assert.equal(messaging.snapshot().waiting, false);
  const oldToken = (await messaging.wait(1, 0)).waitToken;
  await messaging.bind('two');
  assert.equal((await messaging.wait(1, 0, oldToken)).status, 'ended');
  await messaging.bind(null);
  await assert.rejects(messaging.wait(), /Open a project/);
});
void test('timeouts return received agent messages and release only their own waiting indicator', async () => {
  const { messaging } = fixture();
  await messaging.bind('one');
  await messaging.send('Agent message', [], 'agent');
  const long = messaging.wait(0, 1000);
  const timed = await messaging.wait(0, 1);
  assert.equal(timed.status, 'timeout');
  assert.equal(timed.after, 1);
  assert.equal(messaging.snapshot().waiting, true);
  messaging.stopWaiting();
  await long;
  assert.equal(messaging.snapshot().waiting, false);
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
  assert.match(
    (await dispatchCli(application, args)).response.messageGuidance ?? '',
    /messages.send/,
  );
  assert.equal(
    (await dispatchCli(application, ['project.inspect', '{"messagesAfter":2}']))
      .response.messageGuidance,
    undefined,
  );
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
  application.dispatch = async () => ({
    data: await messaging.wait(0, 0),
    projectId: 'one',
    revision: 0,
  });
  const waiting = await dispatchCli(application, ['messages.wait']);
  assert.ok(!JSON.stringify(waiting).includes('dataUrl'));
  assert.ok(JSON.stringify(waiting).includes('/local/a.png'));
  assert.equal(waiting.response.messagesProjectId, 'one');
});
