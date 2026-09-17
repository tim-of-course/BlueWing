import type { Project } from '../core/types';

/** Local view preferences, separate from saved estimating data. */
export interface DrawingVisibility {
  hiddenSheets: string[];
  hiddenGroups: Record<string, string[]>;
}

export function visibleDrawingIds(
  project: Project | null,
  visibility: DrawingVisibility,
): ReadonlySet<string> {
  const visible = new Set<string>();
  if (!project) return visible;
  const grouped = new Set<string>();
  for (const group of Object.values(project.groups))
    for (const id of group.geometryIds) {
      grouped.add(id);
      const geometry = project.geometries[id];
      if (
        geometry &&
        !visibility.hiddenSheets.includes(geometry.sheetId) &&
        !visibility.hiddenGroups[geometry.sheetId]?.includes(group.id)
      )
        visible.add(id);
    }
  for (const geometry of Object.values(project.geometries))
    if (
      !grouped.has(geometry.id) &&
      !visibility.hiddenSheets.includes(geometry.sheetId)
    )
      visible.add(geometry.id);
  return visible;
}

export function readVisibility(projectId: string | null): DrawingVisibility {
  const empty = { hiddenSheets: [], hiddenGroups: {} };
  if (!projectId) return empty;
  try {
    const stored = localStorage.getItem(`bluewing.visibility.${projectId}`);
    if (!stored) return empty;
    const value = JSON.parse(stored) as {
      hiddenSheets?: unknown;
      hiddenGroups?: unknown;
    } | null;
    if (
      Array.isArray(value?.hiddenSheets) &&
      value.hiddenSheets.every((id) => typeof id === 'string') &&
      typeof value.hiddenGroups === 'object' &&
      value.hiddenGroups !== null &&
      !Array.isArray(value.hiddenGroups) &&
      Object.values(value.hiddenGroups).every(
        (ids) =>
          Array.isArray(ids) && ids.every((id) => typeof id === 'string'),
      )
    )
      return {
        hiddenSheets: value.hiddenSheets,
        hiddenGroups: value.hiddenGroups as Record<string, string[]>,
      };
  } catch {
    // A missing or old device preference leaves the drawing visible.
  }
  return empty;
}
