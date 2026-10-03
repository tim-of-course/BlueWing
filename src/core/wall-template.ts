import type { Wall } from './construction-types';
import type { WallTemplate, CeilingTemplate } from './types';
import { materialSettings } from './applied-assemblies';
import { createProject } from './geometry';
import { emptyConstruction, validateConstruction } from './construction';

export function wallTemplateFromWall(wall: Wall): WallTemplate {
  const copy = materialSettings(wall);
  delete copy.levelId;
  delete copy.topProfile;
  delete copy.conditions;
  return copy as WallTemplate;
}

export function validateCeilingTemplate(template: CeilingTemplate): void {
  const project = createProject('Ceiling assembly validation');
  project.sheets.plan = {
    id: 'plan',
    name: 'Plan',
    assetId: 'template',
    pageIndex: 0,
    width: 1,
    height: 1,
  };
  project.geometries.area = {
    id: 'area',
    sheetId: 'plan',
    name: 'Area',
    kind: 'area',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
  };
  const data = emptyConstruction();
  data.ceilings.ceiling = { ...template, id: 'ceiling', geometryId: 'area' };
  validateConstruction(project, data);
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
