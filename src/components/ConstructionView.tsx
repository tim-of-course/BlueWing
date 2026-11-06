import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onSettled,
  Show,
} from 'solid-js';
import type { ModelView, ViewportPort } from '../app/wingman-types';
import type { WorkspaceController } from '../app/contracts';
import type { ConstructionSnapshot } from '../core/calculation-state';
import type { SheetPlacement } from '../core/construction-types';
import type { Sheet } from '../core/types';
import type { RasterLease } from '../pdf/raster';
import { PAGE_PREVIEW_DIMENSION, pageImageDimension } from '../pdf/page-images';
import {
  buildConstructionScene,
  constructionSceneInput,
  defaultCamera,
  fitCamera,
  orbitCamera,
  sheetPlanCorners,
  viewPresets,
  zoomCamera,
} from '../three/scene';
import type { DisplayMode, ViewPreset } from '../three/scene';
import type { createConstructionRenderer } from '../three/renderer';
import './construction-view.css';
import CategoryFilter from './CategoryFilter';
import { categoryContext } from '../core/categories';

type ConstructionRenderer = ReturnType<typeof createConstructionRenderer>;
const viewOptions: readonly { value: ViewPreset; label: string }[] = [
  { value: 'isometric', label: 'Isometric' },
  { value: 'top', label: 'Top' },
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

export interface ConstructionViewProps {
  result: ConstructionSnapshot;
  controller: WorkspaceController;
  sheet: Sheet | undefined;
  placement: SheetPlacement | undefined;
  showPlan: boolean;
  onShowPlanChange: (show: boolean) => void;
  estimateOutputs?: number;
  onViewport?: (port: ViewportPort<ModelView>) => void;
  interactionDisabled?: boolean;
  presentationActive?: boolean;
  selectedGeometryIds: string[];
  onSelect: (geometryId: string, pieceId?: string) => void;
  levels?: readonly {
    id: string;
    name: string;
    elevation: number;
    sheetIds: readonly string[];
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
  const [renderer, setRenderer] = createSignal<ConstructionRenderer | null>(
    null,
  );
  const [rendererStatus, setRendererStatus] =
    createSignal('Loading 3D viewer…');
  const [displayMode, setDisplayMode] = createSignal<DisplayMode>('solid');
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
  const [planImage, setPlanImage] = createSignal<{
    image: ImageBitmap;
    request: { sheet: Sheet };
  } | null>(null);
  const imageRequest = createMemo(
    () =>
      props.showPlan && props.sheet?.calibration
        ? { sheet: props.sheet }
        : undefined,
    {
      equals: (a, b) =>
        a === b ||
        (!!a &&
          !!b &&
          a.sheet.id === b.sheet.id &&
          a.sheet.assetId === b.sheet.assetId &&
          a.sheet.pageIndex === b.sheet.pageIndex &&
          a.sheet.width === b.sheet.width &&
          a.sheet.height === b.sheet.height &&
          a.sheet.rotation === b.sheet.rotation),
    },
  );
  const plan = createMemo(() => {
    const loaded = planImage();
    const sheet = props.showPlan ? props.sheet : undefined;
    if (!loaded || loaded.request !== imageRequest() || !sheet)
      return undefined;
    const matching =
      props.levels?.filter((level) => level.sheetIds.includes(sheet.id)) ?? [];
    const level =
      props.levels?.find((item) => item.id === levelId()) ??
      (matching.length === 1 ? matching[0] : undefined);
    const corners = sheetPlanCorners(sheet, props.placement, level?.elevation);
    return corners ? { image: loaded.image, corners } : undefined;
  });
  const [selectedOnly, setSelectedOnly] = createSignal(false);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const scopeContext = createMemo(
    () => {
      const project = props.controller.project();
      return project ? categoryContext(project) : undefined;
    },
    {
      name: 'construction.categoryContext',
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    },
  );
  const input = createMemo(() =>
    constructionSceneInput(props.result, scopeContext()),
  );
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
  const levelGeometryIds = createMemo(
    () =>
      levelId()
        ? (props.levels?.find((level) => level.id === levelId())?.geometryIds ??
          [])
        : undefined,
    {
      equals: (a, b) =>
        a === b ||
        (!!a &&
          !!b &&
          a.length === b.length &&
          a.every((id, index) => id === b[index])),
    },
  );
  const scene = createMemo(
    () => {
      const geometryIds = isolatedIds();
      const levelIds = levelGeometryIds();
      return buildConstructionScene(input(), {
        categories: props.controller.categoryFilter(),
        materialId: material(),
        role: role(),
        ...(geometryIds ? { geometryIds } : {}),
        ...(levelIds ? { levelGeometryIds: levelIds } : {}),
      });
    },
    { name: 'construction.scene' },
  );
  const selected = createMemo(() => {
    if (
      !scene().members.some((member) => member.id === selectedId()) &&
      (displayMode() === 'framing' ||
        !scene().surfaces.some((surface) => surface.id === selectedId()))
    )
      return undefined;
    return (
      props.result.pieces.find((piece) => piece.id === selectedId()) ??
      props.result.surfaces.find((surface) => surface.id === selectedId())
    );
  });

  // Fit only visible materials, while the renderer retains shared buffers when
  // toggling finishes on and off.
  const fittingScene = createMemo(() =>
    displayMode() === 'framing'
      ? buildConstructionScene({ members: scene().members, surfaces: [] })
      : scene(),
  );
  const visibleCount = createMemo(
    () =>
      scene().members.length +
      (displayMode() === 'framing' ? 0 : scene().surfaces.length),
  );
  const preset = createMemo(() => {
    const current = camera();
    return (
      viewOptions.find(({ value }) => {
        const view = viewPresets[value];
        return (
          Math.abs(Math.sin((current.yaw - view.yaw) / 2)) < 1e-6 &&
          Math.abs(current.pitch - view.pitch) < 1e-6
        );
      })?.value ?? ''
    );
  });

  onSettled(() => {
    const element = canvas;
    if (!element) return;
    let cancelled = false;
    let active: ConstructionRenderer | undefined;
    void import('../three/renderer')
      .then(({ createConstructionRenderer }) => {
        if (cancelled) return;
        active = createConstructionRenderer(element, {
          onCameraChange: (value) => setCamera(value),
          onSelect: (source) => {
            setSelectedId(source?.id ?? null);
            if (source?.geometryId)
              props.onSelect(source.geometryId, source.id);
          },
        });
        setRenderer(active);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setRendererStatus(
            error instanceof Error ? error.message : '3D viewer unavailable.',
          );
      });
    return () => {
      cancelled = true;
      active?.dispose();
    };
  });

  createEffect(
    () => ({ renderer: renderer(), disabled: props.interactionDisabled }),
    ({ renderer, disabled }) => renderer?.setInteractionEnabled(!disabled),
    { name: 'construction.interaction' },
  );
  createEffect(
    () => ({ renderer: renderer(), request: imageRequest() }),
    ({ renderer, request }) => {
      if (!renderer || !request) return;
      const sheet = request.sheet;
      const abort = new AbortController();
      let cancelled = false;
      let fullReady = false;
      let current: ImageBitmap | null = null;
      const publish = async (lease: RasterLease, full: boolean) => {
        try {
          const scale = Math.min(1, 2048 / Math.max(lease.width, lease.height));
          const bitmap = await createImageBitmap(lease.source, {
            resizeWidth: Math.max(1, Math.ceil(lease.width * scale)),
            resizeHeight: Math.max(1, Math.ceil(lease.height * scale)),
            resizeQuality: 'high',
            imageOrientation: 'flipY',
          });
          if (cancelled || (!full && fullReady)) {
            bitmap.close();
            return;
          }
          if (full) fullReady = true;
          renderer.clearPlan();
          current?.close();
          current = bitmap;
          setPlanImage({ image: bitmap, request });
        } finally {
          lease.release();
        }
      };
      const preview = props.controller.cachedSheetPreview(sheet);
      if (preview) void publish(preview, false).catch(() => undefined);
      else
        void props.controller
          .acquireSheet(sheet, PAGE_PREVIEW_DIMENSION, abort.signal)
          .then((lease) => publish(lease, false))
          .catch(() => undefined);
      void props.controller
        .acquireSheet(sheet, pageImageDimension(sheet), abort.signal)
        .then((lease) => publish(lease, true))
        .catch(() => undefined);
      return () => {
        cancelled = true;
        abort.abort();
        renderer.clearPlan();
        current?.close();
      };
    },
    { name: 'construction.planImage' },
  );
  createEffect(
    () => ({
      renderer: renderer(),
      scene: scene(),
      camera: camera(),
      viewport: viewport(),
      ids: displayIds(),
      selected: selectedId(),
      displayMode: displayMode(),
      plan: plan(),
    }),
    (state) => {
      const frame = requestAnimationFrame(() => {
        if (!state.renderer) return;
        try {
          state.renderer.render(state.scene, {
            ...state.viewport,
            camera: state.camera,
            displayMode: state.displayMode,
            plan: state.plan,
            selectedGeometryIds: state.ids,
            selectedPieceId: state.selected,
          });
          setRendererStatus('');
        } catch (error: unknown) {
          setRendererStatus(
            error instanceof Error ? error.message : '3D viewer unavailable.',
          );
        }
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
        displayMode: displayMode(),
        showPlan: props.showPlan,
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
        categories: props.controller.categoryFilter(),
      }),
      apply(view) {
        setPresentation(view);
        setCamera({ ...view.camera });
        setDisplayMode(view.displayMode ?? 'solid');
        if (view.showPlan !== undefined) props.onShowPlanChange(view.showPlan);
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
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  });
  function reset() {
    setCamera(fitCamera(fittingScene(), defaultCamera));
  }
  function focusSelection() {
    setCamera((current) =>
      fitCamera(fittingScene(), current, displayIds(), selected()?.id),
    );
  }
  function applyPreset(value: ViewPreset) {
    const view = viewPresets[value];
    setCamera((current) => ({ ...current, yaw: view.yaw, pitch: view.pitch }));
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
        <CategoryFilter controller={props.controller} />
        <label>
          View{' '}
          <select
            value={preset()}
            onChange={(event) => {
              applyPreset(event.currentTarget.value as ViewPreset);
            }}
          >
            <option value="" disabled>
              Custom angle
            </option>
            <For each={viewOptions}>
              {(view) => <option value={view.value}>{view.label}</option>}
            </For>
          </select>
        </label>
        <label>
          Display{' '}
          <select
            value={displayMode()}
            onChange={(event) =>
              setDisplayMode(event.currentTarget.value as DisplayMode)
            }
          >
            <option value="solid">Solid</option>
            <option value="framing">Framing only</option>
            <option value="xray">X-ray</option>
          </select>
        </label>
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
            checked={props.showPlan}
            onChange={(event) => {
              props.onShowPlanChange(event.currentTarget.checked);
            }}
          />
          Show plan
        </label>
        <label class="construction-check">
          <input
            type="checkbox"
            checked={selectedOnly()}
            onChange={(event) => setSelectedOnly(event.currentTarget.checked)}
          />
          Selected sources only
        </label>
        <button
          type="button"
          onClick={focusSelection}
          disabled={!selected() && !displayIds().length}
        >
          Fit selection
        </button>
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
          aria-label="Construction model. Left-drag to orbit; middle-drag or Shift-drag to pan; right-drag or scroll to zoom. Arrow keys orbit, plus and minus zoom, Home resets. Click a member to select its source."
          onKeyDown={keydown}
        />
        <Show when={rendererStatus()}>
          <p class="construction-empty" role="status">
            {rendererStatus()}
          </p>
        </Show>
        <Show when={!rendererStatus() && !visibleCount()}>
          <p class="construction-empty">
            No construction matches this view. Add construction to calibrated
            drawing objects or clear the filters.
          </p>
        </Show>
      </div>
      <div class="construction-status" aria-live="polite">
        <Show when={props.showPlan && props.sheet && !props.sheet.calibration}>
          <span>Calibrate the current sheet to show its plan in 3D.</span>
        </Show>
        <span>
          {displayMode() === 'xray'
            ? 'X-ray: finish outlines remain visible through framing.'
            : displayMode() === 'framing'
              ? 'Framing only; finishes hidden.'
              : 'Solid view; materials hide objects behind them.'}{' '}
          Members show calculated section envelopes.
        </span>
        <Show when={props.estimateOutputs}>
          <span>
            {props.estimateOutputs} estimated material outputs have no 3D
            placement.
          </span>
        </Show>
        <span>
          {visibleCount().toLocaleString()} objects shown. Left-drag to orbit ·
          Middle-drag to pan · Right-drag or scroll to zoom
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
                  : `${value.face === 'ceiling' ? 'Installed ceiling area' : 'Installed finish area'}: ${value.area.toFixed(3)} m² · ${String(value.layers)} layer(s)${value.thickness === undefined ? '' : ` · Total thickness ${(value.thickness * 1000).toFixed(1)} mm`}`;
              })()}
            </span>
          </aside>
        )}
      </Show>
    </section>
  );
}
