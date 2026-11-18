import type { Point } from './types';

export const annotationKinds = [
  'arrow',
  'text',
  'line',
  'rectangle',
  'ellipse',
  'revision-cloud',
  'freehand',
] as const;
export type AnnotationKind = (typeof annotationKinds)[number];
export interface AnnotationShape {
  kind: AnnotationKind;
  points: Point[];
  text?: string;
}
export interface SheetAnnotation extends AnnotationShape {
  id: string;
  sheetId: string;
  readonly author: 'user' | 'agent';
  readonly createdAt: string;
}
export const annotationColor = '#9E174D';
export function checkAnnotationColor(color?: string) {
  if (color?.trim().toUpperCase() === annotationColor)
    throw new Error('This color is reserved for sheet annotations');
}
export function validateAnnotation(annotation: SheetAnnotation) {
  const { kind, points, text, createdAt } = annotation;
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== createdAt)
    throw new Error('Annotation creation time must be UTC');
  if (kind === 'text') {
    if (points.length !== 1 || !text?.trim())
      throw new Error('A text annotation requires one anchor and text');
    return;
  }
  if (text !== undefined) throw new Error('Only text annotations accept text');
  const [first, second] = points;
  if (!first || !second || (kind !== 'freehand' && points.length !== 2))
    throw new Error('Invalid number of annotation points');
  if (points.every((p) => p.x === first.x && p.y === first.y))
    throw new Error('An annotation needs distinct points');
  if (
    ['rectangle', 'ellipse', 'revision-cloud'].includes(kind) &&
    (first.x === second.x || first.y === second.y)
  )
    throw new Error('Annotation bounds need width and height');
}
