import type { Project } from './types';
import type { ConstructionSnapshot } from './calculation-state';

export type CategoryFilter = readonly (string | null)[] | undefined;
export type CategoryContext = Pick<Project, 'categoryColors'> & {
  recipes: Record<string, { category?: string }>;
  assignments: Record<string, { recipeId: string }>;
};

/** Only scope presentation fields; unrelated project edits retain the scene. */
export function categoryContext(project: Project): CategoryContext {
  return {
    ...(project.categoryColors
      ? { categoryColors: project.categoryColors }
      : {}),
    recipes: Object.fromEntries(
      Object.entries(project.recipes).map(([id, recipe]) => [
        id,
        recipe.category === undefined ? {} : { category: recipe.category },
      ]),
    ),
    assignments: Object.fromEntries(
      Object.entries(project.assignments).map(([id, assignment]) => [
        id,
        { recipeId: assignment.recipeId },
      ]),
    ),
  };
}
/** Saturated scope colors remain legible over blueprint linework. */
export const standardCategories = [
  { name: 'Light-gauge metal framing', color: '#0077CC' },
  { name: 'Wood blocking/backing', color: '#C05A00' },
  { name: 'Sheathing/FRP', color: '#008A39' },
  { name: 'Moisture barriers', color: '#009BA8' },
  { name: 'Drywall hang/finish', color: '#C023A0' },
  { name: 'Acoustical ceilings/acoustical work', color: '#D18A00' },
  { name: 'Demo', color: '#E03131' },
] as const;
const aliases: Record<string, string> = {
  'light gauge framing': standardCategories[0].name,
  'blocking and rough carpentry': standardCategories[1].name,
  'frp and sheathing': standardCategories[2].name,
  'other sheathing': standardCategories[2].name,
  drywall: standardCategories[4].name,
  'acoustical ceilings': standardCategories[5].name,
  'acoustical wall panels': standardCategories[5].name,
};

export function categoryName(value?: string | null): string | null {
  const name = value?.trim();
  if (!name) return null;
  return (
    standardCategories.find(
      (entry) => entry.name.toLowerCase() === name.toLowerCase(),
    )?.name ??
    (Object.hasOwn(aliases, name.toLowerCase())
      ? (aliases[name.toLowerCase()] ?? name)
      : name)
  );
}

export function matchesCategories(
  category: string | null,
  filter: CategoryFilter,
): boolean {
  return (
    filter === undefined ||
    filter.some(
      (name) =>
        categoryName(name)?.toLowerCase() ===
        categoryName(category)?.toLowerCase(),
    )
  );
}

export function geometryMatchesCategories(
  categories: readonly string[],
  filter: CategoryFilter,
): boolean {
  return categories.length
    ? categories.some((name) => matchesCategories(name, filter))
    : matchesCategories(null, filter);
}

export function categoryColor(
  project: Pick<Project, 'categoryColors'>,
  category: string | null,
): string {
  const name = categoryName(category);
  if (!name) return '#718CA6';
  const standard = standardCategories.find((entry) => entry.name === name);
  if (standard) return standard.color;
  const custom = Object.entries(project.categoryColors ?? {}).find(
    ([key]) => categoryName(key)?.toLowerCase() === name.toLowerCase(),
  );
  if (custom) return custom[1];
  let hash = 0;
  for (const char of name.toLowerCase())
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${String((hash >>> 0) % 360)}, 80%, 40%)`;
}

export function categoryOptions(
  project: Project,
): { name: string; color: string }[] {
  const names = new Map<string, string>();
  for (const value of [
    ...standardCategories.map((entry) => entry.name),
    ...Object.keys(project.categoryColors ?? {}),
    ...Object.values(project.recipes).map((recipe) => recipe.category),
  ]) {
    const name = categoryName(value);
    if (name && !names.has(name.toLowerCase()))
      names.set(name.toLowerCase(), name);
  }
  return [...names.values()].map((name) => ({
    name,
    color: categoryColor(project, name),
  }));
}

/** Categories belong to applied assemblies, never to individual generated items. */
export function geometryCategories(project: Project): Record<string, string[]> {
  const tags: Record<string, Set<string>> = {};
  const names = new Map(
    categoryOptions(project).map((entry) => [
      entry.name.toLowerCase(),
      entry.name,
    ]),
  );
  for (const assignment of Object.values(project.assignments)) {
    const recipe = project.recipes[assignment.recipeId];
    const raw = categoryName(recipe?.category);
    const category = raw ? (names.get(raw.toLowerCase()) ?? raw) : null;
    if (!recipe || !category) continue;
    for (const id of project.groups[assignment.groupId]?.geometryIds ?? []) {
      const geometry = project.geometries[id];
      if (geometry && recipe.geometryKinds.includes(geometry.kind))
        (tags[id] ??= new Set()).add(category);
    }
  }
  return Object.fromEntries(
    Object.entries(tags).map(([id, names]) => [
      id,
      [...names].sort((a, b) => a.localeCompare(b)),
    ]),
  );
}

export function categoryPaintColors(
  project: Project,
  filter?: CategoryFilter,
): Record<string, string[]> {
  const tags = geometryCategories(project);
  return Object.fromEntries(
    Object.keys(project.geometries).map((id) => [
      id,
      (tags[id] ?? [])
        .filter((name) => matchesCategories(name, filter))
        .map((name) => categoryColor(project, name)),
    ]),
  );
}

/** Filter a complete generated model without recalculating or altering purchases. */
export function filterConstructionCategories(
  project: Project,
  model: ConstructionSnapshot,
  filter: CategoryFilter,
): ConstructionSnapshot {
  if (filter === undefined) return model;
  const include = (source: { recipeId?: string }) =>
    matchesCategories(
      categoryName(project.recipes[source.recipeId ?? '']?.category),
      filter,
    );
  return {
    ...model,
    pieces: model.pieces.filter(include),
    surfaces: model.surfaces.filter(include),
    purchases: model.purchases.filter(include),
    ...(model.surfacePurchases
      ? { surfacePurchases: model.surfacePurchases.filter(include) }
      : {}),
    diagnostics: model.diagnostics.filter(
      (source) => !source.recipeId || include(source),
    ),
  };
}

export function validateCategoryColor(name: string, color: string): void {
  if (
    !name.trim() ||
    name !== name.trim() ||
    ['__proto__', 'constructor', 'prototype'].includes(name) ||
    standardCategories.some((entry) => entry.name === categoryName(name))
  )
    throw new Error(
      'Use a unique project category name, separate from the standard categories',
    );
  if (!/^#[0-9a-f]{6}$/i.test(color))
    throw new Error('Category color must be a six-digit hex color');
}
