import type {
  Assignment,
  CalculationOutput,
  CalculationResult,
  CalculationSource,
  Project,
  QuantityTotal,
  Recipe,
  RecipeOutput,
} from './types';
import { measureGeometry } from './geometry';
import { evaluateFormula, formulaOutput, formulaQuantity } from './formula';
import type { FormulaValue } from './formula';

export function starterRecipes(): Record<string, Recipe> {
  const output = (
    id: string,
    name: string,
    materialId: string,
    unit: RecipeOutput['unit'],
    formula: string,
  ): RecipeOutput => ({
    id,
    name,
    materialId,
    unit,
    formula,
    allowance: { wastePercent: 0 },
  });
  const recipes: Recipe[] = [
    {
      id: 'wall-area',
      name: 'Wall area',
      geometryKinds: ['path'],
      inputs: [
        { name: 'height', type: 'number', unit: 'ft', default: 8 },
        { name: 'layers', type: 'number', unit: 'scalar', default: 1 },
      ],
      outputs: [
        output(
          'wall-area',
          'Wall area',
          'wall-finish',
          'ft2',
          'length * height * layers',
        ),
      ],
    },
    {
      id: 'floor-area',
      name: 'Floor area',
      geometryKinds: ['area'],
      inputs: [],
      outputs: [
        output('floor-area', 'Floor area', 'floor-finish', 'ft2', 'area'),
      ],
    },
    {
      id: 'count',
      name: 'Count',
      geometryKinds: ['count'],
      inputs: [],
      outputs: [output('count', 'Items', 'items', 'ea', 'count')],
    },
    {
      id: 'stud-estimate',
      name: 'Stud estimate',
      geometryKinds: ['path'],
      inputs: [{ name: 'spacing', type: 'number', unit: 'in', default: 16 }],
      outputs: [
        output(
          'studs',
          'Estimated studs',
          'stud',
          'ea',
          'ceil(length / spacing) + 1',
        ),
      ],
    },
  ];
  return Object.fromEntries(recipes.map((recipe) => [recipe.id, recipe]));
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function effectiveInputs(
  recipe: Recipe,
  assignment: Assignment,
): Record<string, number | boolean> {
  return Object.fromEntries(
    recipe.inputs.map((input) => [
      input.name,
      assignment.inputs[input.name] ?? input.default,
    ]),
  );
}
function source(
  project: Project,
  recipe: Recipe,
  assignment: Assignment,
  output: RecipeOutput,
  geometryId: string,
): CalculationSource {
  const inputs = effectiveInputs(recipe, assignment);
  try {
    const geometry = project.geometries[geometryId];
    if (!geometry) throw new Error('Geometry is missing');
    const variables: Record<string, FormulaValue> = {};
    for (const key of Object.keys(assignment.inputs))
      if (!recipe.inputs.some((input) => input.name === key))
        throw new Error(`Undeclared assignment input: ${key}`);
    for (const input of recipe.inputs) {
      const value = inputs[input.name];
      if (typeof value !== input.type)
        throw new Error(`Input ${input.name} must be ${input.type}`);
      if (typeof value === 'boolean') {
        if (input.unit !== 'scalar')
          throw new Error('Boolean inputs must be dimensionless');
        variables[input.name] = value;
      } else if (typeof value === 'number')
        variables[input.name] = formulaQuantity({ value, unit: input.unit });
    }
    const measurements = measureGeometry(project, geometry);
    for (const metric of ['length', 'area', 'perimeter', 'count'] as const) {
      const quantity = measurements[metric];
      if (quantity) variables[metric] = formulaQuantity(quantity);
    }
    const value = formulaOutput(
      evaluateFormula(output.formula, variables),
      output.unit,
    );
    if (!Number.isFinite(value) || value < 0)
      throw new Error('Calculated quantity must be finite and nonnegative');
    return { geometryId, inputs, value };
  } catch (error) {
    return { geometryId, inputs, value: null, diagnostic: message(error) };
  }
}
export function calculateProject(project: Project): CalculationResult {
  const outputs: CalculationOutput[] = [];
  let complete = true;
  for (const assignment of Object.values(project.assignments)) {
    const recipe = project.recipes[assignment.recipeId];
    const group = project.groups[assignment.groupId];
    if (!recipe) {
      complete = false;
      continue;
    }
    for (const output of recipe.outputs) {
      const sources = (group?.geometryIds ?? [])
        .filter((id) => {
          const geometry = project.geometries[id];
          return !geometry || recipe.geometryKinds.includes(geometry.kind);
        })
        .map((id) => source(project, recipe, assignment, output, id));
      const diagnostics = sources.flatMap((entry) =>
        entry.diagnostic ? [`${entry.geometryId}: ${entry.diagnostic}`] : [],
      );
      if (!group) diagnostics.push('Assignment group is missing');
      const allowance = assignment.allowances[output.id] ?? output.allowance;
      const baseAmount = sources.reduce(
        (sum, entry) => sum + (entry.value ?? 0),
        0,
      );
      const wastePercent = allowance.wastePercent;
      const validAllowance =
        Number.isFinite(wastePercent) &&
        wastePercent >= 0 &&
        (allowance.packageSize === undefined ||
          (Number.isFinite(allowance.packageSize) &&
            allowance.packageSize > 0));
      if (!validAllowance)
        diagnostics.push(
          'Waste must be nonnegative and package size must be positive',
        );
      const wasteAmount = validAllowance
        ? (baseAmount * wastePercent) / 100
        : 0;
      const adjustedAmount = baseAmount + wasteAmount;
      // Compensate only for floating-point noise at an exact package boundary.
      const ratio =
        validAllowance && allowance.packageSize
          ? adjustedAmount / allowance.packageSize
          : null;
      const packageCount =
        ratio === null
          ? null
          : Math.max(
              ratio > 0 ? 1 : 0,
              Math.ceil(
                ratio - Number.EPSILON * Math.max(1, Math.abs(ratio)) * 8,
              ),
            );
      const purchasedAmount =
        packageCount === null
          ? adjustedAmount
          : packageCount * (allowance.packageSize ?? 0);
      if (
        ![baseAmount, wasteAmount, adjustedAmount, purchasedAmount].every(
          Number.isFinite,
        )
      )
        diagnostics.push('Quantity aggregation overflowed');
      const result: CalculationOutput = {
        groupId: assignment.groupId,
        assignmentId: assignment.id,
        recipeId: recipe.id,
        outputId: output.id,
        materialId: output.materialId,
        name: output.name,
        unit: output.unit,
        sources,
        baseAmount,
        wastePercent,
        wasteAmount,
        adjustedAmount,
        packageCount,
        purchasedAmount,
        complete: diagnostics.length === 0,
        diagnostics,
      };
      outputs.push(result);
      complete &&= result.complete;
    }
  }
  const totals = new Map<string, QuantityTotal>();
  for (const output of outputs) {
    const key = JSON.stringify([
      output.materialId,
      output.outputId,
      output.unit,
    ]);
    const total = totals.get(key) ?? {
      materialId: output.materialId,
      outputId: output.outputId,
      unit: output.unit,
      amount: 0,
      complete: true,
    };
    total.amount += output.purchasedAmount;
    total.complete &&= output.complete;
    totals.set(key, total);
  }
  return { outputs, totals: [...totals.values()], complete };
}
export function exportQuantities(
  project: Project,
  format: 'csv' | 'json',
): string {
  const result = calculateProject(project);
  if (format === 'json') return JSON.stringify(result, null, 2);
  const rows: (string | number | boolean | null)[][] = [
    [
      'groupId',
      'assignmentId',
      'recipeId',
      'outputId',
      'materialId',
      'name',
      'unit',
      'baseAmount',
      'wastePercent',
      'wasteAmount',
      'adjustedAmount',
      'packageCount',
      'purchasedAmount',
      'complete',
      'diagnostics',
    ],
  ];
  for (const output of result.outputs)
    rows.push([
      output.groupId,
      output.assignmentId,
      output.recipeId,
      output.outputId,
      output.materialId,
      output.name,
      output.unit,
      output.baseAmount,
      output.wastePercent,
      output.wasteAmount,
      output.adjustedAmount,
      output.packageCount,
      output.purchasedAmount,
      output.complete,
      output.diagnostics.join('; '),
    ]);
  return rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`)
        .join(','),
    )
    .join('\r\n');
}
