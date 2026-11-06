import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { captureBrowserArtifact } from '@solidjs/diagnostics/playwright';
import { expectNoDiagnostics, expectNoSilentHolds } from '@solidjs/diagnostics';
import { captureErrors } from './wingman';
import {
  alignmentDesktopWorkflow,
  alignmentFixture,
  alignmentRenderWorkflow,
} from './page-alignment';

test('page-scoped exports preserve source coordinates and align only combined scenes', async ({
  page,
}, info) => {
  const errors = await captureErrors(page);
  const sheets = await alignmentFixture(page);
  const { artifact } = await captureBrowserArtifact(
    page,
    () => alignmentRenderWorkflow(page, sheets),
    { scenario: 'page-alignment' },
  );
  await writeFile(
    info.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});

test('desktop page filters and two-point alignment save only accepted drafts', async ({
  page,
}, info) => {
  const errors = await captureErrors(page);
  const sheets = await alignmentFixture(page);
  const { artifact } = await captureBrowserArtifact(
    page,
    () => alignmentDesktopWorkflow(page, sheets),
    { scenario: 'desktop-page-alignment' },
  );
  await writeFile(
    info.outputPath('solid-diagnostics.json'),
    JSON.stringify(artifact, null, 2),
  );
  expectNoDiagnostics(artifact);
  expectNoSilentHolds(artifact);
  expect(errors).toEqual([]);
});
