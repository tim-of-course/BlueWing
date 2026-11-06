import type { Point } from './types';

/** Bounded miter offsets for display only; authored trace points remain untouched. */
export function offsetStroke(
  points: readonly Point[],
  offset: number,
  closed: boolean,
): Point[] {
  const normal = (a: Point, b: Point) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    return length
      ? { x: -(b.y - a.y) / length, y: (b.x - a.x) / length }
      : { x: 0, y: 0 };
  };
  return points.map((point, i) => {
    const previous = points[i - 1] ?? (closed ? points.at(-1) : undefined);
    const next = points[i + 1] ?? (closed ? points[0] : undefined);
    const a = previous
      ? normal(previous, point)
      : next
        ? normal(point, next)
        : { x: 0, y: 0 };
    const b = next ? normal(point, next) : a;
    const denominator = 1 + a.x * b.x + a.y * b.y;
    if (denominator < 0.25)
      return { x: point.x + b.x * offset, y: point.y + b.y * offset };
    return {
      x: point.x + ((a.x + b.x) * offset) / denominator,
      y: point.y + ((a.y + b.y) * offset) / denominator,
    };
  });
}
