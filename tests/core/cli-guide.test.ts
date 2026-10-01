import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { connectionPrompt, cliIntroduction } from '../../src/app/cli-guide';
import { registry } from '../../src/app/registry';

const project = { id: 'project-1', name: 'Clinic', revision: 3 };
void test('connection prompts state the selected conversation intent and target the current project', () => {
  const connection = {
    cliPath: '/Applications/Bluewing.app/Contents/MacOS/bluewing',
    shell: 'posix' as const,
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
  const names = new Set(registry.map((command) => command.name));
  for (const group of Object.values(guide.commands))
    for (const command of group.split(', '))
      assert.ok(names.has(command), command);
  assert.ok(JSON.stringify(guide).length < 3000);
  assert.match(cliIntroduction(null).start, /Open or create/);
});
