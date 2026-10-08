import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dispatchCli } from '../../src/app/cli';
import { Messaging, type Message } from '../../src/app/messaging';
import { PerformanceRecorder } from '../../src/performance/recorder';

function fixture() {
  let time = 1000;
  let clockReads = 0;
  const recorder = new PerformanceRecorder({
    now: () => {
      clockReads++;
      return time;
    },
    wallNow: () => Date.UTC(2026, 9, 7, 12),
  });
  const messaging = new Messaging({
    read: () => Promise.resolve([]),
    write: () => Promise.resolve(),
    exportAttachment: (attachment) => Promise.resolve(attachment),
  });
  const application: Parameters<typeof dispatchCli>[0] = {
    performance: recorder,
    messaging,
    project: null,
    dispatch: () =>
      Promise.resolve({ data: {}, projectId: null, revision: null }),
  };
  return {
    application,
    recorder,
    clockReads: () => clockReads,
    advance: (duration: number) => {
      time += duration;
    },
  };
}

void test('CLI duration covers dispatch, result formatting and message delivery', async () => {
  const { application, recorder, advance } = fixture();
  const message: Message = {
    id: 1,
    sender: 'agent',
    text: 'Done',
    createdAt: '2026-10-07T12:00:00.000Z',
    get attachments() {
      advance(3);
      return [];
    },
  };
  application.dispatch = () => {
    advance(20);
    return Promise.resolve({ data: message, projectId: null, revision: null });
  };
  application.messaging.delivery = () => {
    advance(7);
    return { projectId: null, messages: [] };
  };
  recorder.start();
  advance(5);
  const result = await dispatchCli(application, [
    'messages.send',
    '{"payload":{"text":"Done"}}',
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.response.ok, true);
  assert.ok('data' in result.response);
  assert.deepEqual(result.response.data, {
    id: 1,
    sender: 'agent',
    text: 'Done',
    createdAt: '2026-10-07T12:00:00.000Z',
    attachments: [],
  });
  assert.deepEqual(recorder.report().events, [
    {
      sequence: 1,
      kind: 'span',
      name: 'cli.command',
      atMs: 5,
      durationMs: 30,
      data: { purpose: 'messages.send', success: true },
    },
  ]);
});

void test('failed CLI duration includes error formatting and message delivery', async () => {
  const { application, recorder, advance } = fixture();
  const error = Object.assign(new Error('Conflict'), {
    code: 'PROJECT_CONFLICT',
  });
  Object.defineProperty(error, 'message', {
    get: () => {
      advance(4);
      return 'Project changed';
    },
  });
  application.dispatch = () => {
    advance(20);
    return Promise.reject(error);
  };
  application.messaging.delivery = () => {
    advance(7);
    return { projectId: null, messages: [] };
  };
  recorder.start();
  const result = await dispatchCli(application, [
    'project.rename',
    '{"payload":{"name":"Updated"}}',
  ]);
  assert.equal(result.exitCode, 3);
  assert.equal(result.response.ok, false);
  assert.ok('error' in result.response);
  assert.deepEqual(result.response.error, {
    code: 'PROJECT_CONFLICT',
    message: 'Project changed',
  });
  assert.equal(recorder.report().events[0]?.durationMs, 31);
  assert.deepEqual(recorder.report().events[0]?.data, {
    purpose: 'project.rename',
    success: false,
  });
});

void test('CLI metadata keeps only known command names and outcomes', async () => {
  const { application, recorder } = fixture();
  const privatePath = '/Users/private/customer/estimate.bluewing';
  const privateText = 'Confidential project search';
  application.dispatch = (request) => {
    if (request.name === 'help' || request.name.startsWith('unknown.'))
      return Promise.reject(new Error(`No command ${privateText}`));
    return Promise.resolve({
      data: { path: privatePath, text: privateText },
      projectId: 'private-project',
      revision: 12,
    });
  };
  recorder.start();
  await dispatchCli(application, [
    'project.open',
    JSON.stringify({
      payload: { path: privatePath },
      projectId: 'private-project',
      expectedRevision: 12,
      messagesAfter: 9,
    }),
  ]);
  await dispatchCli(application, ['help', privateText]);
  await dispatchCli(application, [`unknown.${privatePath}.${privateText}`]);
  await dispatchCli(application, ['project.inspect', '{invalid JSON']);
  const report = recorder.report();
  assert.deepEqual(
    report.events.map((event) => event.data),
    [
      { purpose: 'project.open', success: true },
      { purpose: 'help', success: false },
    ],
  );
  const serialized = JSON.stringify(report);
  for (const value of [privatePath, privateText, 'private-project', 'unknown.'])
    assert.equal(serialized.includes(value), false);
});

void test('inactive CLI recording does not read its clock or add events', async () => {
  const { application, recorder, clockReads } = fixture();
  assert.equal(
    (await dispatchCli(application, ['project.inspect'])).exitCode,
    0,
  );
  application.dispatch = () => Promise.reject(new Error('No project'));
  assert.equal(
    (await dispatchCli(application, ['project.inspect'])).exitCode,
    1,
  );
  assert.equal(clockReads(), 0);
  assert.deepEqual(recorder.report().events, []);
});

void test('CLI callers without a recorder retain their response behavior', async () => {
  const { application } = fixture();
  const { dispatch, messaging, project } = application;
  const result = await dispatchCli({ dispatch, messaging, project }, ['help']);
  assert.equal(result.exitCode, 0);
  assert.equal(result.response.ok, true);
});

void test('performance control commands leave recording snapshots unchanged', async () => {
  const { application, recorder, advance } = fixture();
  let spanCalls = 0;
  const span = recorder.span.bind(recorder);
  recorder.span = (name, data) => {
    spanCalls++;
    return span(name, data);
  };
  application.dispatch = (request) => {
    advance(5);
    const data =
      request.name === 'performance.start'
        ? recorder.start()
        : request.name === 'performance.stop'
          ? recorder.stop()
          : request.name === 'performance.status'
            ? recorder.status()
            : recorder.report();
    return Promise.resolve({ data, projectId: null, revision: null });
  };
  await dispatchCli(application, ['performance.start']);
  recorder.event('existing');
  const expectedEvents = recorder.report().events;
  const activeExport = await dispatchCli(application, [
    'performance.export',
    '{"payload":{"path":"/private/performance.json"}}',
  ]);
  assert.ok('data' in activeExport.response);
  assert.deepEqual(activeExport.response.data, recorder.report());
  await dispatchCli(application, ['performance.status']);
  assert.deepEqual(recorder.report().events, expectedEvents);
  const stopped = await dispatchCli(application, ['performance.stop']);
  const snapshot = recorder.report();
  assert.ok('data' in stopped.response);
  assert.deepEqual(stopped.response.data, snapshot);
  assert.deepEqual(snapshot.events, expectedEvents);
  const exported = await dispatchCli(application, ['performance.export']);
  assert.ok('data' in exported.response);
  assert.deepEqual(exported.response.data, snapshot);
  assert.deepEqual(recorder.report(), snapshot);
  assert.equal(spanCalls, 0);
});

void test('CLI command duration includes waiting behind another queued command', async () => {
  const { application, recorder, advance } = fixture();
  let release!: () => void;
  let markRunning!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = new Promise<void>((resolve) => {
    markRunning = resolve;
  });
  let queue = Promise.resolve();
  application.dispatch = (request) => {
    const pending = queue.then(async () => {
      if (request.name === 'project.inspect') {
        markRunning();
        await gate;
        advance(10);
      } else {
        advance(7);
      }
      return { data: {}, projectId: null, revision: null };
    });
    queue = pending.then(() => undefined);
    return pending;
  };
  recorder.start();
  const first = dispatchCli(application, ['project.inspect']);
  await running;
  advance(5);
  const second = dispatchCli(application, ['commands.list']);
  advance(100);
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => result.exitCode),
    [0, 0],
  );
  const queued = recorder
    .report()
    .events.find((event) => event.data.purpose === 'commands.list');
  assert.ok(queued);
  assert.equal(queued.atMs, 5);
  assert.equal(queued.durationMs, 117);
  assert.equal(queued.data.success, true);
});
