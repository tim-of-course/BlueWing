import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onSettled,
  Show,
} from 'solid-js';
import type { ModelView, ViewportPort } from '../app/wingman-types';
import type { ConstructionResult } from '../core/construction-types';
import {
  buildConstructionScene,
  constructionSceneInput,
  defaultCamera,
  orbitCamera,
  pickConstruction,
  renderConstruction,
  zoomCamera,
} from '../three/scene';
import type { ProjectedScene } from '../three/scene';
import './construction-view.css';

export interface ConstructionViewProps {
  result: ConstructionResult;
  onViewport?: (port: ViewportPort<ModelView>) => void;
  interactionDisabled?: boolean;
  presentationActive?: boolean;
  selectedGeometryIds: string[];
  onSelect: (geometryId: string, pieceId?: string) => void;
  levels?: readonly {
    id: string;
    name: string;
    geometryIds: readonly string[];
  }[];
  /** Optional host isolation; intersects with level, selection and material filters. */
  isolatedGeometryIds?: readonly string[];
  class?: string;
}

function lengthLabel(metres: number): string {
  const inches = Math.round((metres / 0.0254) * 16) / 16;
  const feet = Math.floor(inches / 12);
  return `${String(feet)} ft ${String(inches - feet * 12)} in (${metres.toFixed(3)} m)`;
}

export default function ConstructionView(props: ConstructionViewProps) {
  let canvas: HTMLCanvasElement | undefined;
  let projected: ProjectedScene | undefined;
  let drag:
    | { x: number; y: number; startX: number; startY: number; moved: boolean }
    | undefined;
  const [camera, setCamera] = createSignal(defaultCamera);
  const [viewport, setViewport] = createSignal({
    width: 640,
    height: 480,
    pixelRatio: 1,
  });
  const [presentation, setPresentation] = createSignal<ModelView | null>(null);
  const displayIds = () => props.selectedGeometryIds;
  const [material, setMaterial] = createSignal('');
  const [role, setRole] = createSignal('');
  const [levelId, setLevelId] = createSignal('');
  const [selectedOnly, setSelectedOnly] = createSignal(false);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const input = createMemo(() => constructionSceneInput(props.result));
  const materials = createMemo(() =>
    [
      ...new Set([
        ...input().members.map((piece) => piece.materialId),
        ...input().surfaces.map((surface) => surface.materialId),
      ]),
    ].sort(),
  );
  const roles = createMemo(() =>
    [
      ...new Set([
        ...input().members.map((piece) => piece.role),
        ...input().surfaces.map((surface) => surface.role),
      ]),
    ].sort(),
  );
  const isolatedIds = createMemo(() => {
    const isolated = props.presentationActive
      ? presentation()?.geometryIds
      : props.isolatedGeometryIds;
    if (!selectedOnly()) return isolated;
    if (!isolated) return displayIds();
    const ids = new Set(isolated);
    return displayIds().filter((id) => ids.has(id));
  });
  const scene = createMemo(
    () => {
      const geometryIds = isolatedIds();
      return buildConstructionScene(input(), {
        materialId: material(),
        role: role(),
        ...(geometryIds ? { geometryIds } : {}),
        ...(levelId()
          ? {
              levelGeometryIds:
                props.levels?.find((level) => level.id === levelId())
                  ?.geometryIds ?? [],
            }
          : {}),
      });
    },
    { name: 'construction.scene' },
  );
  const selected = createMemo(() => {
    if (!scene().faces.some((face) => face.source.id === selectedId()))
      return undefined;
    return (
      props.result.pieces.find((piece) => piece.id === selectedId()) ??
      props.result.surfaces.find((surface) => surface.id === selectedId())
    );
  });

  createEffect(
    () => ({
      scene: scene(),
      camera: camera(),
      viewport: viewport(),
      ids: displayIds(),
      selected: selectedId(),
    }),
    (state) => {
      const frame = requestAnimationFrame(() => {
        if (canvas)
          projected = renderConstruction(canvas, state.scene, {
            ...state.viewport,
            camera: state.camera,
            selectedGeometryIds: state.ids,
            selectedPieceId: state.selected,
          });
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    },
    { name: 'construction.render' },
  );
  onSettled(() => {
    props.onViewport?.({
      read: () => ({
        kind: '3d',
        camera: { ...camera() },
        ...((
          props.presentationActive
            ? presentation()?.geometryIds
            : props.isolatedGeometryIds
        )
          ? {
              geometryIds: [
                ...((props.presentationActive
                  ? presentation()?.geometryIds
                  : props.isolatedGeometryIds) ?? []),
              ],
            }
          : {}),
        levelId: levelId(),
        materialId: material(),
        role: role(),
        selectedOnly: selectedOnly(),
        selectedGeometryIds: [...displayIds()],
        selectedPieceId: selectedId(),
      }),
      apply(view) {
        setPresentation(view);
        setCamera({ ...view.camera });
        setMaterial(view.materialId ?? '');
        setRole(view.role ?? '');
        setLevelId(view.levelId ?? '');
        setSelectedOnly(view.selectedOnly ?? false);
        setSelectedId(view.selectedPieceId ?? null);
      },
    });
  });
  onSettled(() => {
    const element = canvas;
    if (!element) return;
    const resize = () => {
      const bounds = element.getBoundingClientRect();
      if (bounds.width > 0 && bounds.height > 0)
        setViewport({
          width: bounds.width,
          height: bounds.height,
          pixelRatio: window.devicePixelRatio || 1,
        });
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (props.interactionDisabled) return;
      setCamera((old) => zoomCamera(old, Math.exp(-event.deltaY * 0.001)));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
    };
  });
  function pick(x: number, y: number) {
    const hit = projected ? pickConstruction(projected, x, y) : null;
    setSelectedId(hit?.id ?? null);
    if (hit?.geometryId) props.onSelect(hit.geometryId, hit.id);
  }
  function reset() {
    setCamera({ ...defaultCamera });
  }
  function keydown(event: KeyboardEvent) {
    if (props.interactionDisabled) return;
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-12, 0],
      ArrowRight: [12, 0],
      ArrowUp: [0, -12],
      ArrowDown: [0, 12],
    };
    const step = steps[event.key];
    if (step) {
      event.preventDefault();
      setCamera((old) => orbitCamera(old, ...step));
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setCamera((old) => zoomCamera(old, 1.2));
    } else if (event.key === '-') {
      event.preventDefault();
      setCamera((old) => zoomCamera(old, 1 / 1.2));
    } else if (event.key === 'Home') {
      event.preventDefault();
      reset();
    }
  }
  return (
    <section
      class={['construction-view', props.class]}
      aria-label="3D construction viewer"
    >
      <div class="construction-toolbar">
        <strong>Construction · 3D</strong>
        <Show when={props.levels?.length}>
          <label>
            Level{' '}
            <select
              value={levelId()}
              onChange={(event) => setLevelId(event.currentTarget.value)}
            >
              <option value="">All levels</option>
              <For each={props.levels}>
                {(level) => <option value={level.id}>{level.name}</option>}
              </For>
            </select>
          </label>
        </Show>
        <label>
          Material{' '}
          <select
            value={material()}
            onChange={(event) => setMaterial(event.currentTarget.value)}
          >
            <option value="">All materials</option>
            <For each={materials()}>
              {(item) => <option value={item}>{item}</option>}
            </For>
          </select>
        </label>
        <label>
          Role{' '}
          <select
            value={role()}
            onChange={(event) => setRole(event.currentTarget.value)}
          >
            <option value="">All roles</option>
            <For each={roles()}>
              {(item) => <option value={item}>{item}</option>}
            </For>
          </select>
        </label>
        <label class="construction-check">
          <input
            type="checkbox"
            checked={selectedOnly()}
            onChange={(event) => setSelectedOnly(event.currentTarget.checked)}
          />
          Selected sources only
        </label>
        <button type="button" onClick={reset}>
          Reset / fit
        </button>
      </div>
      <div class="construction-viewport">
        <canvas
          ref={(element) => {
            canvas = element;
          }}
          tabindex="0"
          role="img"
          aria-label="Construction model. Drag to orbit; scroll to zoom. Arrow keys orbit, plus and minus zoom, Home resets. Click a member to select its source."
          onKeyDown={keydown}
          onPointerDown={(event) => {
            if (props.interactionDisabled || event.button !== 0) return;
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag = {
              x: event.clientX,
              y: event.clientY,
              startX: event.clientX,
              startY: event.clientY,
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            if (!drag) return;
            const dx = event.clientX - drag.x,
              dy = event.clientY - drag.y;
            drag.moved ||=
              Math.hypot(
                event.clientX - drag.startX,
                event.clientY - drag.startY,
              ) > 4;
            if (drag.moved) setCamera((old) => orbitCamera(old, dx, dy));
            drag.x = event.clientX;
            drag.y = event.clientY;
          }}
          onPointerUp={(event) => {
            if (!drag) return;
            if (!drag.moved) {
              const bounds = event.currentTarget.getBoundingClientRect();
              pick(event.clientX - bounds.left, event.clientY - bounds.top);
            }
            drag = undefined;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            drag = undefined;
          }}
          onLostPointerCapture={() => {
            drag = undefined;
          }}
        />
        <Show when={!scene().count}>
          <p class="construction-empty">
            No construction matches this view. Add construction to calibrated
            drawing objects or clear the filters.
          </p>
        </Show>
      </div>
      <div class="construction-status" aria-live="polite">
        <span>Section envelopes; framing shown through finishes.</span>
        <span>
          {scene().count.toLocaleString()} objects shown. Drag to orbit · Scroll
          to zoom
        </span>
        <Show when={scene().omitted}>
          <strong>
            {scene().omitted.toLocaleString()} objects omitted by the rendering
            limit. Filter by level, material, role, or selected source.
          </strong>
        </Show>
        <Show when={!props.result.complete}>
          <strong>
            Construction is incomplete. Review construction diagnostics before
            using quantities.
          </strong>
        </Show>
      </div>
      <Show when={selected()}>
        {(item) => (
          <aside
            class="construction-detail"
            aria-label="Selected construction item"
          >
            <strong>
              {item().materialId} ·{' '}
              {'role' in item() ? (item() as { role: string }).role : 'Surface'}
            </strong>
            <span>Piece: {item().id}</span>
            <span>
              Source: {item().geometryId ?? 'Unavailable'}
              {item().wallId ? ` · Wall: ${item().wallId ?? ''}` : ''}
              {item().openingId ? ` · Opening: ${item().openingId ?? ''}` : ''}
            </span>
            <span>
              {(() => {
                const value = item();
                return 'cutLength' in value
                  ? `Cut length: ${lengthLabel(value.cutLength)} · Stock length: ${value.stockLength === undefined ? 'unspecified' : lengthLabel(value.stockLength)} · Section ${(value.width * 1000).toFixed(1)} × ${(value.depth * 1000).toFixed(1)} mm. Purchase totals include waste and rounding.`
                  : `${value.face === 'ceiling' ? (value.quantityMode === 'included' ? 'Ceiling area estimate' : 'Ceiling reference extent (excluded from quantities)') : 'Finish net area'}: ${value.area.toFixed(3)} m² · ${String(value.layers)} layer(s)${value.thickness === undefined ? '' : ` · Total thickness ${(value.thickness * 1000).toFixed(1)} mm`}${value.face === 'ceiling' ? ' · No placed grid' : ''}`;
              })()}
            </span>
          </aside>
        )}
      </Show>
    </section>
  );
}
