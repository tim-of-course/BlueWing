import type { CalculationSnapshot } from './calculation-state';
import type { LengthUnit, Project, Quantity } from './types';
import { assemblyOutputs } from './systems';

type Output = CalculationSnapshot['outputs'][number];
export interface PhysicalLength {
  value: number;
  unit: LengthUnit;
}
export interface QuantitySourceIdentity {
  groupId: string | null;
  groupLabel: string | null;
  assignmentId: string | null;
  recipeId: string | null;
  outputId: string | null;
  materialId: string | null;
}
export interface QuantitySourceRef {
  geometryId: string | null;
  sheetId: string | null;
  pieceId: string | null;
  surfaceId: string | null;
}
export interface TakeoffRow {
  lineId: string;
  baseDescription: string;
  description: string;
  quantity: number;
  unit: 'LF' | 'SF' | 'count';
  category: string;
  source: QuantitySourceIdentity;
  pieceCount?: number;
  pieceLength?: PhysicalLength;
  cutSchedule?: { count: number; length: PhysicalLength }[];
  provenance: {
    basis: 'purchased';
    originalAmount: number | null;
    originalUnit: Output['unit'];
    physicalLengthSource?: 'stock' | 'cut';
    sourceRefs: QuantitySourceRef[];
    modelingStatus: Output['modeling'];
  };
}
/** Producer issues for Bluewing's UI; these never become imported placeholder items. */
export interface QuantityIssue {
  lineId: string | null;
  baseDescription: string;
  description: string;
  category: string;
  provenance: {
    basis: 'purchased';
    originalAmount: number | null;
    originalUnit: Output['unit'] | null;
    modelingStatus: Output['modeling'];
  };
  source: QuantitySourceIdentity;
  sourceRefs: QuantitySourceRef[];
  code:
    | 'incomplete'
    | 'unresolved'
    | 'invalid-quantity'
    | 'invalid-stock-length'
    | 'missing-physical-length'
    | 'unsupported-unit'
    | 'missing-line-identity';
  reason: string;
  diagnostics: string[];
}
export interface TakeoffEnvelope {
  kind: 'bluewing.takeoff';
  version: 1;
  project: { id: string; name: string; revision: string };
  exportedAt: string;
  calculationComplete: boolean;
  coverage: {
    modeledOutputs: number;
    estimateOutputs: number;
    unresolvedOutputs: number;
    complete: boolean;
  };
  rows: TakeoffRow[];
}

const metres: Record<LengthUnit, number> = {
  m: 1,
  mm: 0.001,
  ft: 0.3048,
  in: 0.0254,
};
export function lengthInFeet(length: Quantity): number | undefined {
  if (
    !(length.unit in metres) ||
    !Number.isFinite(length.value) ||
    length.value <= 0
  )
    return undefined;
  return (length.value * metres[length.unit as LengthUnit]) / metres.ft;
}
const number = (value: number) => String(Number(value.toPrecision(12)));

/** UI labels always read current project metadata, even when its calculation is cached. */
export function quantityLabel(project: Project, output: Output) {
  const recipe = project.recipes[output.recipeId];
  const definition = recipe
    ? assemblyOutputs(recipe).find(
        ({ output: entry }) => entry.id === output.outputId,
      )
    : undefined;
  return {
    description:
      definition?.output.name ??
      (output.modeling === 'modeled'
        ? `${output.materialId.replaceAll(/[-_]/g, ' ')}${output.role ? ` · ${output.role.replaceAll(/[-_]/g, ' ')}` : ''}`
        : output.name),
    category:
      definition?.component?.assembly.category ?? recipe?.category ?? '',
  };
}

/** One projection per existing engine bucket: never reapply waste, round, or split purchases. */
export function presentQuantities(
  project: Project,
  result: CalculationSnapshot,
) {
  return result.outputs.map((output) => {
    const label = quantityLabel(project, output);
    const source: QuantitySourceIdentity = {
      groupId: output.groupId || null,
      groupLabel: project.groups[output.groupId]?.name ?? null,
      assignmentId: output.assignmentId || null,
      recipeId: output.recipeId || null,
      outputId: output.modeling === 'estimate' ? output.outputId || null : null,
      materialId:
        output.modeling === 'unresolved' ? null : output.materialId || null,
    };
    const sourceRefs = output.sources.map((entry): QuantitySourceRef => ({
      geometryId: entry.geometryId || null,
      sheetId: project.geometries[entry.geometryId]?.sheetId ?? null,
      pieceId: entry.pieceId ?? null,
      surfaceId: entry.surfaceId ?? null,
    }));
    const lineId = output.quantityKey
      ? `bwq1:${encodeURIComponent(output.quantityKey)}`
      : null;
    const skip = (code: QuantityIssue['code'], reason: string) => ({
      output,
      ...label,
      row: null,
      issue: {
        lineId,
        baseDescription: label.description,
        description: label.description,
        category: label.category,
        provenance: {
          basis: 'purchased',
          originalAmount:
            output.modeling !== 'unresolved' &&
            Number.isFinite(output.purchasedAmount) &&
            (output.complete ||
              output.sources.some(
                (source) =>
                  source.value !== null && Number.isFinite(source.value),
              ))
              ? output.purchasedAmount
              : null,
          originalUnit: output.modeling === 'unresolved' ? null : output.unit,
          modelingStatus: output.modeling,
        },
        source,
        sourceRefs,
        code,
        reason,
        diagnostics: [...output.diagnostics],
      } satisfies QuantityIssue,
    });
    if (output.modeling === 'unresolved')
      return skip(
        'unresolved',
        'Resolve this assembly or drawing source before exporting.',
      );
    if (!lineId)
      return skip(
        'missing-line-identity',
        'Recalculate this output to obtain its semantic purchase bucket identity.',
      );
    const recipe = project.recipes[output.recipeId];
    const definition = recipe
      ? assemblyOutputs(recipe).find(
          ({ output: item }) => item.id === output.outputId,
        )
      : undefined;
    const dimensionedPiece =
      output.unit === 'ea' &&
      (definition?.output.piece !== undefined ||
        output.modeling === 'modeled' ||
        output.role !== undefined ||
        output.stockLength != null ||
        output.cutLength != null);
    const requiredInputs =
      definition?.component?.assembly.inputs ?? recipe?.inputs ?? [];
    const missingInput = output.sources.some((entry) =>
      requiredInputs.some(
        (input) =>
          input.type === 'number' &&
          (input.unit in metres ||
            input.unit === 'ft2' ||
            input.unit === 'm2') &&
          entry.inputs[input.name] === undefined &&
          input.default === undefined,
      ),
    );
    const missingCalibration =
      !output.complete &&
      output.unit !== 'scalar' &&
      (output.unit !== 'ea' || dimensionedPiece) &&
      output.sources.some((entry) => {
        const geometry = project.geometries[entry.geometryId];
        return (
          geometry &&
          geometry.kind !== 'count' &&
          !project.sheets[geometry.sheetId]?.calibration
        );
      });
    const missingPieceLength =
      dimensionedPiece &&
      output.complete &&
      output.stockLength == null &&
      output.cutLength == null;
    // A known material with missing dimensions is deliberately import-ready at zero.
    // EstiMaker receives descriptions and numbers, not a second validity workflow.
    if (
      output.unit !== 'scalar' &&
      (missingInput || missingCalibration || missingPieceLength)
    ) {
      const unit: TakeoffRow['unit'] =
        output.unit === 'ft2' || output.unit === 'm2'
          ? 'SF'
          : output.unit === 'ea' && !dimensionedPiece
            ? 'count'
            : 'LF';
      const row: TakeoffRow = {
        lineId,
        baseDescription: label.description,
        description: `${label.description} (missing quantity)`,
        quantity: 0,
        unit,
        category: label.category,
        source,
        provenance: {
          basis: 'purchased',
          originalAmount: null,
          originalUnit: output.unit,
          sourceRefs,
          modelingStatus: output.modeling,
        },
      };
      return { output, ...label, row, issue: null };
    }
    if (
      !output.complete ||
      output.sources.some((entry) => entry.value === null || entry.diagnostic)
    )
      return skip(
        'incomplete',
        'Correct the calculation diagnostics on this assignment or drawing source.',
      );
    if (!Number.isFinite(output.purchasedAmount) || output.purchasedAmount < 0)
      return skip(
        'invalid-quantity',
        'Purchased quantity must be finite and nonnegative.',
      );
    let quantity: number;
    let unit: TakeoffRow['unit'];
    let pieces: Pick<TakeoffRow, 'pieceCount' | 'pieceLength' | 'cutSchedule'> =
      {};
    let physicalLengthSource: 'stock' | 'cut' | undefined;
    let description = label.description;
    if (output.unit === 'ea' && !dimensionedPiece) {
      quantity = output.purchasedAmount;
      unit = 'count';
      description = `${label.description} (count)`;
    } else if (output.unit === 'ea') {
      // Missing stock permits a cut; supplied invalid stock never selects cut instead.
      const hasStock = output.stockLength != null;
      const length = hasStock ? output.stockLength : output.cutLength;
      const feet = length ? lengthInFeet(length) : undefined;
      if (!length || feet === undefined)
        return skip(
          hasStock ? 'invalid-stock-length' : 'missing-physical-length',
          'Enter a positive physical stock length, or a cut length when no stock is supplied.',
        );
      physicalLengthSource = hasStock ? 'stock' : 'cut';
      quantity = output.purchasedAmount * feet;
      description = `${label.description} · ${number(feet)}ft (${number(output.purchasedAmount)}pc)`;
      unit = 'LF';
      const schedule = new Map<
        string,
        { count: number; length: PhysicalLength }
      >();
      for (const entry of output.sources) {
        if (
          !entry.cutLength ||
          lengthInFeet(entry.cutLength) === undefined ||
          entry.value === null
        )
          continue;
        const key = JSON.stringify(entry.cutLength);
        const cut = schedule.get(key) ?? {
          count: 0,
          length: {
            value: entry.cutLength.value,
            unit: entry.cutLength.unit as LengthUnit,
          },
        };
        cut.count += entry.value;
        schedule.set(key, cut);
      }
      pieces = {
        pieceCount: output.purchasedAmount,
        pieceLength: { value: length.value, unit: length.unit as LengthUnit },
        cutSchedule: [...schedule.values()],
      };
    } else if (output.unit in metres) {
      quantity =
        (output.purchasedAmount * metres[output.unit as LengthUnit]) /
        metres.ft;
      unit = 'LF';
    } else if (output.unit === 'm2' || output.unit === 'ft2') {
      quantity =
        output.unit === 'm2'
          ? output.purchasedAmount / 0.09290304
          : output.purchasedAmount;
      unit = 'SF';
    } else
      return skip(
        'unsupported-unit',
        'This output has no physical LF/SF dimension. Use a length, area, or dimensioned piece output.',
      );
    if (!Number.isFinite(quantity))
      return skip(
        'invalid-quantity',
        'Converted purchased quantity is not finite.',
      );
    const row: TakeoffRow = {
      lineId,
      baseDescription: label.description,
      description,
      quantity,
      unit,
      category: label.category,
      source,
      ...pieces,
      provenance: {
        basis: 'purchased',
        originalAmount: output.purchasedAmount,
        originalUnit: output.unit,
        ...(physicalLengthSource ? { physicalLengthSource } : {}),
        sourceRefs,
        modelingStatus: output.modeling,
      },
    };
    return { output, ...label, row, issue: null };
  });
}

export function estiMakerTakeoff(
  project: Project,
  result: CalculationSnapshot,
  exportedAt = new Date().toISOString(),
): TakeoffEnvelope {
  const entries = presentQuantities(project, result);
  if (!project.id.trim())
    throw new Error('EstiMaker export requires a project identity.');
  const issues = entries.flatMap((entry) => (entry.issue ? [entry.issue] : []));
  if (issues.length)
    throw new Error(
      `Cannot export to EstiMaker: ${issues.map((issue) => `${issue.description}: ${issue.reason}`).join('; ')}`,
    );
  const rows = entries.flatMap((entry) => (entry.row ? [entry.row] : []));
  if (new Set(rows.map((row) => row.lineId)).size !== rows.length)
    throw new Error('EstiMaker export contains duplicate line identities.');
  return {
    kind: 'bluewing.takeoff',
    version: 1,
    project: {
      id: project.id,
      name: project.name,
      revision: String(project.revision),
    },
    exportedAt,
    calculationComplete: result.complete,
    coverage: {
      ...result.coverage,
      unresolvedOutputs: result.outputs.filter(
        (output) => output.modeling === 'unresolved',
      ).length,
    },
    rows,
  };
}
