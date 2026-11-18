export const panelSizes = {
  sheets: { id: 'sheet-navigator', width: 292, min: 220, max: 500 },
  inspector: { id: 'group-inspector', width: 330, min: 260, max: 550 },
  wingman: { id: 'wingman-panel', width: 380, min: 300, max: 600 },
} as const;
export type PanelName = keyof typeof panelSizes;
export const panelStripWidth = 38;

/** Input is ordered from least to most recently opened. Only displayed pins consume their saved width. */
export function fitWorkspacePanels(
  workspaceWidth: number,
  panels: readonly { name: PanelName; width: number; pinned: boolean }[],
) {
  const displayed = new Set(
    panels.filter((panel) => panel.pinned).map((panel) => panel.name),
  );
  let remaining = workspaceWidth - 48; // Drawing tool rail.
  for (const panel of panels)
    remaining -= panel.pinned
      ? panel.width
      : panel.name === 'wingman'
        ? panelStripWidth
        : 0;
  for (const panel of panels) {
    if (remaining >= 600) break;
    if (displayed.delete(panel.name))
      remaining += panel.width - panelStripWidth;
  }
  return displayed;
}
