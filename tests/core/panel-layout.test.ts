import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fitWorkspacePanels,
  panelSizes,
  type PanelName,
} from '../../src/app/panel-layout';

void test('display the most recent pinned panels that fit beside 600 px of drawing', () => {
  const panels = (['inspector', 'sheets', 'wingman'] as PanelName[]).map(
    (name) => ({ name, width: panelSizes[name].width, pinned: true }),
  );
  assert.deepEqual(
    [...fitWorkspacePanels(1400, panels)],
    ['sheets', 'wingman'],
  );
  assert.deepEqual([...fitWorkspacePanels(1280, panels)], ['wingman']);
  assert.deepEqual([...fitWorkspacePanels(760, panels)], []);
  const promoted = [...panels.slice(1), panels[0] as (typeof panels)[number]];
  assert.deepEqual(
    [...fitWorkspacePanels(1400, promoted)],
    ['wingman', 'inspector'],
  );
  assert.equal(fitWorkspacePanels(1760, promoted).size, 3);
  const unpinned = panels.map((panel) => ({
    ...panel,
    pinned: panel.name !== 'wingman',
  }));
  assert.deepEqual(
    [...fitWorkspacePanels(1400, unpinned)],
    ['inspector', 'sheets'],
  );
});
