import { annotationColor, type AnnotationShape } from '../../core/annotations';
import type { Point } from '../../core/types';

export function annotationHandles(shape: AnnotationShape): Point[] {
  const [a, b] = shape.points;
  if (!a || !b || shape.kind === 'freehand') return [];
  if (shape.kind === 'line' || shape.kind === 'arrow') return [a, b];
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}

function annotationPath(shape: AnnotationShape, pixel: number) {
  const path = new Path2D();
  const [a, b] = shape.points;
  if (!a || !b) return path;
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x),
    h = Math.abs(b.y - a.y);
  if (shape.kind === 'ellipse')
    path.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
  else if (shape.kind === 'rectangle') path.rect(x, y, w, h);
  else if (shape.kind === 'revision-cloud') {
    path.moveTo(x, y);
    const edge = (start: Point, dx: number, dy: number) => {
      const count = Math.min(
        512,
        Math.max(1, Math.round(Math.hypot(dx, dy) / (16 * pixel))),
      );
      const sx = dx / count,
        sy = dy / count;
      for (let i = 0; i < count; i++) {
        const px = start.x + i * sx,
          py = start.y + i * sy;
        path.quadraticCurveTo(
          px + sx / 2 + sy / 2,
          py + sy / 2 - sx / 2,
          px + sx,
          py + sy,
        );
      }
    };
    edge({ x, y }, w, 0);
    edge({ x: x + w, y }, 0, h);
    edge({ x: x + w, y: y + h }, -w, 0);
    edge({ x, y: y + h }, 0, -h);
    path.closePath();
  } else {
    path.moveTo(a.x, a.y);
    for (const point of shape.points.slice(1)) {
      path.lineTo(point.x, point.y);
    }
    if (shape.kind === 'arrow') {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const size = Math.min(12 * pixel, Math.hypot(b.x - a.x, b.y - a.y) * 0.6);
      for (const offset of [-0.5, 0.5]) {
        path.moveTo(b.x, b.y);
        path.lineTo(
          b.x - size * Math.cos(angle + offset),
          b.y - size * Math.sin(angle + offset),
        );
      }
    }
  }
  return path;
}

function textFont(pixel: number) {
  return `italic 600 ${String(16 * pixel)}px sans-serif`;
}

export function paintAnnotation(
  ctx: CanvasRenderingContext2D,
  shape: AnnotationShape,
  pixel: number,
  selected = false,
) {
  const anchor = shape.points[0];
  if (!anchor) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,.78)';
  ctx.lineWidth = 6 * pixel;
  if (shape.kind === 'text') {
    ctx.font = textFont(pixel);
    ctx.textBaseline = 'top';
    ctx.fillStyle = annotationColor;
    (shape.text ?? '').split('\n').forEach((line, i) => {
      const y = anchor.y + i * 20 * pixel;
      ctx.strokeText(line, anchor.x, y);
      ctx.fillText(line, anchor.x, y);
    });
  } else {
    const path = annotationPath(shape, pixel);
    ctx.stroke(path);
    ctx.strokeStyle = annotationColor;
    ctx.lineWidth = 2.5 * pixel;
    ctx.stroke(path);
  }
  if (selected) {
    ctx.fillStyle = 'white';
    ctx.strokeStyle = annotationColor;
    ctx.lineWidth = 1.5 * pixel;
    const handles = annotationHandles(shape);
    for (const p of handles.length ? handles : [anchor]) {
      ctx.fillRect(p.x - 3 * pixel, p.y - 3 * pixel, 6 * pixel, 6 * pixel);
      ctx.strokeRect(p.x - 3 * pixel, p.y - 3 * pixel, 6 * pixel, 6 * pixel);
    }
  }
  ctx.restore();
}

export function hitsAnnotation(
  ctx: CanvasRenderingContext2D,
  shape: AnnotationShape,
  point: Point,
  pixel: number,
) {
  const anchor = shape.points[0];
  if (!anchor) return false;
  ctx.save();
  ctx.resetTransform();
  ctx.lineWidth = 12 * pixel;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let hit: boolean;
  if (shape.kind === 'text') {
    ctx.font = textFont(pixel);
    const lines = (shape.text ?? '').split('\n');
    const row = Math.floor((point.y - anchor.y) / (20 * pixel));
    hit =
      row >= 0 &&
      row < lines.length &&
      point.x >= anchor.x - 3 * pixel &&
      point.x <= anchor.x + ctx.measureText(lines[row] ?? '').width + 3 * pixel;
  } else
    hit = ctx.isPointInStroke(annotationPath(shape, pixel), point.x, point.y);
  ctx.restore();
  return hit;
}
