import { poolOrders } from './material-orders';
import { modeledOutputs } from './material-results';
import { takeoffProject, takeoffContext } from './takeoffs';
import type { CalculationSnapshot } from './calculation-state';
import { purchaseAmount } from './purchasing';
import { generateConstruction } from './construction';
import {
  mergeMaterialSettings,
  resolveConstruction,
} from './applied-assemblies';
import type {
  Assignment,
  AssemblyComponent,
  CalculationOutput,
  CalculationResult,
  CalculationSource,
  Geometry,
  Project,
  QuantityTotal,
  Recipe,
  RecipeOutput,
  SourceCoverage,
  UncoveredGeometry,
} from './types';
import { measureGeometry } from './geometry';
import { prepareFormula, formulaOutput, formulaQuantity } from './formula';
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
        { name: 'height', type: 'number', unit: 'ft' },
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
interface PreparedSource {
  inputs: Record<string, number | boolean>;
  variables?: Record<string, FormulaValue>;
  diagnostic?: string;
}
function prepareSource(
  project: Project,
  recipe: Recipe,
  assignment: Assignment,
  baseInputs: Record<string, number | boolean>,
  geometryId: string,
  metrics: (geometry: Geometry) => Record<string, FormulaValue>,
  component?: AssemblyComponent,
): PreparedSource {
  let inputs = {
    ...baseInputs,
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
    Object.assign(variables, metrics(geometry));
    return { inputs, variables };
  } catch (error) {
    return { inputs, diagnostic: message(error) };
  }
}
function source(
  prepared: PreparedSource,
  output: RecipeOutput,
  geometryId: string,
  evaluate: (
    formula: string,
    variables: Record<string, FormulaValue>,
  ) => FormulaValue,
): CalculationSource {
  // Each explanation remains independent even when its preparation is shared.
  const inputs = { ...prepared.inputs };
  try {
    if (!prepared.variables) throw new Error(prepared.diagnostic);
    const variables = prepared.variables;
    const value = formulaOutput(
      evaluate(output.formula, variables),
      output.unit,
    );
    if (!Number.isFinite(value) || value < 0)
      throw new Error('Calculated quantity must be finite and nonnegative');
    if (output.piece) {
      if (!Number.isInteger(value))
        throw new Error('Piece quantity must be a whole number');
      const length = (definition: { formula: string; unit: 'ft' | 'in' }) => {
        const value = formulaQuantity({
          value: formulaOutput(
            evaluate(definition.formula, variables),
            definition.unit,
          ),
          unit: definition.unit,
        }).value;
        if (value <= 0) throw new Error('Piece length must be positive');
        // Group equivalent cut lengths in decimal feet.
        return { value, unit: 'ft' as const };
      };
      const cutLength = length(output.piece.cutLength);
      const stockLength = output.piece.stockLength
        ? length(output.piece.stockLength)
        : undefined;
      if (stockLength && stockLength.value + 3.28e-9 < cutLength.value)
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
function sourceCoverage(
  project: Project,
  assignedKinds: Map<string, Set<Geometry['kind']>>,
  accounted: Set<string>,
  emptyAssignments: SourceCoverage['assignmentsWithEmptyGroups']['items'],
): SourceCoverage {
  type Reason = Exclude<keyof SourceCoverage, 'assignmentsWithEmptyGroups'>;
  const missing = new Map<
    string,
    { item: UncoveredGeometry; reason: Reason }
  >();
  for (const geometry of Object.values(project.geometries)) {
    if (accounted.has(geometry.id)) continue;
    missing.set(geometry.id, {
      item: {
        geometryId: geometry.id,
        sheetId: geometry.sheetId,
        kind: geometry.kind,
      },
      reason: 'ungroupedGeometry',
    });
  }
  const coverage: SourceCoverage = {
    ungroupedGeometry: { count: 0, items: [] },
    geometryInUnassignedGroups: { count: 0, items: [] },
    geometryWithIncompatibleRecipes: { count: 0, items: [] },
    geometryWithoutOutputOrDiagnostic: { count: 0, items: [] },
    assignmentsWithEmptyGroups: {
      count: emptyAssignments.length,
      items: emptyAssignments,
    },
  };
  if (!missing.size) return coverage;
  for (const group of Object.values(project.groups)) {
    const kinds = assignedKinds.get(group.id);
    for (const id of group.geometryIds) {
      const entry = missing.get(id);
      if (!entry || entry.reason === 'geometryWithoutOutputOrDiagnostic')
        continue;
      if (kinds?.has(entry.item.kind))
        entry.reason = 'geometryWithoutOutputOrDiagnostic';
      else if (kinds) entry.reason = 'geometryWithIncompatibleRecipes';
      else if (entry.reason === 'ungroupedGeometry')
        entry.reason = 'geometryInUnassignedGroups';
      else continue;
      entry.item.groupId = group.id;
    }
  }
  for (const { item, reason } of missing.values()) {
    coverage[reason].items.push(item);
    coverage[reason].count++;
  }
  return coverage;
}

export function calculateProject(project: Project): CalculationResult {
  project = takeoffProject(project);
  const takeoff = takeoffContext(project);
  const contributions: CalculationOutput[] = [];
  const measured = new Map<string, Record<string, FormulaValue>>();
  const metrics = (geometry: Geometry) => {
    let variables = measured.get(geometry.id);
    if (!variables) {
      variables = {};
      const measurements = measureGeometry(project, geometry);
      for (const metric of ['length', 'area', 'perimeter', 'count'] as const) {
        const quantity = measurements[metric];
        if (quantity) variables[metric] = formulaQuantity(quantity);
      }
      measured.set(geometry.id, variables);
    }
    return variables;
  };
  const formulas = new Map<string, ReturnType<typeof prepareFormula>>();
  const evaluate = (
    formula: string,
    variables: Record<string, FormulaValue>,
  ) => {
    let prepared = formulas.get(formula);
    if (!prepared) {
      try {
        prepared = prepareFormula(formula);
      } catch (error) {
        // Keep parsing errors behind source validation and repeat their exact text.
        prepared = () => {
          throw error;
        };
      }
      formulas.set(formula, prepared);
    }
    return prepared(variables);
  };
  const definitions = new Map<Recipe, ReturnType<typeof assemblyOutputs>>();
  const assignedKinds = new Map<string, Set<Geometry['kind']>>();
  const emptyAssignments: SourceCoverage['assignmentsWithEmptyGroups']['items'] =
    [];
  let complete = true;
  for (const assignment of Object.values(project.assignments)) {
    const recipe = project.recipes[assignment.recipeId];
    const group = project.groups[assignment.groupId];
    if (!recipe) {
      complete = false;
      continue;
    }
    if (group) {
      const kinds = assignedKinds.get(group.id) ?? new Set<Geometry['kind']>();
      for (const kind of recipe.geometryKinds) kinds.add(kind);
      assignedKinds.set(group.id, kinds);
      if (!group.geometryIds.length)
        emptyAssignments.push({
          assignmentId: assignment.id,
          groupId: group.id,
          recipeId: recipe.id,
        });
    }
    let definition = definitions.get(recipe);
    if (!definition) {
      definition = assemblyOutputs(recipe);
      definitions.set(recipe, definition);
    }
    if (!definition.length) continue;
    const geometryIds = (group?.geometryIds ?? []).filter((id) => {
      const geometry = project.geometries[id];
      return !geometry || recipe.geometryKinds.includes(geometry.kind);
    });
    const baseInputs = effectiveInputs(recipe, assignment);
    const prepared = new Map<
      AssemblyComponent | undefined,
      Map<string, PreparedSource>
    >();
    for (const { output, component } of definition) {
      let sourcesByGeometry = prepared.get(component);
      if (!sourcesByGeometry) {
        sourcesByGeometry = new Map();
        prepared.set(component, sourcesByGeometry);
      }
      const sources = geometryIds.map((id) => {
        let entry = sourcesByGeometry.get(id);
        if (!entry) {
          entry = prepareSource(
            project,
            recipe,
            assignment,
            baseInputs,
            id,
            metrics,
            component,
          );
          sourcesByGeometry.set(id, entry);
        }
        return source(entry, output, id, evaluate);
      });
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
      for (const [key, sources] of buckets) {
        const diagnostics = sources.flatMap((entry) =>
          entry.diagnostic ? [`${entry.geometryId}: ${entry.diagnostic}`] : [],
        );
        if (!group) diagnostics.push('Assignment group is missing');
        if (group?.geometryIds.length && !sources.length)
          diagnostics.push('No compatible drawing objects in this group');
        const override = assignment.allowances[output.id];
        const allowance = override
          ? mergeMaterialSettings(output.allowance, override)
          : output.allowance;
        const baseAmount = sources.reduce(
          (sum, entry) => sum + (entry.value ?? 0),
          0,
        );
        const amounts = purchaseAmount(baseAmount, allowance, !!output.piece);
        diagnostics.push(...amounts.diagnostics);
        const commonCutLength = sources.every(
          (source) =>
            source.cutLength?.value.toPrecision(12) ===
            sources[0]?.cutLength?.value.toPrecision(12),
        )
          ? sources[0]?.cutLength
          : undefined;
        const result: CalculationOutput = {
          ...amounts,
          category: component?.assembly.category ?? recipe.category ?? '',
          direction: assignment.direction ?? 'add',
          ...(allowance.packageSize === undefined
            ? {}
            : { packageSize: allowance.packageSize }),
          quantityKey: JSON.stringify([
            'formula',
            assignment.id,
            output.id,
            key,
          ]),
          modeling: 'estimate',
          groupId: assignment.groupId,
          assignmentId: assignment.id,
          recipeId: recipe.id,
          outputId: output.id,
          materialId: output.materialId,
          name: output.name,
          unit: output.unit,
          sources: sources.map((source) => ({
            ...source,
            outputId: output.id,
            assignmentId: assignment.id,
            recipeId: recipe.id,
            groupId: assignment.groupId,
          })),
          ...(output.piece ? { role: output.piece.role } : {}),
          ...(commonCutLength ? { cutLength: commonCutLength } : {}),
          ...(sources[0]?.stockLength
            ? { stockLength: sources[0].stockLength }
            : {}),
          baseAmount,
          complete: diagnostics.length === 0,
          diagnostics,
        };
        contributions.push(result);
        complete &&= result.complete;
      }
    }
  }
  const model = generateConstruction(project, resolveConstruction(project));
  for (const item of model.surfaces)
    item.direction =
      project.assignments[item.assignmentId ?? '']?.direction ?? 'add';
  for (const assignment of Object.values(project.assignments)) {
    const recipe = project.recipes[assignment.recipeId];
    const group = project.groups[assignment.groupId];
    if (
      (recipe?.wallTemplate ||
        recipe?.ceilingTemplate ||
        recipe?.materialTemplate) &&
      group?.geometryIds.length &&
      !group.geometryIds.some((id) =>
        recipe.geometryKinds.includes(project.geometries[id]?.kind ?? 'count'),
      )
    ) {
      model.diagnostics.push({
        assignmentId: assignment.id,
        recipeId: recipe.id,
        groupId: assignment.groupId,
        code: 'incompatible-geometry',
        message: 'No compatible drawing objects in this modeled assembly group',
      });
      model.complete = false;
    }
  }
  const positioned = modeledOutputs(project, model);
  const outputs = poolOrders([...contributions, ...positioned]);
  complete &&= model.complete;
  const totals = new Map<string, QuantityTotal>();
  const accounted = new Set<string>();
  for (const diagnostic of model.diagnostics)
    if (diagnostic.geometryId) accounted.add(diagnostic.geometryId);
  for (const output of outputs) {
    output.direction ??=
      project.assignments[output.assignmentId]?.direction ?? 'add';
    for (const source of output.sources) {
      source.direction = output.direction;
      accounted.add(source.geometryId);
    }
    const key = JSON.stringify([
      output.materialId,
      ...(output.specialOrder ? ['special'] : []),
      output.orderDetail,
      output.packageSize,
      output.wastePercent,
      output.category,
      output.unit,
      output.stockLength ? null : output.cutLength?.value.toPrecision(12),
      output.stockLength?.value.toPrecision(12),
    ]);
    const total = totals.get(key) ?? {
      materialId: output.materialId,
      ...(output.specialOrder ? { specialOrder: true } : {}),
      ...(output.orderDetail ? { orderDetail: output.orderDetail } : {}),
      ...(output.packageSize === undefined
        ? {}
        : { packageSize: output.packageSize }),
      wastePercent: output.wastePercent,
      ...(output.category === undefined ? {} : { category: output.category }),
      unit: output.unit,
      ...(!output.stockLength && output.cutLength
        ? { cutLength: output.cutLength }
        : {}),
      ...(output.stockLength ? { stockLength: output.stockLength } : {}),
      amount: 0,
      additions: 0,
      deductions: 0,
      complete: true,
    };
    if (output.direction === 'deduct')
      total.deductions += output.purchasedAmount;
    else total.additions += output.purchasedAmount;
    total.amount +=
      output.purchasedAmount * (output.direction === 'deduct' ? -1 : 1);
    if (total.stockLength)
      total.purchasedLength = {
        value: total.amount * total.stockLength.value,
        unit: 'ft',
      };
    total.complete &&= output.complete;
    totals.set(key, total);
  }
  const estimateOutputs = outputs.filter(
    (output) => output.modeling === 'estimate',
  ).length;
  return {
    context: {
      projectId: project.id,
      takeoffId: takeoff.id,
      name: takeoff.name,
      kind: takeoff.kind,
    },
    outputs,
    totals: [...totals.values()],
    complete,
    model,
    sourceCoverage: sourceCoverage(
      project,
      assignedKinds,
      accounted,
      emptyAssignments,
    ),
    coverage: {
      modeledOutputs: outputs.filter((output) => output.modeling === 'modeled')
        .length,
      estimateOutputs,
      complete: complete && estimateOutputs === 0,
    },
  };
}
export function quantityReport(result: CalculationSnapshot, project?: Project) {
  return {
    context: {
      ...result.context,
      ...(project ? { revision: project.revision } : {}),
    },
    outputs: result.outputs,
    totals: result.totals,
    complete: result.complete,
    coverage: result.coverage,
  };
}
export function inspectQuantities(
  result: CalculationSnapshot,
  project: Project,
) {
  const coverage = result.sourceCoverage;
  const named = (list: typeof coverage.ungroupedGeometry) => ({
    count: list.count,
    items: list.items.map((item) => ({
      ...item,
      name: project.geometries[item.geometryId]?.name ?? item.geometryId,
    })),
  });
  return {
    ...quantityReport(result, project),
    sourceCoverage: {
      ungroupedGeometry: named(coverage.ungroupedGeometry),
      geometryInUnassignedGroups: named(coverage.geometryInUnassignedGroups),
      geometryWithIncompatibleRecipes: named(
        coverage.geometryWithIncompatibleRecipes,
      ),
      geometryWithoutOutputOrDiagnostic: named(
        coverage.geometryWithoutOutputOrDiagnostic,
      ),
      assignmentsWithEmptyGroups: coverage.assignmentsWithEmptyGroups,
    },
  };
}
export function exportQuantities(
  project: Project,
  format: 'csv' | 'json',
  result: CalculationSnapshot = calculateProject(project),
): string {
  if (format === 'json')
    return JSON.stringify(quantityReport(result, project), null, 2);
  const rows: (string | number | boolean | null)[][] = [
    [
      'projectId',
      'revision',
      'takeoffKind',
      'takeoffId',
      'takeoffName',
      'direction',
      'modeling',
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
      'cutLength_ft',
      'stockLength_ft',
      'purchaseScope',
      'category',
      'packedCount',
      'purchasedLength_ft',
      'packageSize',
      'quantityKey',
      'installedByAssignment',
      'sourceOutputIds',
    ],
  ];
  for (const output of result.outputs)
    rows.push([
      project.id,
      project.revision,
      result.context?.kind ?? '',
      result.context?.takeoffId ?? '',
      result.context?.name ?? '',
      output.direction ?? 'add',
      output.modeling,
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
      'takeoff',
      output.category ?? project.recipes[output.recipeId]?.category ?? '',
      output.packedCount ?? null,
      output.purchasedLength?.value ?? null,
      output.packageSize ?? null,
      output.quantityKey ?? '',
      output.installedByAssignment
        ? JSON.stringify(output.installedByAssignment)
        : '',
      JSON.stringify([
        ...new Set(
          output.sources.flatMap((s) => (s.outputId ? [s.outputId] : [])),
        ),
      ]),
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
  result: CalculationSnapshot = calculateProject(project),
) {
  return result.outputs
    .filter((output) => output.role !== undefined)
    .flatMap((output) => {
      const common = {
        projectId: project.id,
        revision: project.revision,
        takeoffName: result.context?.name ?? '',
        takeoffKind: result.context?.kind ?? '',
        takeoffId: result.context?.takeoffId ?? '',
        direction: output.direction ?? 'add',
        outputId: output.outputId,
        materialId: output.materialId,
        modeling: output.modeling,
        category:
          output.category ?? project.recipes[output.recipeId]?.category ?? '',
      };
      const installed = output.sources.map((source) => {
        const geometry = project.geometries[source.geometryId];
        const groupId = source.groupId ?? output.groupId;
        const recipeId = source.recipeId ?? output.recipeId;
        const modeling = source.pieceId
          ? ('modeled' as const)
          : output.modeling;
        return {
          ...common,
          outputId: source.outputId ?? output.outputId,
          modeling,
          recordType: modeling === 'estimate' ? 'estimate' : 'installed',
          sheet: project.sheets[geometry?.sheetId ?? '']?.name ?? '',
          geometryId: source.geometryId,
          location: geometry?.name ?? source.geometryId,
          group: project.groups[groupId]?.name ?? groupId,
          assignmentId: source.assignmentId ?? output.assignmentId,
          assembly: project.recipes[recipeId]?.name ?? recipeId,
          role: source.pieceRole ?? output.role ?? '',
          pieceId: source.pieceId ?? '',
          quantity: source.value,
          cutLength_ft: source.cutLength?.value ?? null,
          stockLength_ft: source.stockLength?.value ?? null,
          complete: source.value !== null && output.complete,
          diagnostic: source.diagnostic ?? output.diagnostics.join('; '),
        };
      });
      const rows: ((typeof installed)[number] & {
        packedCount?: number;
        wastePercent?: number;
        adjustedCount?: number;
        purchasedCount?: number;
        purchasedLength_ft?: number;
      })[] = installed;
      if (output.packedCount !== undefined && output.stockLength)
        rows.push({
          ...common,
          recordType: 'stock-purchase',
          sheet: '',
          geometryId: '',
          location: '',
          group: '',
          assignmentId: '',
          assembly: '',
          role: '',
          pieceId: '',
          quantity: null,
          cutLength_ft: null,
          stockLength_ft: output.stockLength.value,
          packedCount: output.packedCount,
          wastePercent: output.wastePercent,
          adjustedCount: output.adjustedAmount,
          purchasedCount: output.purchasedAmount,
          purchasedLength_ft: output.purchasedAmount * output.stockLength.value,
          complete: output.complete,
          diagnostic: output.diagnostics.join('; '),
        });
      return rows;
    });
}
export function exportPieces(
  project: Project,
  format: 'csv' | 'json',
  result: CalculationSnapshot = calculateProject(project),
): string {
  const rows = pieceSchedule(project, result);
  if (format === 'json')
    return JSON.stringify(
      { context: { ...result.context, revision: project.revision }, rows },
      null,
      2,
    );
  const keys = [
    'projectId',
    'revision',
    'takeoffName',
    'takeoffKind',
    'takeoffId',
    'direction',
    'sheet',
    'geometryId',
    'location',
    'group',
    'assignmentId',
    'outputId',
    'assembly',
    'materialId',
    'role',
    'modeling',
    'pieceId',
    'quantity',
    'cutLength_ft',
    'stockLength_ft',
    'recordType',
    'category',
    'packedCount',
    'wastePercent',
    'adjustedCount',
    'purchasedCount',
    'purchasedLength_ft',
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
