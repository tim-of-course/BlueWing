import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import type { PlanView, WingmanView } from '../app/wingman-types';
import type { Geometry } from '../core/types';
import { resolveConstruction } from '../core/applied-assemblies';
import { paintTakeoff } from './canvas/paint';
import { buildConstructionScene, constructionSceneInput } from '../three/scene';
import type { acquireConstructionSnapshot } from '../three/renderer';

/** Presentation marks never become editing selections. Coordinates are page units. */
export function paintPlanPresentation(
  context: CanvasRenderingContext2D,
  geometries: Geometry[],
  view: PlanView,
  pixel: number,
) {
  context.save();
  const highlights = new Set(view.highlightIds ?? []);
  paintTakeoff(
    context,
    geometries.filter((item) => highlights.has(item.id)),
    {
      colors: Object.fromEntries([...highlights].map((id) => [id, '#f59e0b'])),
      unitsPerPixel: pixel * 2,
    },
  );
  for (const annotation of view.annotations ?? []) {
    const first = annotation.points[0];
    if (!first) continue;
    context.strokeStyle = annotation.color;
    context.lineWidth = 3 * pixel;
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (const point of annotation.points.slice(1))
      context.lineTo(point.x, point.y);
    context.stroke();
    if (annotation.points.length === 1) {
      context.beginPath();
      context.arc(first.x, first.y, 6 * pixel, 0, Math.PI * 2);
      context.fillStyle = annotation.color;
      context.fill();
    }
    if (annotation.label) {
      context.font = `${String(14 * pixel)}px sans-serif`;
      context.fillStyle = '#fff';
      context.fillRect(
        first.x,
        first.y - 18 * pixel,
        context.measureText(annotation.label).width + 8 * pixel,
        20 * pixel,
      );
      context.fillStyle = '#111';
      context.fillText(
        annotation.label,
        first.x + 4 * pixel,
        first.y - 3 * pixel,
      );
    }
  }
  context.restore();
}

export default function WingmanPreview(props: {
  controller: WorkspaceController;
  view: WingmanView;
}) {
  let canvas: HTMLCanvasElement | undefined;
  let raster:
    | { key: string; image: Promise<HTMLCanvasElement>; abort: AbortController }
    | undefined;
  let snapshot: ReturnType<typeof acquireConstructionSnapshot> | undefined;
  const [status, setStatus] = createSignal('');
  onCleanup(() => {
    snapshot?.dispose();
    raster?.abort.abort();
  });
  createEffect(
    () => ({
      project: props.controller.project(),
      result: props.view.kind === '3d' ? props.controller.construction() : null,
      view: props.view,
      controller: props.controller,
    }),
    ({ project, result, view, controller }) => {
      const element = canvas;
      if (!element) return;
      let cancelled = false;
      element.width = 640;
      element.height = 400;
      const context = element.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, element.width, element.height);
      setStatus('');
      if (view.kind === '3d' || view.mode === 'takeoff') {
        raster?.abort.abort();
        raster = undefined;
      }
      if (!project || (view.kind === 'plan' && !project.sheets[view.sheetId])) {
        raster?.abort.abort();
        raster = undefined;
        setStatus('Source sheet is no longer available.');
        return;
      }
      if (view.kind === '3d') {
        if (!result) {
          setStatus('No construction is available.');
          return;
        }
        const selected = new Set(view.selectedGeometryIds ?? []);
        const geometryIds = view.selectedOnly
          ? (view.geometryIds ?? [...selected]).filter((id) => selected.has(id))
          : view.geometryIds;
        const construction = resolveConstruction(project);
        const levelGeometryIds = view.levelId
          ? [
              ...Object.values(construction.walls),
              ...Object.values(construction.ceilings),
              ...Object.values(construction.materials ?? {}),
            ]
              .filter((source) => source.levelId === view.levelId)
              .map((source) => source.geometryId)
          : undefined;
        const scene = buildConstructionScene(constructionSceneInput(result), {
          ...(geometryIds ? { geometryIds } : {}),
          ...(levelGeometryIds ? { levelGeometryIds } : {}),
          ...(view.materialId ? { materialId: view.materialId } : {}),
          ...(view.role ? { role: view.role } : {}),
        });
        setStatus('Loading 3D preview…');
        void import('../three/renderer')
          .then(({ acquireConstructionSnapshot }) => {
            if (cancelled) return;
            snapshot ??= acquireConstructionSnapshot();
            snapshot.render(element, scene, {
              width: 640,
              height: 400,
              pixelRatio: 1,
              camera: view.camera,
              displayMode: view.displayMode ?? 'solid',
              selectedGeometryIds: view.selectedGeometryIds ?? [],
              selectedPieceId: view.selectedPieceId ?? null,
            });
            if (
              !scene.members.length &&
              (view.displayMode === 'framing' || !scene.surfaces.length)
            )
              setStatus('No construction matches this view.');
            else if (scene.omitted)
              setStatus(
                `${String(scene.omitted)} objects omitted from this preview.`,
              );
            else setStatus('');
          })
          .catch((error: unknown) => {
            if (!cancelled)
              setStatus(
                error instanceof Error
                  ? error.message
                  : '3D preview unavailable.',
              );
          });
        return () => {
          cancelled = true;
        };
      }
      const sheet = project.sheets[view.sheetId];
      if (!sheet) return;
      const scale = 640 / Math.max(view.bounds.width, view.bounds.height);
      element.width = Math.max(1, Math.round(view.bounds.width * scale));
      element.height = Math.max(1, Math.round(view.bounds.height * scale));
      const draw = (image?: HTMLCanvasElement) => {
        if (cancelled) return;
        context.fillStyle = '#0f1218';
        context.fillRect(0, 0, element.width, element.height);
        context.save();
        context.scale(scale, scale);
        context.translate(-view.bounds.x, -view.bounds.y);
        context.fillStyle = '#fff';
        context.fillRect(0, 0, sheet.width, sheet.height);
        if (image) {
          context.save();
          context.beginPath();
          context.rect(0, 0, sheet.width, sheet.height);
          context.clip();
          context.drawImage(
            image,
            view.bounds.x,
            view.bounds.y,
            view.bounds.width,
            view.bounds.height,
          );
          context.restore();
        }
        const visible = view.visibleGeometryIds
          ? new Set(view.visibleGeometryIds)
          : null;
        const geometries = Object.values(project.geometries).filter(
          (item) =>
            item.sheetId === sheet.id && (!visible || visible.has(item.id)),
        );
        const colors: Record<string, string> = {};
        for (const group of Object.values(project.groups))
          for (const id of group.geometryIds)
            colors[id] = group.color ?? '#3b82f6';
        if (view.mode !== 'plan')
          paintTakeoff(context, geometries, {
            colors,
            unitsPerPixel: 1 / scale,
          });
        paintPlanPresentation(context, geometries, view, 1 / scale);
        context.restore();
      };
      draw();
      if (view.mode !== 'takeoff') {
        setStatus('Loading plan…');
        const key = JSON.stringify([
          sheet.assetId,
          sheet.pageIndex,
          sheet.rotation,
          view.bounds,
        ]);
        if (raster?.key !== key) {
          raster?.abort.abort();
          const abort = new AbortController();
          raster = {
            key,
            image: controller.renderRegion(
              sheet,
              view.bounds,
              640,
              abort.signal,
            ),
            abort,
          };
        }
        void raster.image
          .then((image) => {
            if (cancelled) return;
            draw(image);
            setStatus('');
          })
          .catch((error: unknown) => {
            if (!cancelled)
              setStatus(
                error instanceof Error
                  ? error.message
                  : 'Plan preview unavailable.',
              );
          });
      }
      return () => {
        cancelled = true;
      };
    },
    { name: 'wingman.preview' },
  );
  return (
    <div
      class="wingman-preview"
      style={{ position: 'relative', width: '100%' }}
    >
      <canvas
        ref={(element) => {
          canvas = element;
        }}
        role="img"
        aria-label="Live workspace preview"
        style={{
          display: 'block',
          width: '100%',
          'max-height': 'var(--wingman-preview-height, 240px)',
          'object-fit': 'contain',
        }}
      />
      <Show when={status()}>
        <p role="status">{status()}</p>
      </Show>
    </div>
  );
}
