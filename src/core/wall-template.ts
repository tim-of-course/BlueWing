import type { Wall } from './construction-types';
import type { WallTemplate } from './types';
import { createProject } from './geometry';
import { emptyConstruction, validateConstruction } from './construction';

export function wallTemplateFromWall(wall: Wall): WallTemplate {
  const copy = structuredClone(wall) as Partial<Wall>;
  delete copy.id;
  delete copy.geometryId;
  delete copy.levelId;
  delete copy.topProfile;
  delete copy.conditions;
  return copy as WallTemplate;
}

/** Reuse authored-wall validation without requiring a project drawing. */
export function validateWallTemplate(template: WallTemplate): void {
  const project = createProject('Template validation');
  project.sheets.plan = {
    id: 'plan',
    name: 'Plan',
    assetId: 'template',
    pageIndex: 0,
    width: 1,
    height: 1,
  };
  project.geometries.path = {
    id: 'path',
    sheetId: 'plan',
    name: 'Path',
    kind: 'path',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
  };
  const data = emptyConstruction();
  data.walls.wall = { ...template, id: 'wall', geometryId: 'path' };
  validateConstruction(project, data);
}
