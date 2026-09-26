import { constructionOutputs } from './construction-calculations';
import type {
  Assignment,
  AssemblyComponent,
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
import { assemblyOutputs, componentInputs } from './systems';

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
    recipe.inputs.flatMap((input) => {
      const value = assignment.inputs[input.name] ?? input.default;
      return value === undefined ? [] : [[input.name, value]];
    }),
  );
}
function source(
  project: Project,
  recipe: Recipe,
  assignment: Assignment,
  output: RecipeOutput,
  geometryId: string,
  component?: AssemblyComponent,
): CalculationSource {
  let inputs = {
    ...effectiveInputs(recipe, assignment),
    ...assignment.geometryInputs?.[geometryId],
  };
  try {
    const geometry = project.geometries[geometryId];
    if (!geometry) throw new Error('Geometry is missing');
    let variables: Record<string, FormulaValue> = {};
    for (const key of Object.keys(assignment.inputs))
      if (!recipe.inputs.some((input) => input.name === key))
        throw new Error(`Undeclared assignment input: ${key}`);
    const addInputs = (definition: Recipe) => {
      for (const input of definition.inputs) {
        const value = inputs[input.name];
        if (value === undefined)
          throw new Error(`Required input: ${input.name}`);
        if (typeof value !== input.type)
          throw new Error(`Input ${input.name} must be ${input.type}`);
        if (
          typeof value === 'number' &&
          input.minimum !== undefined &&
          value < input.minimum
        )
          throw new Error(
            `Input ${input.name} must be at least ${String(input.minimum)}`,
          );
        if (typeof value === 'boolean') {
          if (input.unit !== 'scalar')
            throw new Error('Boolean inputs must be dimensionless');
          variables[input.name] = value;
        } else if (typeof value === 'number')
          variables[input.name] = formulaQuantity({ value, unit: input.unit });
      }
    };
    addInputs(recipe);
    if (component) {
      inputs = componentInputs(recipe, component, inputs);
      variables = {};
      addInputs(component.assembly);
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
    if (output.piece) {
      if (!Number.isInteger(value))
        throw new Error('Piece quantity must be a whole number');
      const length = (definition: {
        formula: string;
        unit: 'm' | 'mm' | 'ft' | 'in';
      }) => {
        const value = formulaQuantity({
          value: formulaOutput(
            evaluateFormula(definition.formula, variables),
            definition.unit,
          ),
          unit: definition.unit,
        }).value;
        if (value <= 0) throw new Error('Piece length must be positive');
        // Canonical metres make equivalent imperial/metric schedules combine.
        return { value, unit: 'm' as const };
      };
      const cutLength = length(output.piece.cutLength);
      const stockLength = output.piece.stockLength
        ? length(output.piece.stockLength)
        : undefined;
      if (stockLength && stockLength.value + 1e-9 < cutLength.value)
        throw new Error('Stock length is shorter than cut length');
      return {
        geometryId,
        inputs,
        value,
        cutLength,
        ...(stockLength ? { stockLength } : {}),
      };
    }
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
    for (const { output, component } of assemblyOutputs(recipe)) {
      const sources = (group?.geometryIds ?? [])
        .filter((id) => {
          const geometry = project.geometries[id];
          return !geometry || recipe.geometryKinds.includes(geometry.kind);
        })
        .map((id) =>
          source(project, recipe, assignment, output, id, component),
        );
      const buckets = new Map<string, CalculationSource[]>();
      if (!sources.length) buckets.set('', []);
      for (const source of sources) {
        const key = output.piece
          ? JSON.stringify([
              source.stockLength
                ? null
                : source.cutLength?.value.toPrecision(12),
              source.stockLength?.value.toPrecision(12),
            ])
          : '';
        const bucket = buckets.get(key) ?? [];
        bucket.push(source);
        buckets.set(key, bucket);
      }
      for (const sources of buckets.values()) {
        const diagnostics = sources.flatMap((entry) =>
          entry.diagnostic ? [`${entry.geometryId}: ${entry.diagnostic}`] : [],
        );
        if (!group) diagnostics.push('Assignment group is missing');
        if (group?.geometryIds.length && !sources.length)
          diagnostics.push('No compatible drawing objects in this group');
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
            ? output.piece
              ? Math.ceil(
                  adjustedAmount -
                    Number.EPSILON * Math.max(1, adjustedAmount) * 8,
                )
              : adjustedAmount
            : packageCount * (allowance.packageSize ?? 0);
        if (
          ![baseAmount, wasteAmount, adjustedAmount, purchasedAmount].every(
            Number.isFinite,
          )
        )
          diagnostics.push('Quantity aggregation overflowed');
        const commonCutLength = sources.every(
          (source) =>
            source.cutLength?.value.toPrecision(12) ===
            sources[0]?.cutLength?.value.toPrecision(12),
        )
          ? sources[0]?.cutLength
          : undefined;
        const result: CalculationOutput = {
          groupId: assignment.groupId,
          assignmentId: assignment.id,
          recipeId: recipe.id,
          outputId: output.id,
          materialId: output.materialId,
          name: output.name,
          unit: output.unit,
          sources,
          ...(output.piece ? { role: output.piece.role } : {}),
          ...(commonCutLength ? { cutLength: commonCutLength } : {}),
          ...(sources[0]?.stockLength
            ? { stockLength: sources[0].stockLength }
            : {}),
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
  }
  const positioned = constructionOutputs(project);
  for (const output of outputs) {
    if (
      positioned.outputs.some(
        (placed) =>
          placed.materialId === output.materialId &&
          placed.sources.some((source) =>
            output.sources.some(
              (estimate) => estimate.geometryId === source.geometryId,
            ),
          ),
      )
    ) {
      output.diagnostics.push(
        'This material has both formula and positioned quantities on the same drawing. Review the assignments to avoid counting it twice.',
      );
      output.complete = false;
      complete = false;
    }
  }
  outputs.push(...positioned.outputs);
  complete &&= positioned.complete;
  const totals = new Map<string, QuantityTotal>();
  for (const output of outputs) {
    const key = JSON.stringify([
      output.materialId,
      output.unit,
      output.stockLength ? null : output.cutLength?.value.toPrecision(12),
      output.stockLength?.value.toPrecision(12),
    ]);
    const total = totals.get(key) ?? {
      materialId: output.materialId,
      unit: output.unit,
      ...(!output.stockLength && output.cutLength
        ? { cutLength: output.cutLength }
        : {}),
      ...(output.stockLength ? { stockLength: output.stockLength } : {}),
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
      'role',
      'cutLength_m',
      'stockLength_m',
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
      output.role ?? '',
      output.cutLength?.value ?? null,
      output.stockLength?.value ?? null,
    ]);
  return rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`)
        .join(','),
    )
    .join('\r\n');
}

export function pieceSchedule(
  project: Project,
  result: CalculationResult = calculateProject(project),
) {
  return result.outputs
    .filter((output) => output.role !== undefined)
    .flatMap((output) =>
      output.sources.map((source) => {
        const geometry = project.geometries[source.geometryId];
        return {
          sheet: project.sheets[geometry?.sheetId ?? '']?.name ?? '',
          geometryId: source.geometryId,
          location: geometry?.name ?? source.geometryId,
          group: project.groups[output.groupId]?.name ?? output.groupId,
          assignmentId: output.assignmentId,
          outputId: output.outputId,
          assembly: project.recipes[output.recipeId]?.name ?? output.recipeId,
          materialId: output.materialId,
          role: source.pieceRole ?? output.role ?? '',
          pieceId: source.pieceId ?? '',
          quantity: source.value,
          cutLength_m: source.cutLength?.value ?? null,
          stockLength_m: source.stockLength?.value ?? null,
          complete: source.value !== null && output.complete,
          diagnostic: source.diagnostic ?? output.diagnostics.join('; '),
        };
      }),
    );
}
export function exportPieces(project: Project, format: 'csv' | 'json'): string {
  const rows = pieceSchedule(project);
  if (format === 'json') return JSON.stringify(rows, null, 2);
  const keys = [
    'sheet',
    'geometryId',
    'location',
    'group',
    'assignmentId',
    'outputId',
    'assembly',
    'materialId',
    'role',
    'quantity',
    'cutLength_m',
    'stockLength_m',
    'complete',
    'diagnostic',
  ] as const;
  return [keys, ...rows.map((row) => keys.map((key) => row[key]))]
    .map((row) =>
      row
        .map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`)
        .join(','),
    )
    .join('\n');
}
