import type { Project } from '../core/types';
import type { PdfDocuments } from '../pdf/documents';
import { paintTakeoff } from '../components/canvas/paint';

export interface RenderOptions {
  sheetId: string;
  maxDimension?: number;
  mode?: 'plan' | 'takeoff' | 'combined';
  bounds?: { x: number; y: number; width: number; height: number };
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
