import type { Point, Project } from './types';

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
): unknown {
  switch (source.kind) {
    case 'geometry':
      return project.geometries[source.id];
    case 'assembly':
      return project.recipes[source.id];
    case 'wall':
      return project.construction?.walls[source.id];
    case 'opening':
      return project.construction?.openings[source.id];
    case 'header':
      return project.construction?.headers[source.id];
    case 'ceiling':
      return project.construction?.ceilings[source.id];
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

export function reviewFingerprint(
  project: Project,
  target: SourceReference,
): string {
  const entity = sourceEntity(project, target);
  if (!entity) throw new Error('Review source no longer exists');
  const construction = project.construction;
  const geometryIds = new Set<string>();
  const sources: SourceReference[] = [target];
  const levels = new Set<string>();
  const related: unknown[] = [entity];
  const includeWall = (id: string) => {
    const wall = construction?.walls[id];
    if (!wall) return;
    related.push(wall);
    sources.push({ kind: 'wall', id });
    if (wall.levelId) levels.add(wall.levelId);
    for (const condition of wall.conditions ?? [])
      if (condition.ownerWallId && condition.ownerWallId !== id)
        related.push(construction.walls[condition.ownerWallId]);
    geometryIds.add(wall.geometryId);
    for (const opening of byId(construction.openings)) {
      if (opening.wallId !== id) continue;
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
    const opening = construction?.openings[target.id];
    if (opening) includeWall(opening.wallId);
  }
  if (target.kind === 'geometry') {
    geometryIds.add(target.id);
    for (const wall of Object.values(construction?.walls ?? {}))
      if (wall.geometryId === target.id) includeWall(wall.id);
    related.push(
      ...Object.values(construction?.ceilings ?? {}).filter(
        (c) => c.geometryId === target.id,
      ),
    );
  }
  if (target.kind === 'ceiling') {
    const ceiling = construction?.ceilings[target.id];
    if (ceiling) geometryIds.add(ceiling.geometryId);
  }
  for (const ceiling of Object.values(construction?.ceilings ?? {}))
    if (geometryIds.has(ceiling.geometryId) && ceiling.levelId)
      levels.add(ceiling.levelId);
  for (const geometryId of [...geometryIds].sort()) {
    sources.push({ kind: 'geometry', id: geometryId });
    const geometry = project.geometries[geometryId];
    related.push(geometry);
    if (geometry) {
      const sheet = project.sheets[geometry.sheetId];
      related.push(
        sheet?.calibration,
        Object.values(construction?.placements ?? {}).find(
          (placement) => placement.sheetId === geometry.sheetId,
        ),
      );
    }
    for (const assignment of byId(project.assignments)) {
      if (!project.groups[assignment.groupId]?.geometryIds.includes(geometryId))
        continue;
      related.push(
        {
          ...assignment,
          geometryInputs: assignment.geometryInputs?.[geometryId],
        },
        project.recipes[assignment.recipeId],
      );
      sources.push({ kind: 'assembly', id: assignment.recipeId });
    }
  }
  // Elevations affect member position even when wall dimensions are unchanged.
  for (const id of [...levels].sort()) related.push(construction?.levels[id]);
  related.push(
    ...byId(project.review?.snippets).filter((snippet) =>
      snippet.sources.some((source) =>
        sources.some(
          (related) => source.kind === related.kind && source.id === related.id,
        ),
      ),
    ),
  );
  return canonical(related);
}

export function reviewStatus(
  project: Project,
  mark: ReviewMark,
): ReviewMark['status'] | 'changed' | 'missing' {
  if (!sourceEntity(project, mark.target)) return 'missing';
  if (mark.status !== 'reviewed') return mark.status;
  return mark.fingerprint === reviewFingerprint(project, mark.target)
    ? 'reviewed'
    : 'changed';
}

export function inspectReview(project: Project) {
  const marks = Object.values(project.review?.marks ?? {}).map((mark) => ({
    ...mark,
    effectiveStatus: reviewStatus(project, mark),
  }));
  const targets: SourceReference[] = [
    ...Object.keys(project.construction?.walls ?? {}).map((id) => ({
      kind: 'wall' as const,
      id,
    })),
    ...Object.keys(project.construction?.openings ?? {}).map((id) => ({
      kind: 'opening' as const,
      id,
    })),
    ...Object.keys(project.construction?.ceilings ?? {}).map((id) => ({
      kind: 'ceiling' as const,
      id,
    })),
    ...Object.keys(project.geometries)
      .filter(
        (id) =>
          !Object.values(project.construction?.walls ?? {}).some(
            (w) => w.geometryId === id,
          ) &&
          !Object.values(project.construction?.ceilings ?? {}).some(
            (c) => c.geometryId === id,
          ),
      )
      .map((id) => ({ kind: 'geometry' as const, id })),
  ];
  const unreviewed = targets.filter(
    (target) =>
      !marks.some(
        (mark) =>
          mark.target.kind === target.kind && mark.target.id === target.id,
      ),
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
      if (!sourceEntity(project, source))
        throw new Error('Snippet source not found');
  }
  const targets = new Set<string>();
  for (const [id, mark] of Object.entries(review.marks)) {
    if (id !== mark.id) throw new Error('Review mark id mismatch');
    const key = `${mark.target.kind}:${mark.target.id}`;
    if (targets.has(key))
      throw new Error('A source may have only one review mark');
    targets.add(key);
    if (!sourceEntity(project, mark.target))
      throw new Error('Review source not found');
  }
}

/** Explicit deletes prune references in the same undoable command. */
export function pruneReview(project: Project): void {
  if (!project.review) return;
  for (const [id, snippet] of Object.entries(project.review.snippets)) {
    if (!project.sheets[snippet.sheetId]) {
      Reflect.deleteProperty(project.review.snippets, id);
      continue;
    }
    snippet.geometryIds = snippet.geometryIds.filter(
      (id) => project.geometries[id],
    );
    snippet.sources = snippet.sources.filter((source) =>
      sourceEntity(project, source),
    );
  }
  for (const [id, mark] of Object.entries(project.review.marks))
    if (!sourceEntity(project, mark.target))
      Reflect.deleteProperty(project.review.marks, id);
}
