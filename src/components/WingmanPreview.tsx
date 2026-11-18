import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import { paintAnnotation } from './canvas/annotations';
import type { PlanView, ViewFrame, WingmanView } from '../app/wingman-types';
import type { Geometry } from '../core/types';
import { resolveConstruction } from '../core/applied-assemblies';
import { deductionGeometryIds } from '../core/takeoffs';
import {
  categoryColor,
  geometryCategories,
  geometryMatchesCategories,
  matchesCategories,
} from '../core/categories';
import { paintTakeoff } from './canvas/paint';
import {
  prepareConstructionScene,
  constructionSceneContext,
  sameConstructionSceneContext,
} from '../three/scene';
import type { acquireConstructionSnapshot } from '../three/renderer';
import type { RegionImages } from '../pdf/region-images';

/** Presentation marks never become editing selections. Coordinates are page units. */
export function paintPlanPresentation(
  context: CanvasRenderingContext2D,
  geometries: Geometry[],
  view: PlanView,
  pixel: number,
  deductionIds: readonly string[] = [],
) {
  context.save();
  const highlights = new Set(view.highlightIds ?? []);
  paintTakeoff(
    context,
    geometries.filter((item) => highlights.has(item.id)),
    {
      colors: Object.fromEntries([...highlights].map((id) => [id, '#f59e0b'])),
      unitsPerPixel: pixel * 2,
      deductionIds,
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
  takeoffId: string;
  planImages: RegionImages;
  frame?: ViewFrame | undefined;
  maxDimension?: number;
  onReady?: (canvas: HTMLCanvasElement | null) => void;
}) {
  let canvas: HTMLCanvasElement | undefined;
  let snapshot: ReturnType<typeof acquireConstructionSnapshot> | undefined;
  const [status, setStatus] = createSignal('');
  const sourceProject = createMemo(() =>
    props.controller.projectForTakeoff(props.takeoffId),
  );
  const model = createMemo(() =>
    props.view.kind === '3d'
      ? props.controller.constructionForTakeoff(props.takeoffId)
      : null,
  );
  const sceneContext = createMemo(
    () => {
      const project = sourceProject();
      return project ? constructionSceneContext(project) : null;
    },
    { equals: sameConstructionSceneContext },
  );
  const modelFilter = createMemo(
    () => {
      const view = props.view;
      if (view.kind !== '3d') return null;
      const selected = new Set(view.selectedGeometryIds ?? []);
      const geometryIds = view.selectedOnly
        ? (view.geometryIds ?? [...selected]).filter((id) => selected.has(id))
        : view.geometryIds;
      const project = view.levelId ? sourceProject() : null;
      const construction = project ? resolveConstruction(project) : null;
      const levelGeometryIds = construction
        ? [
            ...Object.values(construction.walls),
            ...Object.values(construction.ceilings),
            ...Object.values(construction.materials ?? {}),
          ]
            .filter((source) => source.levelId === view.levelId)
            .map((source) => source.geometryId)
        : undefined;
      return {
        categories: view.categories,
        ...(view.sheetIds === undefined ? {} : { sheetIds: view.sheetIds }),
        alignment: view.alignment ?? 'saved',
        ...(geometryIds ? { geometryIds } : {}),
        ...(levelGeometryIds ? { levelGeometryIds } : {}),
        ...(view.materialId ? { materialId: view.materialId } : {}),
        ...(view.role ? { role: view.role } : {}),
      };
    },
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
  const modelScene = createMemo(() => {
    const result = model();
    const project = sceneContext();
    const filter = modelFilter();
    return result && project && filter
      ? prepareConstructionScene(project, result, filter).scene
      : null;
  });
  onCleanup(() => {
    snapshot?.dispose();
  });
  createEffect(
    () => ({
      project:
        props.view.kind === 'plan' || props.view.planCorners
          ? sourceProject()
          : null,
      frame: props.frame,
      onReady: props.onReady,
      showSheetAnnotations:
        props.view.kind === 'plan' && props.controller.annotationsVisible(),
      dimension: props.maxDimension ?? 640,
      scene: modelScene(),
      view: props.view,
      planImages: props.planImages,
    }),
    ({
      project,
      scene,
      view,
      planImages,
      frame,
      onReady,
      showSheetAnnotations,
      dimension,
    }) => {
      const element = canvas;
      if (!element) return;
      let cancelled = false;
      onReady?.(null);
      const size =
        frame ??
        (view.kind === 'plan' ? view.bounds : { width: 640, height: 400 });
      const ratio = dimension / Math.max(size.width, size.height);
      const width = Math.max(1, Math.round(size.width * ratio));
      const height = Math.max(1, Math.round(size.height * ratio));
      const scale = view.kind === 'plan' ? width / view.bounds.width : 1;
      if (element.width !== width) element.width = width;
      if (element.height !== height) element.height = height;
      const context = element.getContext('2d');
      if (!context) return;
      const ready = () => {
        onReady?.(element);
      };
      setStatus('');
      if (view.kind === '3d') {
        context.clearRect(0, 0, element.width, element.height);
        if (!scene) {
          setStatus('No construction is available.');
          return;
        }
        setStatus('Loading 3D preview…');
        const isCancelled = () => cancelled;
        void import('../three/renderer')
          .then(async ({ acquireConstructionSnapshot }) => {
            if (cancelled) return;
            const sheetId =
              view.sheetIds?.length === 1 ? view.sheetIds[0] : undefined;
            const sheet =
              view.showPlan && sheetId ? project?.sheets[sheetId] : undefined;
            let image: ImageBitmap | undefined;
            if (sheet && view.planCorners) {
              const raster = planImages.get(
                sheet,
                { x: 0, y: 0, width: sheet.width, height: sheet.height },
                1024,
              );
              image = await createImageBitmap(await raster.image, {
                imageOrientation: 'flipY',
              });
              if (isCancelled()) {
                image.close();
                return;
              }
            }
            snapshot ??= acquireConstructionSnapshot();
            try {
              snapshot.render(element, scene, {
                width,
                height,
                plan:
                  image && view.planCorners
                    ? { image, corners: view.planCorners }
                    : undefined,
                pixelRatio: 1,
                camera: view.camera,
                displayMode: view.displayMode ?? 'solid',
                selectedGeometryIds: view.selectedGeometryIds ?? [],
                selectedPieceId: view.selectedPieceId ?? null,
              });
            } finally {
              image?.close();
            }
            ready();
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
      const sheet = project?.sheets[view.sheetId];
      if (!project || !sheet) {
        context.clearRect(0, 0, element.width, element.height);
        setStatus('Source sheet is no longer available.');
        return;
      }
      const draw = (image?: HTMLCanvasElement) => {
        if (cancelled) return;
        context.fillStyle = '#0f1218';
        context.fillRect(0, 0, element.width, element.height);
        context.save();
        context.scale(scale, height / view.bounds.height);
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
        const tags = geometryCategories(project);
        const geometries = Object.values(project.geometries).filter(
          (item) =>
            item.sheetId === sheet.id &&
            (!visible || visible.has(item.id)) &&
            geometryMatchesCategories(tags[item.id] ?? [], view.categories),
        );
        const categoryColors = Object.fromEntries(
          geometries.map((item) => [
            item.id,
            (tags[item.id] ?? [])
              .filter((name) => matchesCategories(name, view.categories))
              .map((name) => categoryColor(project, name)),
          ]),
        );
        if (view.mode !== 'plan')
          paintTakeoff(context, geometries, {
            deductionIds: deductionGeometryIds(project),
            categoryColors,
            unitsPerPixel: 1 / scale,
          });
        if (showSheetAnnotations) {
          for (const annotation of Object.values(project.annotations))
            if (annotation.sheetId === sheet.id)
              paintAnnotation(context, annotation, 1 / scale);
        }
        paintPlanPresentation(
          context,
          geometries,
          view,
          1 / scale,
          deductionGeometryIds(project),
        );
        context.restore();
      };
      if (view.mode === 'takeoff') {
        draw();
        ready();
      } else {
        const currentRaster = planImages.get(sheet, view.bounds, dimension);
        if (currentRaster.value) {
          draw(currentRaster.value);
          ready();
        } else {
          draw();
          setStatus('Loading plan…');
          void currentRaster.image
            .then((image) => {
              if (cancelled) return;
              draw(image);
              ready();
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
