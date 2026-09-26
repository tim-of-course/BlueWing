import type { Project } from '../core/types';
import type { PdfDocuments } from '../pdf/documents';
import { paintTakeoff } from '../components/canvas/paint';
import type { PlanSnippet } from '../core/review';

export interface RenderOptions {
  sheetId: string;
  maxDimension?: number;
  mode?: 'plan' | 'takeoff' | 'combined';
  bounds?: { x: number; y: number; width: number; height: number };
  highlightIds?: string[];
  annotations?: PlanSnippet['annotations'];
  label?: string;
}
export async function renderImage(
  project: Project,
  pdf: PdfDocuments,
  options: RenderOptions,
) {
  const sheet = project.sheets[options.sheetId];
  if (!sheet) throw new Error('Sheet not found');
  const bounds = options.bounds ?? {
    x: 0,
    y: 0,
    width: sheet.width,
    height: sheet.height,
  };
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x + bounds.width > sheet.width ||
    bounds.y + bounds.height > sheet.height
  )
    throw new Error('Image bounds must fit the sheet');
  const scale =
    Math.min(4096, options.maxDimension ?? 2048) /
    Math.max(bounds.width, bounds.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(bounds.width * scale);
  canvas.height = Math.ceil(bounds.height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (options.mode !== 'takeoff') {
    const plan = await pdf.renderRegion(
      sheet,
      bounds,
      options.maxDimension ?? 2048,
    );
    context.drawImage(plan, 0, 0);
  }
  context.scale(scale, scale);
  context.translate(-bounds.x, -bounds.y);
  if (options.mode !== 'plan') {
    const colors: Record<string, string> = {};
    for (const group of Object.values(project.groups))
      for (const id of group.geometryIds) colors[id] = group.color ?? '#3b82f6';
    paintTakeoff(
      context,
      Object.values(project.geometries).filter(
        (geometry) => geometry.sheetId === sheet.id,
      ),
      { colors, unitsPerPixel: 1 / scale },
    );
  }
  if (options.highlightIds?.length) {
    const highlights = new Set(options.highlightIds);
    paintTakeoff(
      context,
      Object.values(project.geometries).filter(
        (g) => g.sheetId === sheet.id && highlights.has(g.id),
      ),
      {
        colors: Object.fromEntries(
          options.highlightIds.map((id) => [id, '#f59e0b']),
        ),
        unitsPerPixel: 2 / scale,
      },
    );
  }
  for (const annotation of options.annotations ?? []) {
    const first = annotation.points[0];
    if (!first) continue;
    context.strokeStyle = annotation.color;
    context.lineWidth = 3 / scale;
    context.beginPath();
    context.moveTo(first.x, first.y);
    annotation.points.slice(1).forEach((p) => {
      context.lineTo(p.x, p.y);
    });
    context.stroke();
    if (annotation.label) {
      context.font = `${String(14 / scale)}px sans-serif`;
      context.fillStyle = '#fff';
      context.fillRect(
        first.x,
        first.y - 18 / scale,
        context.measureText(annotation.label).width + 8 / scale,
        20 / scale,
      );
      context.fillStyle = '#111';
      context.fillText(
        annotation.label,
        first.x + 4 / scale,
        first.y - 3 / scale,
      );
    }
  }
  if (options.label) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.font = '14px sans-serif';
    context.fillStyle = 'rgba(255,255,255,.94)';
    context.fillRect(0, canvas.height - 28, canvas.width, 28);
    context.fillStyle = '#111';
    context.fillText(options.label, 8, canvas.height - 9, canvas.width - 16);
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('PNG encoding failed'));
    }, 'image/png');
  });
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    metadata: {
      sheetId: sheet.id,
      revision: project.revision,
      width: canvas.width,
      height: canvas.height,
      bounds,
      pdfToPage: sheet.pdfToPage,
      pageToPixel: [scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale],
      pixelToPage: [1 / scale, 0, 0, 1 / scale, bounds.x, bounds.y],
    },
  };
}
