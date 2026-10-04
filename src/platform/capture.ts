import { domToCanvas } from 'modern-screenshot';
import { prepareCanvasCapture } from './canvas-capture';

export interface ScreenshotAttachment {
  dataUrl: string;
  width: number;
  height: number;
}

export interface ViewportCapture {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/** Capture the complete app, including rendered canvas pixels and scrolled panels. */
export async function captureViewport(): Promise<ViewportCapture> {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const canvas = await domToCanvas(document.body, {
    width,
    height,
    scale: window.devicePixelRatio || 1,
    backgroundColor: getComputedStyle(document.documentElement).backgroundColor,
    filter: (node) => {
      if (
        node instanceof Element &&
        node.hasAttribute('data-screenshot-overlay')
      )
        return false;
      // modern-screenshot clones each included canvas with toDataURL immediately
      // after this filter, before yielding. Refresh GPU pixels at that boundary.
      if (node instanceof HTMLCanvasElement) prepareCanvasCapture(node);
      return true;
    },
    features: { restoreScrollPosition: true },
    fetch: {
      placeholderImage: () => {
        throw new Error('An image could not be included in the screenshot.');
      },
    },
  });
  return { canvas, width, height };
}

/** Coordinates are viewport CSS pixels; the output retains the captured pixel density. */
export function cropCapture(
  capture: ViewportCapture,
  rect: { x: number; y: number; width: number; height: number },
): ScreenshotAttachment {
  const scaleX = capture.canvas.width / capture.width;
  const scaleY = capture.canvas.height / capture.height;
  const left = Math.max(0, Math.round(rect.x * scaleX));
  const top = Math.max(0, Math.round(rect.y * scaleY));
  const right = Math.min(
    capture.canvas.width,
    Math.round((rect.x + rect.width) * scaleX),
  );
  const bottom = Math.min(
    capture.canvas.height,
    Math.round((rect.y + rect.height) * scaleY),
  );
  if (right <= left || bottom <= top)
    throw new Error('Drag a rectangle to capture a screenshot.');
  const canvas = document.createElement('canvas');
  canvas.width = right - left;
  canvas.height = bottom - top;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Screenshot capture is unavailable.');
  context.drawImage(
    capture.canvas,
    left,
    top,
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  };
}
