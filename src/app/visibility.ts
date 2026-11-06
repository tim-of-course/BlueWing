import type { Project } from '../core/types';
import {
  geometryCategories,
  geometryMatchesCategories,
} from '../core/categories';
import type { CategoryFilter } from '../core/categories';

/** Local view preferences, separate from saved estimating data. */
export interface DrawingVisibility {
  hiddenSheets: string[];
  hiddenGroups: Record<string, string[]>;
}

/** Categories from groups hidden on a trace's sheet do not contribute to it. */
export function visibleCategoryTags(
  project: Project,
  visibility: DrawingVisibility,
): Record<string, string[]> {
  const groups = Object.fromEntries(
    Object.values(project.groups).map((group) => [
      group.id,
      {
        ...group,
        geometryIds: group.geometryIds.filter((id) => {
          const geometry = project.geometries[id];
          return (
            geometry &&
            !visibility.hiddenSheets.includes(geometry.sheetId) &&
            !visibility.hiddenGroups[geometry.sheetId]?.includes(group.id)
          );
        }),
      },
    ]),
  );
  return geometryCategories({ ...project, groups });
}

export function visibleDrawingIds(
  project: Project | null,
  visibility: DrawingVisibility,
  categories?: CategoryFilter,
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
  const tags = visibleCategoryTags(project, visibility);
  for (const id of visible)
    if (!geometryMatchesCategories(tags[id] ?? [], categories))
      visible.delete(id);
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
