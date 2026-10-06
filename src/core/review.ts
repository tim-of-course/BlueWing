import type { Assignment, Point, Project } from './types';
import { resolveConstruction } from './applied-assemblies';
import type { ConstructionData } from './construction-types';

export interface SourceReference {
  kind: 'geometry' | 'wall' | 'opening' | 'assembly' | 'header' | 'ceiling';
  id: string;
}
export interface PlanSnippet {
  id: string;
  name: string;
  sheetId: string;
  bounds: { x: number; y: number; width: number; height: number };
  sources: SourceReference[];
  geometryIds: string[];
  annotations: { points: Point[]; label: string; color: string }[];
  note: string;
}
export interface ReviewMark {
  id: string;
  target: SourceReference;
  status: 'needs-review' | 'question' | 'reviewed';
  note: string;
  fingerprint?: string;
}
export interface ReviewData {
  snippets: Record<string, PlanSnippet>;
  marks: Record<string, ReviewMark>;
}
export const emptyReview = (): ReviewData => ({ snippets: {}, marks: {} });

export function sourceEntity(
  project: Project,
  source: SourceReference,
  construction?: ConstructionData,
): unknown {
  switch (source.kind) {
    case 'geometry':
      return project.geometries[source.id];
    case 'assembly':
      return project.recipes[source.id];
    case 'wall':
      return (construction ?? resolveConstruction(project)).walls[source.id];
    case 'opening':
      return (construction ?? resolveConstruction(project)).openings[source.id];
    case 'header':
      return (construction ?? resolveConstruction(project)).headers[source.id];
    case 'ceiling':
      return (construction ?? resolveConstruction(project)).ceilings[source.id];
  }
}

/** Canonical text makes review invalidation exact and independent of object key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return value === undefined ? 'null' : JSON.stringify(value);
}
const byId = <T extends { id: string }>(
  records: Record<string, T> | undefined,
): T[] => Object.values(records ?? {}).sort((a, b) => a.id.localeCompare(b.id));

function byReference<T>(items: T[], reference: (item: T) => string) {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = reference(item);
    const bucket = result.get(key) ?? [];
    bucket.push(item);
    result.set(key, bucket);
  }
  return result;
}

function prepareReview(project: Project, construction: ConstructionData) {
  const assignments = new Map<string, Assignment[]>();
  for (const assignment of byId(project.assignments))
    for (const id of new Set(
      project.groups[assignment.groupId]?.geometryIds ?? [],
    )) {
      const bucket = assignments.get(id) ?? [];
      bucket.push(assignment);
      assignments.set(id, bucket);
    }
  const placements = new Map<string, ConstructionData['placements'][string]>();
  for (const placement of Object.values(construction.placements))
    if (!placements.has(placement.sheetId))
      placements.set(placement.sheetId, placement);
  return {
    assignments,
    placements,
    openings: byReference(
      byId(construction.openings),
      (opening) => opening.wallId,
    ),
    walls: byReference(
      Object.values(construction.walls),
      (wall) => wall.geometryId,
    ),
    ceilings: byReference(
      Object.values(construction.ceilings),
      (ceiling) => ceiling.geometryId,
    ),
    // Keep global material and snippet order in the canonical dependency text.
    materials: Object.values(construction.materials ?? {}),
    snippets: byId(project.review?.snippets),
  };
}

export function reviewFingerprint(
  project: Project,
  target: SourceReference,
  construction: ConstructionData = resolveConstruction(project),
): string {
  return fingerprint(
    project,
    target,
    construction,
    prepareReview(project, construction),
  );
}

function fingerprint(
  project: Project,
  target: SourceReference,
  construction: ConstructionData,
  prepared: ReturnType<typeof prepareReview>,
): string {
  const entity = sourceEntity(project, target, construction);
  if (!entity) throw new Error('Review source no longer exists');
  const geometryIds = new Set<string>();
  const sources: SourceReference[] = [target];
  const levels = new Set<string>();
  const related: unknown[] = [entity];
  const includedWalls = new Set<string>();
  const includeWall = (id: string): void => {
    if (includedWalls.has(id)) return;
    const wall = construction.walls[id];
    if (!wall) return;
    includedWalls.add(id);
    related.push(wall);
    sources.push({ kind: 'wall', id });
    if (wall.levelId) levels.add(wall.levelId);
    for (const condition of wall.conditions ?? [])
      if (condition.ownerWallId && condition.ownerWallId !== id)
        includeWall(condition.ownerWallId);
    geometryIds.add(wall.geometryId);
    for (const opening of prepared.openings.get(id) ?? []) {
      related.push(opening);
      sources.push({ kind: 'opening', id: opening.id });
      if (opening.headerId) {
        related.push(construction.headers[opening.headerId]);
        sources.push({ kind: 'header', id: opening.headerId });
      }
    }
  };
  if (target.kind === 'wall') includeWall(target.id);
  if (target.kind === 'opening') {
    const opening = construction.openings[target.id];
    if (opening) includeWall(opening.wallId);
  }
  if (target.kind === 'geometry') {
    geometryIds.add(target.id);
    for (const wall of prepared.walls.get(target.id) ?? [])
      includeWall(wall.id);
    related.push(...(prepared.ceilings.get(target.id) ?? []));
  }
  if (target.kind === 'ceiling') {
    const ceiling = construction.ceilings[target.id];
    if (ceiling) geometryIds.add(ceiling.geometryId);
  }
  for (const id of geometryIds)
    for (const ceiling of prepared.ceilings.get(id) ?? [])
      if (ceiling.levelId) levels.add(ceiling.levelId);
  for (const material of prepared.materials)
    if (geometryIds.has(material.geometryId)) {
      related.push(material);
      if (material.levelId) levels.add(material.levelId);
    }
  for (const geometryId of [...geometryIds].sort()) {
    sources.push({ kind: 'geometry', id: geometryId });
    const geometry = project.geometries[geometryId];
    related.push(geometry);
    if (geometry) {
      const sheet = project.sheets[geometry.sheetId];
      related.push(
        sheet?.calibration,
        prepared.placements.get(geometry.sheetId),
      );
    }
    for (const assignment of prepared.assignments.get(geometryId) ?? []) {
      related.push(
        {
          ...assignment,
          geometryInputs: assignment.geometryInputs?.[geometryId],
          geometryDetails: assignment.geometryDetails?.[geometryId],
        },
        project.recipes[assignment.recipeId],
      );
      sources.push({ kind: 'assembly', id: assignment.recipeId });
    }
  }
  // Elevations affect member position even when wall dimensions are unchanged.
  for (const id of [...levels].sort()) related.push(construction.levels[id]);
  const sourceKeys = new Set(
    sources.map((source) => `${source.kind}:${source.id}`),
  );
  related.push(
    ...prepared.snippets.filter((snippet) =>
      snippet.sources.some((source) =>
        sourceKeys.has(`${source.kind}:${source.id}`),
      ),
    ),
  );
  return canonical(related);
}

export function reviewStatus(
  project: Project,
  mark: ReviewMark,
  construction: ConstructionData = resolveConstruction(project),
): ReviewMark['status'] | 'changed' | 'missing' {
  return status(project, mark, construction);
}

function status(
  project: Project,
  mark: ReviewMark,
  construction: ConstructionData,
  prepared?: ReturnType<typeof prepareReview>,
): ReviewMark['status'] | 'changed' | 'missing' {
  if (!sourceEntity(project, mark.target, construction)) return 'missing';
  if (mark.status !== 'reviewed') return mark.status;
  return mark.fingerprint ===
    fingerprint(
      project,
      mark.target,
      construction,
      prepared ?? prepareReview(project, construction),
    )
    ? 'reviewed'
    : 'changed';
}

export function inspectReview(project: Project) {
  const construction = resolveConstruction(project);
  const prepared = prepareReview(project, construction);
  const marks = Object.values(project.review?.marks ?? {}).map((mark) => ({
    ...mark,
    effectiveStatus: status(project, mark, construction, prepared),
  }));
  const targets: SourceReference[] = [
    ...Object.keys(construction.walls).map((id) => ({
      kind: 'wall' as const,
      id,
    })),
    ...Object.keys(construction.openings).map((id) => ({
      kind: 'opening' as const,
      id,
    })),
    ...Object.keys(construction.ceilings).map((id) => ({
      kind: 'ceiling' as const,
      id,
    })),
    ...Object.keys(project.geometries)
      .filter((id) => !prepared.walls.has(id) && !prepared.ceilings.has(id))
      .map((id) => ({ kind: 'geometry' as const, id })),
  ];
  const marked = new Set(
    marks.map((mark) => `${mark.target.kind}:${mark.target.id}`),
  );
  const unreviewed = targets.filter(
    (target) => !marked.has(`${target.kind}:${target.id}`),
  );
  return {
    marks,
    unreviewed,
    snippets: Object.values(project.review?.snippets ?? {}),
    complete:
      !unreviewed.length &&
      marks.every((mark) => mark.effectiveStatus === 'reviewed'),
  };
}

export function validateReview(project: Project, review: ReviewData): void {
  const construction = resolveConstruction(project);
  for (const [id, snippet] of Object.entries(review.snippets)) {
    if (id !== snippet.id || !snippet.name.trim())
      throw new Error('Snippet needs an id and name');
    const sheet = project.sheets[snippet.sheetId];
    const b = snippet.bounds;
    if (
      !sheet ||
      b.x < 0 ||
      b.y < 0 ||
      b.width <= 0 ||
      b.height <= 0 ||
      b.x + b.width > sheet.width + 1e-8 ||
      b.y + b.height > sheet.height + 1e-8
    )
      throw new Error('Snippet bounds must fit its sheet');
    for (const geometryId of snippet.geometryIds)
      if (project.geometries[geometryId]?.sheetId !== snippet.sheetId)
        throw new Error('Snippet highlights must belong to its sheet');
    for (const annotation of snippet.annotations) {
      if (!/^#[0-9a-f]{6}$/i.test(annotation.color))
        throw new Error('Annotation color must be a six-digit hex color');
      if (
        !annotation.points.length ||
        annotation.points.some(
          (p) =>
            p.x < b.x ||
            p.y < b.y ||
            p.x > b.x + b.width ||
            p.y > b.y + b.height,
        )
      )
        throw new Error('Annotation points must fit the snippet');
    }
    for (const source of snippet.sources)
      if (!sourceEntity(project, source, construction))
        throw new Error('Snippet source not found');
  }
  const targets = new Set<string>();
  for (const [id, mark] of Object.entries(review.marks)) {
    if (id !== mark.id) throw new Error('Review mark id mismatch');
    const key = `${mark.target.kind}:${mark.target.id}`;
    if (targets.has(key))
      throw new Error('A source may have only one review mark');
    targets.add(key);
    if (!sourceEntity(project, mark.target, construction))
      throw new Error('Review source not found');
  }
}

/** Explicit deletes prune references in the same undoable command. */
export function pruneReview(project: Project): void {
  if (!project.review) return;
  const construction = resolveConstruction(project);
  for (const [id, snippet] of Object.entries(project.review.snippets)) {
    if (!project.sheets[snippet.sheetId]) {
      Reflect.deleteProperty(project.review.snippets, id);
      continue;
    }
    snippet.geometryIds = snippet.geometryIds.filter(
      (id) => project.geometries[id],
    );
    snippet.sources = snippet.sources.filter((source) =>
      sourceEntity(project, source, construction),
    );
  }
  for (const [id, mark] of Object.entries(project.review.marks))
    if (!sourceEntity(project, mark.target, construction))
      Reflect.deleteProperty(project.review.marks, id);
}
