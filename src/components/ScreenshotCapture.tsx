import { createSignal, onSettled, Show } from 'solid-js';
import {
  captureViewport,
  cropCapture,
  type ScreenshotAttachment,
  type ViewportCapture,
} from '../platform/capture';
import './screenshot-capture.css';

export default function ScreenshotCapture(props: {
  onCapture: (attachment: ScreenshotAttachment) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  let overlay: HTMLDivElement | undefined;
  let capture: ViewportCapture | undefined;
  let start: { x: number; y: number; pointerId: number } | undefined;
  let finished = false;
  const [preview, setPreview] = createSignal<HTMLCanvasElement>();
  const [selection, setSelection] = createSignal<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>();
  const cancel = () => {
    if (finished) return;
    finished = true;
    props.onCancel();
  };
  const fail = (error: unknown) => {
    if (finished) return;
    finished = true;
    props.onError(error instanceof Error ? error.message : String(error));
  };
  const point = (event: PointerEvent) => ({
    x: Math.max(0, Math.min(capture?.width ?? 0, event.clientX)),
    y: Math.max(0, Math.min(capture?.height ?? 0, event.clientY)),
  });
  const rectangle = (event: PointerEvent) => {
    const end = point(event);
    const origin = start ?? end;
    return {
      x: Math.min(origin.x, end.x),
      y: Math.min(origin.y, end.y),
      width: Math.abs(end.x - origin.x),
      height: Math.abs(end.y - origin.y),
    };
  };

  onSettled(() => {
    const previousFocus = document.activeElement;
    overlay?.focus();
    const keydown = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      event.preventDefault();
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', cancel);
    void captureViewport()
      .then((result) => {
        if (finished) return;
        capture = result;
        result.canvas.className = 'screenshot-capture-image';
        result.canvas.setAttribute('aria-hidden', 'true');
        setPreview(result.canvas);
      })
      .catch(fail);
    return () => {
      finished = true;
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('resize', cancel);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  });

  return (
    <div
      ref={(element) => {
        overlay = element;
      }}
      class="screenshot-capture"
      data-screenshot-overlay
      role="dialog"
      aria-modal="true"
      aria-label="Capture screenshot: drag a rectangle, or press Escape to cancel"
      tabindex={-1}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!capture || finished || event.button !== 0) return;
        start = { ...point(event), pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
        setSelection(rectangle(event));
      }}
      onPointerMove={(event) => {
        if (start?.pointerId === event.pointerId)
          setSelection(rectangle(event));
      }}
      onPointerUp={(event) => {
        if (!capture || finished || start?.pointerId !== event.pointerId)
          return;
        const rect = rectangle(event);
        start = undefined;
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (rect.width < 2 || rect.height < 2) {
          setSelection(undefined);
          return;
        }
        try {
          const attachment = cropCapture(capture, rect);
          finished = true;
          props.onCapture(attachment);
        } catch (error) {
          fail(error);
        }
      }}
      onPointerCancel={cancel}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      onWheel={(event) => {
        event.preventDefault();
      }}
    >
      {preview()}
      <Show
        when={selection()}
        fallback={<div class="screenshot-capture-shade" />}
      >
        {(rect) => (
          <div
            class="screenshot-capture-selection"
            style={{
              left: `${String(rect().x)}px`,
              top: `${String(rect().y)}px`,
              width: `${String(rect().width)}px`,
              height: `${String(rect().height)}px`,
            }}
          />
        )}
      </Show>
      <div class="screenshot-capture-hint" role="status">
        {preview()
          ? 'Drag to capture · Escape to cancel'
          : 'Preparing screenshot… · Escape to cancel'}
      </div>
    </div>
  );
}
