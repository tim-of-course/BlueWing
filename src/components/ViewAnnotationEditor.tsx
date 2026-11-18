import { createEffect, createSignal, For, onSettled, Show } from 'solid-js';
import type { MessageView } from '../app/messaging';
import type { WorkspaceController } from '../app/contracts';
import type { RegionImages } from '../pdf/region-images';
import {
  annotationKinds,
  annotationName,
  validateAnnotationShape,
  type AnnotationKind,
  type AnnotationShape,
} from '../core/annotations';
import type { Point } from '../core/types';
import { paintViewAnnotations } from './canvas/annotations';
import WingmanPreview from './WingmanPreview';

export default function ViewAnnotationEditor(props: {
  view: MessageView;
  controller: WorkspaceController;
  planImages: RegionImages;
  onDone(view: MessageView): void;
  onCancel(): void;
}) {
  let dialog!: HTMLDialogElement;
  let overlay!: HTMLCanvasElement;
  const [base, setBase] = createSignal<HTMLCanvasElement | null>(null);
  const [kind, setKind] = createSignal<AnnotationKind>('arrow');
  const [marks, setMarks] = createSignal<AnnotationShape[]>([]);
  const [draft, setDraft] = createSignal<AnnotationShape | null>(null);
  const [anchor, setAnchor] = createSignal<Point | null>(null);
  const [text, setText] = createSignal('');
  let pointer: number | null = null;
  const [displayWidth, setDisplayWidth] = createSignal(1);
  onSettled(() => {
    dialog.showModal();
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width) setDisplayWidth(entry.contentRect.width);
    });
    observer.observe(overlay);
    return () => {
      observer.disconnect();
    };
  });
  createEffect(
    () => ({
      base: base(),
      shapes: marks(),
      draft: draft(),
      displayWidth: displayWidth(),
    }),
    (state) => {
      if (!state.base) return;
      overlay.width = state.base.width;
      overlay.height = state.base.height;
      const ctx = overlay.getContext('2d');
      if (ctx)
        paintViewAnnotations(
          ctx,
          state.draft ? [...state.shapes, state.draft] : state.shapes,
          overlay.width,
          overlay.height,
          overlay.width / state.displayWidth,
        );
    },
  );
  function point(event: PointerEvent): Point {
    const rect = overlay.getBoundingClientRect();
    const unit = (value: number) => Math.min(1, Math.max(0, value));
    return {
      x: unit((event.clientX - rect.left) / rect.width),
      y: unit((event.clientY - rect.top) / rect.height),
    };
  }
  function commitText() {
    const p = anchor();
    const content = text().trim();
    const shapes =
      p && content
        ? [...marks(), { kind: 'text' as const, points: [p], text: content }]
        : marks();
    setMarks(shapes);
    setText('');
    setAnchor(null);
    return shapes;
  }
  function start(event: PointerEvent) {
    if (!base() || event.button !== 0 || pointer !== null) return;
    const p = point(event);
    commitText();
    if (kind() === 'text') {
      setAnchor(p);
      return;
    }
    pointer = event.pointerId;
    overlay.setPointerCapture(pointer);
    setDraft({ kind: kind(), points: [p, p] });
  }
  function extend(event: PointerEvent) {
    const current = draft();
    const first = current?.points[0];
    if (event.pointerId !== pointer || !current || !first) return;
    const p = point(event);
    const shape = {
      ...current,
      points: current.kind === 'freehand' ? [...current.points, p] : [first, p],
    };
    setDraft(shape);
    return shape;
  }
  function finish(event: PointerEvent) {
    const shape = extend(event);
    if (!shape) return;
    pointer = null;
    setDraft(null);
    try {
      validateAnnotationShape(shape);
    } catch {
      return;
    }
    setMarks((items) => [...items, shape]);
  }
  function done() {
    const source = base();
    if (!source || pointer !== null) return;
    const annotations = commitText();
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(source, 0, 0);
    paintViewAnnotations(
      ctx,
      annotations,
      canvas.width,
      canvas.height,
      canvas.width / displayWidth(),
    );
    props.onDone({
      ...props.view,
      annotations,
      image: {
        id: crypto.randomUUID(),
        name: props.view.view.kind === '3d' ? '3D view' : 'Plan view',
        width: canvas.width,
        height: canvas.height,
        dataUrl: canvas.toDataURL('image/png'),
      },
    });
  }
  return (
    <dialog
      ref={dialog}
      class="view-editor"
      aria-label="Annotate view"
      onCancel={(event) => {
        event.preventDefault();
        props.onCancel();
      }}
    >
      <div
        class="view-editor-frame"
        style={{
          '--ratio': String(props.view.frame.width / props.view.frame.height),
        }}
      >
        <WingmanPreview
          view={props.view.view}
          takeoffId={props.view.takeoffId}
          frame={props.view.frame}
          controller={props.controller}
          planImages={props.planImages}
          maxDimension={1280}
          onReady={setBase}
        />
        <canvas
          ref={overlay}
          class="view-editor-ink"
          aria-label="View annotation surface"
          onPointerDown={start}
          onPointerMove={extend}
          onPointerUp={finish}
          onPointerCancel={() => {
            pointer = null;
            setDraft(null);
          }}
        />
        <Show when={anchor()}>
          {(p) => (
            <input
              class="view-editor-text"
              aria-label="Annotation text"
              ref={(el) => {
                queueMicrotask(() => {
                  el.focus();
                });
              }}
              style={{
                left: String(Math.min(75, p().x * 100)) + '%',
                top: String(Math.min(90, p().y * 100)) + '%',
              }}
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitText();
              }}
            />
          )}
        </Show>
      </div>
      <div class="view-editor-tools">
        <select
          aria-label="View annotation tool"
          value={kind()}
          onChange={(event) => {
            commitText();
            setKind(event.currentTarget.value as AnnotationKind);
          }}
        >
          <For each={annotationKinds}>
            {(item) => <option value={item}>{annotationName(item)}</option>}
          </For>
        </select>
        <button
          type="button"
          onClick={() => {
            props.onCancel();
          }}
        >
          Cancel
        </button>
        <button type="button" class="primary" disabled={!base()} onClick={done}>
          Done
        </button>
      </div>
    </dialog>
  );
}
