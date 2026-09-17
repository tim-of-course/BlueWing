import {
  createEffect,
  createMemo,
  createSignal,
  onSettled,
  Show,
  untrack,
} from 'solid-js';
import type { DrawingTool, WorkspaceController } from '../../app/contracts';
import type { Observation } from '../../app/application';
import type { Geometry, LengthUnit, Point, Sheet } from '../../core/types';
import { distance, hitTestGeometry } from '../../core/geometry';
import { paintTakeoff } from './paint';

/** Canvas-local CSS pixels = camera offset + page coordinates * zoom. */
interface Camera {
  x: number;
  y: number;
  zoom: number;
}
interface SheetView {
  camera: Camera;
  width: number;
  height: number;
}

function cameraForView(
  current: Sheet | undefined,
  size: { width: number; height: number },
  saved?: SheetView,
): Camera {
  if (saved)
    return {
      ...saved.camera,
      x: saved.camera.x + (size.width - saved.width) / 2,
      y: saved.camera.y + (size.height - saved.height) / 2,
    };
  if (!current) return { x: 0, y: 0, zoom: 1 };
  const zoom = Math.max(
    0.02,
    Math.min(
      (size.width - 64) / current.width,
      (size.height - 64) / current.height,
    ),
  );
  return {
    x: (size.width - current.width * zoom) / 2,
    y: (size.height - current.height * zoom) / 2,
    zoom,
  };
}
interface Draft {
  kind: Exclude<DrawingTool, 'select'>;
  points: Point[];
  sheetId: string;
  expected: Observation;
}
type Edit =
  | { kind: 'point'; geometry: Geometry; expected: Observation }
  | {
      kind: 'move';
      geometries: Geometry[];
      ids: string[];
      dx: number;
      dy: number;
      expected: Observation;
    };
type Gesture =
  | { kind: 'pan'; start: Point; camera: Camera }
  | { kind: 'select'; start: Point; previous: string[] }
  | {
      kind: 'point';
      start: Point;
      geometry: Geometry;
      index: number;
      expected: Observation;
    }
  | {
      kind: 'move';
      start: Point;
      geometries: Geometry[];
      ids: string[];
      expected: Observation;
    };

/** Rectangle selection intersects independent objects, without topology promotion. */
function intersectsSelection(
  geometry: Geometry,
  start: Point,
  end: Point,
): boolean {
  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const bottom = Math.max(start.y, end.y);
  if (
    geometry.points.some(
      (point) =>
        point.x >= left &&
        point.x <= right &&
        point.y >= top &&
        point.y <= bottom,
    )
  )
    return true;
  if (geometry.kind === 'count') return false;
  if (
    geometry.kind === 'area' &&
    hitTestGeometry(geometry, { x: left, y: top }, 0)
  )
    return true;
  for (
    let index = 0;
    index < geometry.points.length - (geometry.kind === 'path' ? 1 : 0);
    index++
  ) {
    const a = geometry.points[index];
    const b = geometry.points[(index + 1) % geometry.points.length];
    if (!a || !b) continue;
    let enter = 0;
    let exit = 1;
    for (const [origin, delta, min, max] of [
      [a.x, b.x - a.x, left, right],
      [a.y, b.y - a.y, top, bottom],
    ] as const) {
      if (delta === 0) {
        if (origin < min || origin > max) exit = -1;
      } else {
        const first = (min - origin) / delta;
        const last = (max - origin) / delta;
        enter = Math.max(enter, Math.min(first, last));
        exit = Math.min(exit, Math.max(first, last));
      }
    }
    if (enter <= exit) return true;
  }
  return false;
}

export default function DrawingCanvas(props: {
  controller: WorkspaceController;
  tool: DrawingTool;
  onError: (message: string) => void;
  onDraftChange?: (dirty: boolean) => void;
  interactionDisabled?: boolean;
}) {
  let canvas: HTMLCanvasElement | undefined;
  let container: HTMLDivElement | undefined;
  let gesture: Gesture | null = null;
  let savingNow = false;
  let spaceDown = false;
  const [panCursor, setPanCursor] = createSignal<'grab' | 'grabbing' | null>(
    null,
  );
  const [sheetViews, setSheetViews] = createSignal(
    new Map<string, SheetView>(),
    { name: 'canvas.sheetViews' },
  );
  let lastDrawingClick: { time: number; point: Point } | null = null;
  const [viewport, setViewport] = createSignal(
    { width: 1, height: 1, dpr: 1 },
    { name: 'canvas.viewport' },
  );
  const [image, setImage] = createSignal<HTMLCanvasElement | null>(null, {
    name: 'canvas.pdfImage',
  });
  const [loading, setLoading] = createSignal(false);
  const [renderError, setRenderError] = createSignal('');
  const [draft, setDraft] = createSignal<Draft | null>(null, {
    name: 'canvas.draft',
  });
  const [edit, setEdit] = createSignal<Edit | null>(null, {
    name: 'canvas.editPreview',
  });
  const [hover, setHover] = createSignal<Point | null>(null);
  const [snapped, setSnapped] = createSignal(false);
  const [selectionBox, setSelectionBox] = createSignal<{
    start: Point;
    end: Point;
  } | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [failure, setFailure] = createSignal('');
  const [length, setLength] = createSignal('');
  const [unit, setUnit] = createSignal<LengthUnit>('ft');
  const sheet = createMemo(
    () => {
      const id = props.controller.activeSheetId();
      return id ? props.controller.project()?.sheets[id] : undefined;
    },
    { name: 'canvas.activeSheet' },
  );
  const geometries = createMemo(
    () =>
      Object.values(props.controller.project()?.geometries ?? {}).filter(
        (item) => item.sheetId === sheet()?.id,
      ),
    { name: 'canvas.geometries' },
  );
  const renderSheet = createMemo(() => sheet(), {
    name: 'canvas.renderSheet',
    equals: (previous, next) =>
      previous?.id === next?.id &&
      previous?.assetId === next?.assetId &&
      previous?.pageIndex === next?.pageIndex &&
      previous?.width === next?.width &&
      previous?.height === next?.height &&
      previous?.rotation === next?.rotation,
  });
  const dirty = () => draft() !== null || edit() !== null;
  const viewKey = createMemo(
    () => {
      const current = renderSheet();
      return JSON.stringify([
        props.controller.project()?.id,
        current?.id,
        current?.width,
        current?.height,
        current?.rotation,
      ]);
    },
    { name: 'canvas.viewKey' },
  );
  // Camera is derived in the same flush as sheet/viewport changes, never relayed by an effect.
  const camera = createMemo(
    () => cameraForView(renderSheet(), viewport(), sheetViews().get(viewKey())),
    {
      name: 'canvas.camera',
      equals: (a, b) => a.x === b.x && a.y === b.y && a.zoom === b.zoom,
    },
  );
  function setCamera(next: Camera | ((old: Camera) => Camera)) {
    const { key, size, current } = untrack(() => ({
      key: viewKey(),
      size: viewport(),
      current: renderSheet(),
    }));
    if (!current) return;
    setSheetViews((old) =>
      new Map(old).set(key, {
        camera:
          typeof next === 'function'
            ? next(cameraForView(current, size, old.get(key)))
            : next,
        width: size.width,
        height: size.height,
      }),
    );
  }
  function fit() {
    setCamera(cameraForView(sheet(), viewport()));
  }
  function fitSelection() {
    const selected = new Set(props.controller.selection());
    const points = geometries()
      .filter((item) => selected.has(item.id))
      .flatMap((item) => item.points);
    if (!points.length) return;
    const left = Math.min(...points.map((point) => point.x));
    const right = Math.max(...points.map((point) => point.x));
    const top = Math.min(...points.map((point) => point.y));
    const bottom = Math.max(...points.map((point) => point.y));
    const size = viewport();
    const zoom = Math.max(
      0.02,
      Math.min(
        20,
        (size.width - 96) / Math.max(1, right - left),
        (size.height - 96) / Math.max(1, bottom - top),
      ),
    );
    setCamera({
      zoom,
      x: size.width / 2 - ((left + right) / 2) * zoom,
      y: size.height / 2 - ((top + bottom) / 2) * zoom,
    });
  }
  createEffect(
    () => ({ dirty: dirty(), notify: props.onDraftChange }),
    ({ dirty: value, notify }) => {
      notify?.(value);
    },
    { name: 'canvas.reportDraft' },
  );
  createEffect(
    () => ({
      current: renderSheet(),
      controller: props.controller,
      report: props.onError,
    }),
    ({ current, controller, report }) => {
      setImage(null);
      setRenderError('');
      if (!current) {
        setLoading(false);
        return;
      }
      let cancelled = false;
      setLoading(true);
      void controller
        .renderSheet(current, 3000)
        .then((rendered) => {
          if (!cancelled) {
            setImage(rendered);
            setLoading(false);
          }
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          const message =
            reason instanceof Error ? reason.message : String(reason);
          setRenderError(message);
          setLoading(false);
          report(message);
        });
      return () => {
        cancelled = true;
      };
    },
    { name: 'canvas.loadPdf' },
  );
  createEffect(
    () => ({
      size: viewport(),
      camera: camera(),
      sheet: sheet(),
      image: image(),
      geometries: geometries(),
      selected: props.controller.selection(),
      groups: props.controller.project()?.groups,
      draft: draft(),
      edit: edit(),
      hover: hover(),
      snapped: snapped(),
      selectionBox: selectionBox(),
    }),
    (state) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      canvas.width = Math.round(state.size.width * state.size.dpr);
      canvas.height = Math.round(state.size.height * state.size.dpr);
      ctx.setTransform(state.size.dpr, 0, 0, state.size.dpr, 0, 0);
      ctx.fillStyle = '#0f1218';
      ctx.fillRect(0, 0, state.size.width, state.size.height);
      if (!state.sheet) return;
      ctx.translate(state.camera.x, state.camera.y);
      ctx.scale(state.camera.zoom, state.camera.zoom);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, state.sheet.width, state.sheet.height);
      if (state.image)
        ctx.drawImage(state.image, 0, 0, state.sheet.width, state.sheet.height);
      const pixel = 1 / state.camera.zoom;
      const colors: Record<string, string> = {};
      for (const group of Object.values(state.groups ?? {}))
        for (const id of group.geometryIds)
          colors[id] = group.color ?? '#3b82f6';
      let displayed = state.geometries;
      if (state.edit?.kind === 'point') {
        const edited = state.edit.geometry;
        displayed = displayed.map((item) =>
          item.id === edited.id ? edited : item,
        );
      } else if (state.edit?.kind === 'move') {
        const moved = new Map(
          state.edit.geometries.map((item) => [item.id, item]),
        );
        displayed = displayed.map((item) => moved.get(item.id) ?? item);
      }
      paintTakeoff(ctx, displayed, {
        selectedIds: state.selected,
        colors,
        unitsPerPixel: pixel,
      });
      for (const geometry of displayed) {
        if (!state.selected.includes(geometry.id)) continue;
        for (const point of geometry.points) {
          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#3b82f6';
          ctx.lineWidth = pixel;
          ctx.fillRect(
            point.x - 3 * pixel,
            point.y - 3 * pixel,
            6 * pixel,
            6 * pixel,
          );
          ctx.strokeRect(
            point.x - 3 * pixel,
            point.y - 3 * pixel,
            6 * pixel,
            6 * pixel,
          );
        }
      }
      if (state.draft?.sheetId === state.sheet.id) {
        const points = [...state.draft.points];
        if (
          state.hover &&
          state.draft.kind !== 'count' &&
          !(state.draft.kind === 'calibrate' && points.length === 2)
        )
          points.push(state.hover);
        ctx.save();
        ctx.setLineDash([5 * pixel, 4 * pixel]);
        paintTakeoff(
          ctx,
          [
            {
              id: 'draft',
              name: '',
              sheetId: state.sheet.id,
              kind:
                state.draft.kind === 'calibrate' ? 'path' : state.draft.kind,
              points,
            },
          ],
          { colors: { draft: '#6366f1' }, unitsPerPixel: pixel },
        );
        ctx.restore();
        for (const point of state.draft.points) {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 3 * pixel, 0, Math.PI * 2);
          ctx.fillStyle = '#6366f1';
          ctx.fill();
        }
      }
      if (state.hover && state.snapped) {
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = pixel;
        ctx.strokeRect(
          state.hover.x - 5 * pixel,
          state.hover.y - 5 * pixel,
          10 * pixel,
          10 * pixel,
        );
      }
      if (state.selectionBox) {
        const { start, end } = state.selectionBox;
        ctx.fillStyle = '#3b82f622';
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = pixel;
        ctx.setLineDash([5 * pixel, 3 * pixel]);
        ctx.fillRect(start.x, start.y, end.x - start.x, end.y - start.y);
        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      }
    },
    { name: 'canvas.paintScene' },
  );

  function localPoint(event: { clientX: number; clientY: number }): Point {
    const bounds = canvas?.getBoundingClientRect();
    return {
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
    };
  }
  function pagePoint(event: { clientX: number; clientY: number }): Point {
    const point = localPoint(event);
    const current = camera();
    return {
      x: (point.x - current.x) / current.zoom,
      y: (point.y - current.y) / current.zoom,
    };
  }
  function snap(point: Point, bypass: boolean, omitId?: string): Point {
    if (bypass) {
      setSnapped(false);
      return point;
    }
    let nearest = 9 / camera().zoom;
    let result = point;
    for (const geometry of geometries()) {
      if (geometry.id === omitId) continue;
      for (const endpoint of geometry.points) {
        const separation = distance(point, endpoint);
        if (separation < nearest) {
          nearest = separation;
          result = endpoint;
        }
      }
    }
    const currentDraft = draft();
    const previous =
      currentDraft?.kind !== 'count' ? currentDraft?.points.at(-1) : undefined;
    if (result === point && previous && !omitId) {
      const angle = Math.atan2(point.y - previous.y, point.x - previous.x);
      const target = (Math.round(angle / (Math.PI / 4)) * Math.PI) / 4;
      if (Math.abs(angle - target) <= Math.PI / 60) {
        const length = distance(previous, point);
        result = {
          x: previous.x + length * Math.cos(target),
          y: previous.y + length * Math.sin(target),
        };
      }
    }
    setSnapped(result !== point);
    return { ...result };
  }
  function cancel() {
    if (savingNow) return;
    gesture = null;
    lastDrawingClick = null;
    setDraft(null);
    setEdit(null);
    setSelectionBox(null);
    setHover(null);
    setSnapped(false);
    setFailure('');
    setLength('');
  }
  async function commit() {
    if (savingNow || props.interactionDisabled) return;
    const currentDraft = draft();
    const currentEdit = edit();
    if (!currentDraft && !currentEdit) return;
    const controller = props.controller;
    const report = props.onError;
    if (currentDraft) {
      const minimum =
        currentDraft.kind === 'area'
          ? 3
          : currentDraft.kind === 'count'
            ? 1
            : 2;
      if (currentDraft.points.length < minimum) {
        setFailure(`Add at least ${String(minimum)} points.`);
        return;
      }
      if (currentDraft.kind === 'calibrate' && !(Number(length()) > 0)) {
        setFailure('Enter a positive known length.');
        return;
      }
    }
    savingNow = true;
    setSaving(true);
    setFailure('');
    try {
      if (currentEdit?.kind === 'point')
        await controller.updateGeometry(
          currentEdit.geometry.id,
          { points: currentEdit.geometry.points },
          currentEdit.expected,
        );
      else if (currentEdit?.kind === 'move') {
        controller.setSelection(currentEdit.ids);
        await Promise.resolve();
        await controller.moveSelection(
          currentEdit.dx,
          currentEdit.dy,
          currentEdit.expected,
        );
      } else if (currentDraft) {
        if (currentDraft.kind === 'calibrate') {
          const from = currentDraft.points[0];
          const to = currentDraft.points[1];
          if (from && to)
            await controller.calibrate(
              currentDraft.sheetId,
              from,
              to,
              Number(length()),
              unit(),
              currentDraft.expected,
            );
        } else
          await controller.addGeometry(
            currentDraft.kind,
            currentDraft.points,
            undefined,
            currentDraft.expected,
          );
      }
      setDraft(null);
      lastDrawingClick = null;
      setEdit(null);
      setHover(null);
      setLength('');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setFailure(message);
      report(message);
    } finally {
      savingNow = false;
      setSaving(false);
    }
  }
  function pointerDown(event: PointerEvent) {
    if (savingNow || !sheet()) return;
    if (gesture) return;
    if (event.button === 1 || (event.button === 0 && spaceDown)) {
      event.preventDefault();
      canvas?.focus({ preventScroll: true });
      setPanCursor('grabbing');
      setHover(null);
      setSnapped(false);
      gesture = { kind: 'pan', start: localPoint(event), camera: camera() };
      canvas?.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || edit() || props.interactionDisabled) return;
    canvas?.focus();
    const current = sheet();
    if (!current) return;
    const point = pagePoint(event);
    if (props.tool !== 'select') {
      if (
        point.x < 0 ||
        point.y < 0 ||
        point.x > current.width ||
        point.y > current.height
      )
        return;
      const previous = draft();
      if (previous?.kind === 'calibrate' && previous.points.length === 2)
        return;
      const next = snap(point, event.shiftKey);
      if (event.detail > 1 && previous?.kind !== 'count') return;
      if (
        previous &&
        previous.kind !== 'count' &&
        lastDrawingClick &&
        event.timeStamp - lastDrawingClick.time < 500 &&
        distance(point, lastDrawingClick.point) * camera().zoom < 4
      )
        return;
      if (
        previous?.points.length &&
        distance(previous.points[previous.points.length - 1] ?? next, next) <
          0.01
      )
        return;
      lastDrawingClick = { time: event.timeStamp, point };
      setDraft(
        previous
          ? { ...previous, points: [...previous.points, next] }
          : {
              kind: props.tool,
              points: [next],
              sheetId: current.id,
              expected: props.controller.observe(),
            },
      );
      setFailure('');
      return;
    }
    props.controller.setActiveGroupId(null);
    const selected = props.controller.selection();
    for (const geometry of geometries().filter((item) =>
      selected.includes(item.id),
    )) {
      const index = geometry.points.findIndex(
        (endpoint) => distance(point, endpoint) <= 7 / camera().zoom,
      );
      if (index !== -1 && !event.shiftKey && !event.altKey) {
        gesture = {
          kind: 'point',
          start: point,
          geometry,
          index,
          expected: props.controller.observe(),
        };
        canvas?.setPointerCapture(event.pointerId);
        return;
      }
    }
    const hit = [...geometries()]
      .reverse()
      .find((item) => hitTestGeometry(item, point, 7 / camera().zoom));
    if (!hit) {
      if (!event.shiftKey) props.controller.setSelection([]);
      gesture = {
        kind: 'select',
        start: point,
        previous: event.shiftKey ? selected : [],
      };
      canvas?.setPointerCapture(event.pointerId);
      return;
    }
    const ids = event.shiftKey
      ? selected.includes(hit.id)
        ? selected.filter((id) => id !== hit.id)
        : [...selected, hit.id]
      : selected.includes(hit.id)
        ? selected
        : [hit.id];
    props.controller.setSelection(ids);
    if (event.shiftKey) return;
    gesture = {
      kind: 'move',
      start: point,
      geometries: geometries().filter((item) => ids.includes(item.id)),
      ids,
      expected: props.controller.observe(),
    };
    canvas?.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    if (savingNow) return;
    const point = pagePoint(event);
    if (gesture?.kind === 'pan') {
      const local = localPoint(event);
      setCamera({
        ...gesture.camera,
        x: gesture.camera.x + local.x - gesture.start.x,
        y: gesture.camera.y + local.y - gesture.start.y,
      });
      return;
    }
    if (gesture?.kind === 'point') {
      if (distance(point, gesture.start) * camera().zoom < 2 && !edit()) return;
      const next = snap(point, event.shiftKey, gesture.geometry.id);
      setEdit({
        kind: 'point',
        geometry: {
          ...gesture.geometry,
          points: gesture.geometry.points.map((old, index) =>
            index === (gesture?.kind === 'point' ? gesture.index : -1)
              ? next
              : old,
          ),
        },
        expected: gesture.expected,
      });
      return;
    }
    if (gesture?.kind === 'select') {
      if (distance(point, gesture.start) * camera().zoom >= 3)
        setSelectionBox({ start: gesture.start, end: point });
      return;
    }
    if (gesture?.kind === 'move') {
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      if (Math.hypot(dx, dy) * camera().zoom < 2 && !edit()) return;
      setEdit({
        kind: 'move',
        geometries: gesture.geometries.map((item) => ({
          ...item,
          points: item.points.map((old) => ({ x: old.x + dx, y: old.y + dy })),
        })),
        ids: gesture.ids,
        dx,
        dy,
        expected: gesture.expected,
      });
      return;
    }
    if (props.tool !== 'select') setHover(snap(point, event.shiftKey));
  }
  function pointerUp(event: PointerEvent) {
    const completed = gesture;
    gesture = null;
    setPanCursor(spaceDown ? 'grab' : null);
    if (canvas?.hasPointerCapture(event.pointerId))
      canvas.releasePointerCapture(event.pointerId);
    if (completed?.kind === 'select') {
      const end = pagePoint(event);
      if (distance(end, completed.start) * camera().zoom >= 3)
        props.controller.setSelection([
          ...new Set([
            ...completed.previous,
            ...geometries()
              .filter((item) => intersectsSelection(item, completed.start, end))
              .map((item) => item.id),
          ]),
        ]);
      setSelectionBox(null);
    } else if (completed && completed.kind !== 'pan' && edit()) void commit();
  }
  function cancelGesture() {
    if (gesture && gesture.kind !== 'pan') setEdit(null);
    gesture = null;
    setSelectionBox(null);
    setHover(null);
    setSnapped(false);
    setPanCursor(spaceDown ? 'grab' : null);
  }
  function zoomAt(factor: number, center: Point) {
    setCamera((old) => {
      const zoom = Math.min(20, Math.max(0.02, old.zoom * factor));
      return {
        zoom,
        x: center.x - ((center.x - old.x) * zoom) / old.zoom,
        y: center.y - ((center.y - old.y) * zoom) / old.zoom,
      };
    });
  }
  onSettled(() => {
    const element = container;
    if (!element) return;
    const resize = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width <= 1 || bounds.height <= 1) {
        spaceDown = false;
        cancelGesture();
        return;
      }
      untrack(() => {
        // Remember the old center before committing both resize inputs together.
        const previous = viewport();
        if (previous.width > 1 && previous.height > 1) setCamera(camera());
        setViewport({
          width: bounds.width,
          height: bounds.height,
          dpr: window.devicePixelRatio || 1,
        });
      });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const keydown = (event: KeyboardEvent) => {
      if (!canvas?.getClientRects().length) return;
      if (
        document.querySelector('[role="dialog"]') ||
        (event.target instanceof Element &&
          event.target.closest(
            'input,textarea,select,[contenteditable="true"]',
          ))
      )
        return;
      if ((event.metaKey || event.ctrlKey) && event.key === '0') {
        event.preventDefault();
        fit();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === '1') {
        event.preventDefault();
        zoomAt(1 / camera().zoom, {
          x: viewport().width / 2,
          y: viewport().height / 2,
        });
      }
      if (event.code === 'Space') {
        if (
          event.target instanceof Element &&
          event.target.closest('button,a,[role="button"]')
        )
          return;
        event.preventDefault();
        spaceDown = true;
        if (gesture?.kind !== 'pan') setPanCursor('grab');
      }
      if (event.key === 'Escape') {
        if (props.interactionDisabled && !dirty()) return;
        event.preventDefault();
        if (dirty() || gesture) cancel();
        else props.controller.setSelection([]);
        setPanCursor(spaceDown ? 'grab' : null);
      }
      if (event.key === 'Enter' && dirty()) {
        event.preventDefault();
        void commit();
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceDown = false;
        if (gesture?.kind !== 'pan') setPanCursor(null);
      }
    };
    const blur = () => {
      spaceDown = false;
      cancelGesture();
    };
    const wheel = (event: WheelEvent) => {
      if (!sheet()) return;
      event.preventDefault();
      if (gesture) return;
      const pixels =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport().height
            : 1);
      zoomAt(
        Math.exp(-pixels * (event.ctrlKey || event.metaKey ? 0.008 : 0.002)),
        localPoint(event),
      );
      setHover(null);
      setSnapped(false);
    };
    const surface = canvas;
    surface?.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    return () => {
      observer.disconnect();
      surface?.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  });
  return (
    <div
      class="drawing-canvas"
      ref={(element) => {
        container = element;
      }}
      style={{
        position: 'relative',
        flex: '1',
        'min-height': '0',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={(element) => {
          canvas = element;
        }}
        aria-label="Drawing canvas"
        data-camera-x={camera().x}
        data-camera-y={camera().y}
        data-camera-zoom={camera().zoom}
        data-sheet-id={sheet()?.id}
        tabindex={0}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          'touch-action': 'none',
          cursor:
            panCursor() ?? (props.tool === 'select' ? 'default' : 'crosshair'),
        }}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={cancelGesture}
        onLostPointerCapture={cancelGesture}
        onPointerLeave={() => {
          if (!gesture) {
            setHover(null);
            setSnapped(false);
          }
        }}
        onDblClick={() => {
          if (draft()?.kind === 'path' || draft()?.kind === 'area')
            void commit();
        }}
      >
        Draw and edit sheet measurements using the drawing tools.
      </canvas>
      <Show when={!sheet()}>
        <div
          style={{
            position: 'absolute',
            inset: '0',
            display: 'grid',
            'place-content': 'center',
            'text-align': 'center',
            'pointer-events': 'none',
          }}
        >
          <h2>Import a PDF to begin</h2>
          <p>Choose Import PDF in the Sheets panel.</p>
        </div>
      </Show>
      <Show when={sheet()}>
        <div
          class="button-row"
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            background: '#161b24',
            padding: '6px',
            'border-radius': '5px',
          }}
        >
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              zoomAt(0.8, {
                x: viewport().width / 2,
                y: viewport().height / 2,
              });
            }}
          >
            −
          </button>
          <span>{Math.round(camera().zoom * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              zoomAt(1.25, {
                x: viewport().width / 2,
                y: viewport().height / 2,
              });
            }}
          >
            +
          </button>
          <button type="button" onClick={fit}>
            Fit
          </button>
          <button
            type="button"
            onClick={fitSelection}
            disabled={
              !geometries().some((item) =>
                props.controller.selection().includes(item.id),
              )
            }
          >
            Fit selection
          </button>
        </div>
        <p
          style={{
            position: 'absolute',
            bottom: '0',
            left: '12px',
            padding: '5px 8px',
            background: '#161b24dd',
            'pointer-events': 'none',
            'font-size': '11px',
          }}
        >
          Scroll to zoom · Space / middle-drag to pan · Drag to select or move ·
          Shift disables snapping
        </p>
      </Show>
      <Show when={loading() || renderError()}>
        <p
          role="status"
          style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            padding: '8px',
            background: '#161b24',
          }}
        >
          {loading() ? 'Rendering PDF…' : renderError()}
        </p>
      </Show>
      <Show when={dirty()}>
        <div
          class="stack"
          style={{
            position: 'absolute',
            left: '12px',
            top: '12px',
            padding: '12px',
            background: '#161b24',
            border: '1px solid #364256',
            'border-radius': '6px',
            'max-width': '340px',
          }}
        >
          <Show
            when={draft()?.kind === 'calibrate' && draft()?.points.length === 2}
          >
            <form
              class="button-row"
              onSubmit={(event) => {
                event.preventDefault();
                void commit();
              }}
            >
              <label class="field">
                Known length
                <input
                  aria-label="Known length"
                  type="number"
                  min="0"
                  step="any"
                  value={length()}
                  onInput={(event) => setLength(event.currentTarget.value)}
                />
              </label>
              <label class="field">
                Unit
                <select
                  aria-label="Calibration unit"
                  value={unit()}
                  onChange={(event) =>
                    setUnit(event.currentTarget.value as LengthUnit)
                  }
                >
                  <option value="ft">ft</option>
                  <option value="in">in</option>
                  <option value="m">m</option>
                  <option value="mm">mm</option>
                </select>
              </label>
              <button class="primary" type="submit" disabled={saving()}>
                Set scale
              </button>
            </form>
          </Show>
          <Show when={draft()?.kind !== 'calibrate'}>
            <span>
              {edit()
                ? 'Point / selection edit'
                : `${String(draft()?.points.length ?? 0)} points · Enter to finish`}
            </span>
          </Show>
          <Show
            when={draft()?.kind === 'calibrate' && draft()?.points.length !== 2}
          >
            <span>Click the second calibration point.</span>
          </Show>
          <Show when={failure()}>
            <p role="alert" style={{ color: '#fca5a5', margin: '0' }}>
              {failure()}
            </p>
          </Show>
          <div class="button-row">
            <Show when={draft()?.kind !== 'calibrate' || edit()}>
              <button
                type="button"
                class="primary"
                disabled={saving()}
                onClick={() => {
                  void commit();
                }}
              >
                {saving() ? 'Saving…' : failure() ? 'Retry save' : 'Finish'}
              </button>
            </Show>
            <button type="button" disabled={saving()} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
