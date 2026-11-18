import { createMemo, createSignal } from 'solid-js';
import type { WorkspaceController } from '../../app/contracts';
import type { Observation } from '../../app/application';
import type {
  AnnotationKind,
  AnnotationShape,
  SheetAnnotation,
} from '../../core/annotations';
import type { Point, Sheet } from '../../core/types';
import { annotationHandles, hitsAnnotation } from './annotations';

type Choice = AnnotationKind | 'edit';
interface Drag {
  start: Point;
  original: AnnotationShape;
  shape: AnnotationShape;
  id?: string;
  handle: number;
  expected: Observation;
  sheet: Sheet;
}
interface TextEdit {
  id?: string;
  sheetId: string;
  anchor: Point;
  text: string;
  expected: Observation;
}

export function createAnnotationEditor(options: {
  controller: () => WorkspaceController;
  sheet: () => Sheet | undefined;
  choice: () => Choice;
  pixel: () => number;
  context: () => CanvasRenderingContext2D | null | undefined;
  created: () => void;
  error: (message: string) => void;
}) {
  const { controller } = options;
  const [selectedId, select] = createSignal<string | null>(null);
  const [preview, setPreview] = createSignal<AnnotationShape | null>(null);
  const [textEdit, setTextEdit] = createSignal<TextEdit | null>(null);
  const annotations = createMemo(() =>
    controller().annotationsVisible()
      ? Object.values(controller().project()?.annotations ?? {}).filter(
          (a) => a.sheetId === options.sheet()?.id,
        )
      : [],
  );
  const selected = () => annotations().find((a) => a.id === selectedId());
  let drag: Drag | undefined;
  let saving = false;
  function cancel() {
    drag = undefined;
    setPreview(null);
    setTextEdit(null);
  }
  function editText(record = selected()) {
    if (!record?.points[0] || record.kind !== 'text' || saving) return;
    setTextEdit({
      id: record.id,
      sheetId: record.sheetId,
      anchor: record.points[0],
      text: record.text ?? '',
      expected: controller().observe(),
    });
  }
  async function save(
    id: string | undefined,
    sheetId: string,
    shape: AnnotationShape,
    expected: Observation,
  ) {
    if (saving) return;
    saving = true;
    try {
      const record = (await controller().execute(
        id
          ? {
              name: 'annotation.update',
              payload: {
                id,
                points: shape.points,
                ...(shape.kind === 'text' ? { text: shape.text } : {}),
              },
            }
          : { name: 'annotation.add', payload: { sheetId, ...shape } },
        expected,
      )) as SheetAnnotation;
      select(record.id);
      if (!id) options.created();
      setTextEdit(null);
    } catch (error) {
      options.error(error instanceof Error ? error.message : String(error));
    } finally {
      saving = false;
    }
  }
  function down(p: Point) {
    const sheet = options.sheet(),
      ctx = options.context();
    if (
      !sheet ||
      !ctx ||
      !controller().annotationsVisible() ||
      textEdit() ||
      saving ||
      drag
    )
      return false;
    const choice = options.choice(),
      pixel = options.pixel();
    const expected = controller().observe();
    if (choice === 'edit') {
      const previous = selected();
      const handle = previous
        ? annotationHandles(previous).findIndex(
            (h) => Math.hypot(h.x - p.x, h.y - p.y) <= 7 * pixel,
          )
        : -1;
      const record =
        handle >= 0
          ? previous
          : [...annotations()]
              .reverse()
              .find((a) => hitsAnnotation(ctx, a, p, pixel));
      select(record?.id ?? null);
      if (!record) return false;
      drag = {
        start: p,
        original: record,
        shape: record,
        id: record.id,
        handle,
        expected,
        sheet,
      };
    } else {
      if (p.x < 0 || p.y < 0 || p.x > sheet.width || p.y > sheet.height)
        return false;
      select(null);
      if (choice === 'text') {
        setTextEdit({ anchor: p, sheetId: sheet.id, text: '', expected });
        return false;
      }
      const shape = {
        kind: choice,
        points: choice === 'freehand' ? [p] : [p, p],
      };
      drag = { start: p, original: shape, shape, handle: -1, expected, sheet };
      setPreview(shape);
    }
    return true;
  }
  function move(p: Point) {
    if (!drag) return;
    const { start, original, handle, sheet } = drag;
    const dx = p.x - start.x,
      dy = p.y - start.y;
    let points: Point[];
    if (!drag.id) {
      const end = {
        x: Math.max(0, Math.min(sheet.width, p.x)),
        y: Math.max(0, Math.min(sheet.height, p.y)),
      };
      if (original.kind === 'freehand') {
        const last = drag.shape.points.at(-1) ?? start;
        if (Math.hypot(last.x - end.x, last.y - end.y) < options.pixel())
          return;
        points = [...drag.shape.points, end];
      } else points = [start, end];
    } else {
      if (Math.hypot(dx, dy) < 2 * options.pixel() && drag.shape === original)
        return;
      if (handle < 0)
        points = original.points.map((a) => ({ x: a.x + dx, y: a.y + dy }));
      else {
        const handles = annotationHandles(original);
        if (handles.length === 2)
          points = original.points.map((v, i) => (i === handle ? p : v));
        else {
          const opposite = handles[(handle + 2) % 4];
          if (!opposite) return;
          points = [p, opposite];
        }
      }
    }
    drag.shape = { ...original, points };
    setPreview(drag.shape);
  }
  function up(p: Point) {
    if (!drag) return;
    move(p);
    const { start, shape, original, id, expected, sheet } = drag;
    drag = undefined;
    setPreview(null);
    if (id && original === shape) return;
    if (
      !id &&
      shape.kind !== 'freehand' &&
      Math.hypot(p.x - start.x, p.y - start.y) < 2 * options.pixel()
    )
      return;
    if (!id && shape.kind === 'freehand' && shape.points.length < 2) return;
    void save(id, sheet.id, shape, expected);
  }
  async function remove() {
    const record = selected();
    if (!record || saving || drag || textEdit()) return;
    saving = true;
    try {
      await controller().execute(
        { name: 'annotation.delete', payload: { id: record.id } },
        controller().observe(),
      );
      select(null);
    } catch (error) {
      options.error(error instanceof Error ? error.message : String(error));
    } finally {
      saving = false;
    }
  }
  return {
    annotations,
    selectedId,
    select,
    preview,
    textEdit,
    cancel,
    editText,
    down,
    move,
    up,
    remove,
    dragging: () => !!drag,
    changeText(value: string) {
      setTextEdit((edit) => edit && { ...edit, text: value });
    },
    saveText() {
      const edit = textEdit();
      if (edit?.text.trim())
        void save(
          edit.id,
          edit.sheetId,
          { kind: 'text', points: [edit.anchor], text: edit.text },
          edit.expected,
        );
    },
  };
}
