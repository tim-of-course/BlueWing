import { createProject } from '../../src/core/geometry';
import type { Project } from '../../src/core/types';

export function fixture(): Project {
  const project = createProject('Quantity contract', 'contract-project');
  project.sheets.s = {
    id: 's',
    name: 'Plan',
    assetId: 'pdf',
    pageIndex: 0,
    width: 100,
    height: 100,
    calibration: { metresPerUnit: 0.3048 },
  };
  project.geometries.g = {
    id: 'g',
    name: 'Trace',
    sheetId: 's',
    kind: 'count',
    points: [{ x: 0, y: 0 }],
  };
  project.groups.group = { id: 'group', name: 'Ceiling', geometryIds: ['g'] };
  project.recipes.tee = {
    id: 'tee',
    name: 'Ceiling estimate',
    category: 'Acoustical ceilings',
    geometryKinds: ['count'],
    inputs: [
      { name: 'cut', type: 'number', unit: 'ft', default: 2 },
      { name: 'stock', type: 'number', unit: 'ft', default: 10 },
    ],
    outputs: [
      {
        id: 'tee',
        name: 'Tee',
        materialId: 'tee',
        unit: 'ea',
        formula: '75',
        allowance: { wastePercent: 0 },
        piece: { role: 'tee', cutLength: { formula: 'cut', unit: 'ft' } },
      },
    ],
  };
  project.assignments.a = {
    id: 'a',
    groupId: 'group',
    recipeId: 'tee',
    inputs: {},
    allowances: {},
  };
  return project;
}
