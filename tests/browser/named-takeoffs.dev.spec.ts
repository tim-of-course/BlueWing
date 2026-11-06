import { test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { namedTakeoffs } from './named-takeoffs';

test('named takeoffs isolate UI selection, explicit CLI work, exports, renders and reopening', async ({
  page,
}, info) => {
  await namedTakeoffs(page);
  const id = await page.getByLabel('Active takeoff').inputValue();
  const { artifact } = await captureBrowserArtifact(
    page,
    async () => {
      await page.getByLabel('Active takeoff').selectOption('main');
      await page.getByLabel('Active takeoff').selectOption(id);
    },
    { scenario: 'switch-independent-takeoffs' },
  );
  await writeFile(
    info.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
});
