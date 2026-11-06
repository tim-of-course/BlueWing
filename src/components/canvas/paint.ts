import type { Geometry } from '../../core/types';

export interface PaintTakeoffOptions {
  selectedIds?: string[];
  /** Geometry ID to CSS color. */
  colors?: Record<string, string>;
  /** Apply dashes without replacing the geometry's category/group color. */
  deductionIds?: readonly string[];
  /** Page units per output pixel; keeps strokes and count markers legible. */
  unitsPerPixel?: number;
}

/** Paint in top-left page coordinates. Caller applies camera/output transform and PDF background. */
export function paintTakeoff(
  context: CanvasRenderingContext2D,
  geometries: Geometry[],
  options: PaintTakeoffOptions = {},
): void {
  const pixel = options.unitsPerPixel ?? 1;
  const selected = new Set(options.selectedIds ?? []);
  const deductions = new Set(options.deductionIds ?? []);
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const transform = context.getTransform();
  const outputPixel = Math.hypot(transform.a, transform.b) * pixel;
  for (const geometry of geometries) {
    const first = geometry.points[0];
    if (!first) continue;
    const color = options.colors?.[geometry.id] ?? '#3b82f6';
    context.strokeStyle = selected.has(geometry.id) ? '#60a5fa' : color;
    context.fillStyle = color;
    const isSelected = selected.has(geometry.id);
    context.setLineDash(
      deductions.has(geometry.id) ? [8 * pixel, 5 * pixel] : [],
    );
    context.lineWidth = (isSelected ? 3 : 2) * pixel;
    if (geometry.kind === 'count') {
      for (const point of geometry.points) {
        context.beginPath();
        context.arc(point.x, point.y, 5 * pixel, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.moveTo(point.x - 3 * pixel, point.y);
        context.lineTo(point.x + 3 * pixel, point.y);
        context.moveTo(point.x, point.y - 3 * pixel);
        context.lineTo(point.x, point.y + 3 * pixel);
        context.stroke();
      }
      continue;
    }
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (const point of geometry.points.slice(1))
      context.lineTo(point.x, point.y);
    if (geometry.kind === 'area') {
      context.closePath();
      context.save();
      context.globalAlpha *= 0.16;
      context.fill();
      context.restore();
    }
    context.lineWidth = (isSelected ? 6 : 4) * pixel;
    context.shadowColor = isSelected ? '#60a5fa' : color;
    context.shadowBlur = (isSelected ? 10 : 4) * outputPixel;
    context.stroke();
    context.shadowBlur = 0;
  }
  context.restore();
}
