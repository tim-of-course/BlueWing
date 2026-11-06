import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applicationCommands } from '../../src/app/registry';
import { commandRegistry } from '../../src/core/commands';
import { cliIntroduction } from '../../src/app/cli-guide';
import {
  pageNamingInstructions,
  pageNamingTask,
} from '../../src/app/page-naming';

void test('the agent can discover the specific naming workflow and its crop fallback', () => {
  const commands = [...applicationCommands, ...commandRegistry].map(
    (entry) => entry.name,
  );
  for (const name of [
    'sheet.naming.start',
    'sheet.naming.read',
    'sheet.naming.apply',
    'sheet.naming.cancel',
  ])
    assert(commands.includes(name));
  assert(!commands.some((name) => name.startsWith('sheet.text')));
  assert.equal(
    cliIntroduction(null).workflows.pageNaming.start,
    'sheet.naming.start',
  );
  assert.match(pageNamingInstructions, /sheet.render/);
  assert.match(
    pageNamingInstructions,
    /revision from your latest sheet.naming.read/,
  );
  assert.doesNotMatch(pageNamingInstructions, /project.inspect/);
  assert.match(pageNamingInstructions, /bottom-right title-block/);
  const prompt = pageNamingTask(
    {
      cliPath: 'C:/Bluewing/bluewing.exe',
      dataDir: 'C:/session',
      shell: 'powershell',
    },
    { id: 'project-123', name: 'Estimate' },
  );
  assert.match(prompt, /sheet.naming.start/);
  assert.match(prompt, /project-123/);
  assert.match(prompt, /BLUEWING_DATA_DIR/);
});
