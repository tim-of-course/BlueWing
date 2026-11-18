import { createEffect, createSignal, onSettled } from 'solid-js';
import type { AnnotationShape } from '../core/annotations';
import { paintViewAnnotations } from './canvas/annotations';

export default function ViewInk(props: {
  shapes: readonly AnnotationShape[];
  class: string;
}) {
  let canvas!: HTMLCanvasElement;
  const [size, setSize] = createSignal({ width: 0, height: 0 });
  onSettled(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  });
  createEffect(
    () => ({ size: size(), shapes: props.shapes }),
    ({ size, shapes }) => {
      if (!size.width || !size.height) return;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(size.width * ratio);
      canvas.height = Math.round(size.height * ratio);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      paintViewAnnotations(ctx, shapes, size.width, size.height);
    },
  );
  return (
    <canvas ref={canvas} class={props.class} aria-label="View annotations" />
  );
}
