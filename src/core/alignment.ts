import { sheetPointToWorld } from './construction';
import type { Combined3dAlignment, Point, Project } from './types';

export interface MatchSheetAlignmentPayload {
  sheetId: string;
  referenceSheetId: string;
  sourcePoints: readonly Point[];
  referencePoints: readonly Point[];
}

export function applySheetAlignment(
  point: Point,
  alignment: Combined3dAlignment,
): Point {
  const c = Math.cos(alignment.rotation),
    s = Math.sin(alignment.rotation);
  return {
    x: c * point.x - s * point.y + alignment.offset.x,
    y: s * point.x + c * point.y + alignment.offset.y,
  };
}

/** Solve a rigid XY transform; distances and residuals are model metres. */
export function matchSheetAlignment(
  project: Project,
  payload: MatchSheetAlignmentPayload,
) {
  const { sheetId, referenceSheetId, sourcePoints, referencePoints } = payload;
  if (sheetId === referenceSheetId)
    throw new Error('Alignment needs distinct sheets');
  if (
    ![1, 2].includes(sourcePoints.length) ||
    sourcePoints.length !== referencePoints.length
  )
    throw new Error('Alignment needs one or two paired points');
  const worldPoints = (id: string, points: readonly Point[]) => {
    const sheet = Object.hasOwn(project.sheets, id)
      ? project.sheets[id]
      : undefined;
    if (!sheet) throw new Error(`Sheet not found: ${id}`);
    const scale = sheet.calibration?.metresPerUnit;
    if (!scale || !Number.isFinite(scale) || scale <= 0)
      throw new Error(`Sheet calibration required: ${id}`);
    const placement = Object.values(
      project.construction?.placements ?? {},
    ).find((p) => p.sheetId === id);
    return points.map((point) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
        throw new Error('Alignment points must be finite');
      return sheetPointToWorld(point, scale, placement);
    });
  };
  const source = worldPoints(sheetId, sourcePoints);
  const referenceAlignment =
    project.sheets[referenceSheetId]?.combined3dAlignment;
  const reference = worldPoints(referenceSheetId, referencePoints).map((p) =>
    referenceAlignment ? applySheetAlignment(p, referenceAlignment) : p,
  );
  const a = source[0],
    b = reference[0];
  if (!a || !b) throw new Error('Alignment needs paired points');
  let rotation = project.sheets[sheetId]?.combined3dAlignment?.rotation ?? 0;
  let sourceDistance: number | null = null,
    referenceDistance: number | null = null;
  if (source[1] && reference[1]) {
    const u = { x: source[1].x - a.x, y: source[1].y - a.y };
    const v = { x: reference[1].x - b.x, y: reference[1].y - b.y };
    sourceDistance = Math.hypot(u.x, u.y);
    referenceDistance = Math.hypot(v.x, v.y);
    if (sourceDistance <= 1e-8 || referenceDistance <= 1e-8)
      throw new Error('Alignment point pairs must not coincide');
    rotation = Math.atan2(v.y, v.x) - Math.atan2(u.y, u.x);
    rotation = Math.atan2(Math.sin(rotation), Math.cos(rotation));
  }
  const rotated = applySheetAlignment(a, { offset: { x: 0, y: 0 }, rotation });
  const alignment: Combined3dAlignment = {
    rotation,
    offset: { x: b.x - rotated.x, y: b.y - rotated.y },
  };
  const residuals = source.map((p, i) => {
    const mapped = applySheetAlignment(p, alignment),
      target = reference[i];
    if (!target) throw new Error('Alignment needs paired points');
    return Math.hypot(mapped.x - target.x, mapped.y - target.y);
  });
  const residual = Math.max(...residuals);
  if (
    ![alignment.offset.x, alignment.offset.y, rotation, residual].every(
      Number.isFinite,
    )
  )
    throw new Error('Alignment transform must be finite');
  return { alignment, sourceDistance, referenceDistance, residual, residuals };
}
