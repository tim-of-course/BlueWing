// GPU canvases may discard their drawing buffer after presenting a frame.
// Keep capture preparation independent of the renderer and the screenshot tool.
const preparations = new WeakMap<HTMLCanvasElement, () => void>();

export function registerCanvasCapture(
  canvas: HTMLCanvasElement,
  prepare: () => void,
): () => void {
  preparations.set(canvas, prepare);
  return () => {
    if (preparations.get(canvas) === prepare) preparations.delete(canvas);
  };
}

export function prepareCanvasCapture(canvas: HTMLCanvasElement): void {
  preparations.get(canvas)?.();
}
