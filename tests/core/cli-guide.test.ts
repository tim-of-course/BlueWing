import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { connectionPrompt, cliIntroduction } from '../../src/app/cli-guide';
import { Application } from '../../src/app/application';
import { cliCommandIndex, registry } from '../../src/app/registry';
import { estimatingSkill, projectFolder } from '../../src/app/estimating-skill';

const project = { id: 'project-1', name: 'Clinic', revision: 3 };
void test('connection prompts state the selected conversation intent and target the current project', () => {
  const connection = {
    cliPath: '/Applications/Bluewing.app/Contents/MacOS/bluewing',
    shell: 'posix' as const,
    dataDir: '/Users/test/Library/Application Support/com.bluewing.Bluewing',
  };
  const wingman = connectionPrompt(connection, project, 'wingman');
  assert.match(wingman, /Wingman \+ chat/);
  assert.match(wingman, /messages.send/);
  assert.match(wingman, /messages.wait/);
  assert.match(wingman, /cannot remain available/);
  assert.match(wingman, /"projectId":"project-1"/);
  const chat = connectionPrompt(connection, project, 'chat');
  assert.match(chat, /"mode":"chat"/);
  assert.match(
    chat,
    /keep questions, progress, and answers in our external chat/,
  );
  assert.ok(!chat.includes('messages.wait'));
  assert.ok(!wingman.includes('token='));
});
void test(
  'POSIX copied command preserves spaces, quotes and shell metacharacters',
  { skip: process.platform === 'win32' },
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'bluewing-cli-prompt-'));
    try {
      const cliPath = join(directory, "Bluewing's $(printf injected) launcher");
      writeFileSync(
        cliPath,
        '#!/bin/sh\nprintf "%s\\n" "$BLUEWING_DATA_DIR" "$@"\n',
        { mode: 0o700 },
      );
      const dataDir = "data's $HOME `echo example`";
      const prompt = connectionPrompt(
        { cliPath, shell: 'posix', dataDir },
        project,
        'wingman',
      );
      const command = prompt.split('\n\n')[1];
      assert.ok(command);
      const lines = execFileSync('/bin/sh', ['-c', command], {
        encoding: 'utf8',
        // A prior test connection must not redirect this app's copied command.
        env: { ...process.env, BLUEWING_DATA_DIR: '/tmp/old-test-profile' },
      })
        .trim()
        .split('\n');
      assert.equal(lines[0], dataDir);
      assert.equal(lines[1], 'connect');
      assert.deepEqual(JSON.parse(lines[2] ?? ''), {
        projectId: project.id,
        payload: { mode: 'wingman' },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
void test('PowerShell prompt uses quoted stdin and the installed executable', () => {
  const prompt = connectionPrompt(
    {
      cliPath: "C:\\Tim's Apps\\bluewing.exe",
      shell: 'powershell',
      dataDir: "C:\\Tim's Data",
    },
    project,
    'chat',
  );
  assert.match(prompt, /\$env:BLUEWING_DATA_DIR = 'C:\\Tim''s Data'/);
  assert.match(prompt, /\| & 'C:\\Tim''s Apps\\bluewing.exe' connect --stdin/);
});
void test('short introduction points to real commands without the full schemas', () => {
  const guide = cliIntroduction(project, 'wingman');
  assert.deepEqual(guide.project, project);
  const names = new Set(cliCommandIndex.map((command) => command.name));
  for (const group of Object.values(guide.commands))
    for (const command of group.split(', '))
      assert.ok(names.has(command), command);
  assert.ok(JSON.stringify(guide).length < 3000);
  assert.match(cliIntroduction(null).start, /Open or create/);
});
void test('estimating skill resolves the project file folder', () => {
  assert.equal(
    projectFolder('C:\\Jobs\\Clinic\\clinic.bluewing'),
    'C:\\Jobs\\Clinic',
  );
  assert.equal(projectFolder('/jobs/clinic/clinic.bluewing'), '/jobs/clinic');
  assert.equal(projectFolder('/clinic.bluewing'), '/');
  assert.equal(projectFolder('clinic.bluewing'), '.');
});
void test('connection points agents to the estimating skill command', () => {
  const guide = cliIntroduction(project, 'chat');
  assert.match(guide.skill, /estimating\.skill/);
  for (const workflow of Object.values(guide.workflows))
    assert.ok(
      registry.some((command) => command.name === workflow.start),
      workflow.start,
    );
});
void test('command index covers estimating skill commands and leaves schemas to targeted help', async () => {
  const app = new Application(false);
  const { data } = await app.dispatch({ name: 'commands.list' });
  const { commands, protocol } = data as {
    commands: typeof cliCommandIndex;
    protocol: { request: object };
  };
  assert.ok(protocol.request);
  const names = new Set(commands.map((command) => command.name));
  assert.deepEqual(
    [...names],
    registry.map(({ name }) => name).sort((a, b) => a.localeCompare(b)),
  );
  for (const entry of commands) {
    assert.deepEqual(Object.keys(entry).sort(), [
      'description',
      'mutates',
      'name',
    ]);
    assert.ok(entry.description);
    assert.equal(typeof entry.mutates, 'boolean');
  }
  const help = await app.dispatch({
    name: 'help',
    payload: { command: 'geometry.put' },
  });
  assert.deepEqual(
    help.data,
    registry.find(({ name }) => name === 'geometry.put'),
  );
  const mentioned = new Set(
    estimatingSkill.match(/\b[a-z]+(?:\.[a-zA-Z]+)+\b/g) ?? [],
  );
  const skillCommands = [...mentioned].filter(
    (name) => !/\.(html|json)$/.test(name),
  );
  assert.ok(skillCommands.length > 5);
  for (const name of skillCommands) assert.ok(names.has(name), name);
});
