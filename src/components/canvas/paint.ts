import type { Geometry } from '../../core/types';
import { offsetStroke } from '../../core/category-strokes';

export interface PaintTakeoffOptions {
  selectedIds?: string[];
  /** Geometry ID to CSS color. */
  colors?: Record<string, string>;
  /** Apply dashes without replacing the geometry's category/group color. */
  deductionIds?: readonly string[];
  /** Distinct category colors per trace. Empty means uncategorized. */
  categoryColors?: Record<string, string[]>;
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
  const inheritedDash = context.getLineDash();
  const transform = context.getTransform();
  const outputPixel = Math.hypot(transform.a, transform.b) * pixel;
  for (const geometry of geometries) {
    const first = geometry.points[0];
    if (!first) continue;
    const deduction = deductions.has(geometry.id);
    context.lineCap = deduction ? 'butt' : 'round';
    context.setLineDash(deduction ? [8 * pixel, 5 * pixel] : inheritedDash);
    if (options.categoryColors && !options.colors?.[geometry.id]) {
      paintCategoryTrace(
        context,
        geometry,
        options.categoryColors[geometry.id] ?? [],
        pixel,
        selected.has(geometry.id),
        deduction,
      );
      continue;
    }
    const color = options.colors?.[geometry.id] ?? '#3b82f6';
    context.strokeStyle = selected.has(geometry.id) ? '#60a5fa' : color;
    context.fillStyle = color;
    const isSelected = selected.has(geometry.id);
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

function paintCategoryTrace(
  context: CanvasRenderingContext2D,
  geometry: Geometry,
  colors: readonly string[],
  pixel: number,
  selected: boolean,
  deduction: boolean,
): void {
  const first = geometry.points[0];
  if (!first) return;
  const closed = geometry.kind === 'area';
  const path = (points: readonly { x: number; y: number }[]) => {
    context.beginPath();
    points.forEach((point, index) => {
      if (index) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
    });
    if (closed) context.closePath();
  };
  context.save();
  const dash = deduction ? [8 * pixel, 5 * pixel] : context.getLineDash();
  context.setLineDash(dash);
  if (geometry.kind === 'count') {
    for (const point of geometry.points) {
      for (let index = 0; index < Math.max(1, colors.length); index++) {
        context.beginPath();
        context.arc(point.x, point.y, (5 + index * 4) * pixel, 0, Math.PI * 2);
        context.strokeStyle = '#ffffff';
        context.lineWidth = 5 * pixel;
        context.stroke();
        context.strokeStyle = colors[index] ?? '#718CA6';
        context.lineWidth = 3 * pixel;
        if (!colors.length && !deduction)
          context.setLineDash([2 * pixel, 2 * pixel]);
        context.stroke();
      }
      context.setLineDash(dash);
      if (selected) {
        context.beginPath();
        context.arc(
          point.x,
          point.y,
          (9 + Math.max(0, colors.length - 1) * 4) * pixel,
          0,
          Math.PI * 2,
        );
        context.strokeStyle = '#172B4D';
        context.lineWidth = pixel;
        context.stroke();
      }
    }
  } else if (!colors.length) {
    path(geometry.points);
    context.strokeStyle = '#718CA6';
    context.globalAlpha *= 0.45;
    context.lineWidth = 9 * pixel;
    context.stroke();
    context.globalAlpha /= 0.45;
    const points = closed ? [...geometry.points, first] : geometry.points;
    let runDistance = 0;
    context.setLineDash([]);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      if (!a || !b) continue;
      const length = Math.hypot(b.x - a.x, b.y - a.y),
        dx = (b.x - a.x) / (length || 1),
        dy = (b.y - a.y) / (length || 1);
      context.beginPath();
      for (let distance = 0; distance < length; distance += 7 * pixel) {
        // Keep the uncategorized hatch inside each deduction dash, leaving gaps clear.
        const phase = ((runDistance + distance) / pixel) % 13;
        if (deduction && (phase < 3 || phase > 5)) continue;
        const x = a.x + dx * distance,
          y = a.y + dy * distance;
        context.moveTo(x + (dy - dx) * 3 * pixel, y - (dx + dy) * 3 * pixel);
        context.lineTo(x - (dy - dx) * 3 * pixel, y + (dx + dy) * 3 * pixel);
      }
      context.lineWidth = pixel;
      context.stroke();
      runDistance += length;
    }
    context.setLineDash(dash);
  } else {
    colors.forEach((color, index) => {
      const offset = (index - (colors.length - 1) / 2) * 5 * pixel;
      path(offsetStroke(geometry.points, offset, closed));
      context.strokeStyle = '#ffffff';
      context.lineWidth = 5 * pixel;
      context.stroke();
      context.strokeStyle = color;
      context.lineWidth = 3 * pixel;
      context.stroke();
    });
  }
  if (selected && geometry.kind !== 'count') {
    path(geometry.points);
    context.strokeStyle = '#172B4D';
    context.lineWidth = pixel;
    context.setLineDash(deduction ? dash : [3 * pixel, 3 * pixel]);
    context.stroke();
  }
  context.restore();
}
