import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import {
  captureErrors,
  captureWorkflow,
  messagingWorkflow,
  keyboardWorkflow,
  promptWorkflow,
  modelWorkflow,
  startWingmanProject,
  viewWorkflow,
} from './wingman';

for (const [name, workflow] of [
  ['connection prompts and clipboard fallback', promptWorkflow],
  ['Enter sends, Shift+Enter and composition do not', keyboardWorkflow],
  ['CLI renders and exact view restoration', viewWorkflow],
  ['message cursors, long polling and pause', messagingWorkflow],
  ['live 3D preview, split restoration and draft protection', modelWorkflow],
  ['screenshot pixels, editing and conversation persistence', captureWorkflow],
] as const) {
  test(name, async ({ page }, testInfo) => {
    const errors = await captureErrors(page);
    await startWingmanProject(page, true);
    const { artifact } = await captureBrowserArtifact(
      page,
      () => workflow(page),
      { scenario: `wingman-${testInfo.title}` },
    );
    const path = testInfo.outputPath('solid-diagnostics.json');
    await writeFile(path, JSON.stringify(artifact, null, 2));
    await testInfo.attach('solid-diagnostics', {
      path,
      contentType: 'application/json',
    });
    expect(artifact.attribution?.reruns.length).toBeGreaterThan(0);
    expectNoDiagnostics(artifact);
    expectNoSilentHolds(artifact);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('wingman.png') });
  });
}
