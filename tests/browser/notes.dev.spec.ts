import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureErrors, startWingmanProject } from './wingman';
import { notesWorkflow } from './notes';

test('scratchpad saves, finds, preserves drafts and synchronizes with CLI', async ({
  page,
}, info) => {
  const errors = await captureErrors(page);
  await startWingmanProject(page, true);
  const { artifact } = await captureBrowserArtifact(
    page,
    () => notesWorkflow(page, true),
    { scenario: 'notes' },
  );
  await writeFile(
    info.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});
