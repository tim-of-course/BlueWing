import { quantityLabel } from './quantity-label';
import { formatLength } from '../core/length';
import PieceSchedule, { displayLength } from './PieceSchedule';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { presentQuantities } from '../core/quantity-presentation';
import { inspectReview } from '../core/review';
import type { WorkspaceController } from '../app/contracts';
const formatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 3,
});
const number = (value: number) => formatter.format(value);
const coverageReasons = [
  ['ungroupedGeometry', 'No group'],
  ['geometryInUnassignedGroups', 'No assembly assigned to any group'],
  [
    'geometryWithIncompatibleRecipes',
    'Drawing type incompatible with all assigned assemblies',
  ],
  [
    'geometryWithoutOutputOrDiagnostic',
    'Compatible assembly produced no output or diagnostic',
  ],
] as const;
export default function Quantities(props: {
  controller: WorkspaceController;
  onError: (message: string) => void;
  onShowDrawing: () => void;
  navigationDisabled?: boolean;
}) {
  const [filter, setFilter] = createSignal('');
  const [coverageOpen, setCoverageOpen] = createSignal(false);
  const coverage = () => props.controller.quantities()?.sourceCoverage;
  const uncoveredCount = createMemo(() => {
    const current = coverage();
    return current
      ? coverageReasons.reduce((sum, [key]) => sum + current[key].count, 0)
      : 0;
  });
  const emptyCount = () => coverage()?.assignmentsWithEmptyGroups.count ?? 0;
  const reviewMarks = createMemo(() => {
    const project = props.controller.project();
    return project ? inspectReview(project).marks : [];
  });
  const entries = createMemo(() => {
    const project = props.controller.project();
    const result = props.controller.quantities();
    return project && result ? presentQuantities(project, result) : [];
  });
  const exportFile = (format: 'csv' | 'json') => {
    const report = props.onError;
    void props.controller.exportQuantities(format).catch((cause: unknown) => {
      report(cause instanceof Error ? cause.message : String(cause));
    });
  };
  return (
    <section class="quantities">
      <div class="panel-heading">
        <div>
          <h1>
            Quantities ·{' '}
            {
              props.controller.project()?.takeoffs[
                props.controller.project()?.takeoffId ?? 'main'
              ]?.name
            }
          </h1>
          <p>Trace each output to its group and drawing sources.</p>
        </div>
        <div class="button-row">
          <button
            type="button"
            onClick={() => {
              const report = props.onError;
              void props.controller
                .exportEstiMaker()
                .catch((cause: unknown) => {
                  report(
                    cause instanceof Error ? cause.message : String(cause),
                  );
                });
            }}
          >
            Export to EstiMaker
          </button>
          <button
            type="button"
            onClick={() => {
              const report = props.onError;
              void props.controller.exportPieces().catch((cause: unknown) => {
                report(cause instanceof Error ? cause.message : String(cause));
              });
            }}
          >
            Export piece CSV
          </button>
          <button
            type="button"
            disabled={props.navigationDisabled}
            onClick={() => {
              exportFile('csv');
            }}
          >
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => {
              exportFile('json');
            }}
          >
            Export JSON
          </button>
        </div>
      </div>
      <Show when={props.controller.quantities()}>
        {(result) => (
          <>
            <p class="muted" role="status">
              {result().coverage.modeledOutputs} material outputs measured from
              3D pieces or surfaces. {result().coverage.estimateOutputs} formula
              estimates have no 3D placement. Waste and packaging are separate
              purchasing allowances.
            </p>
            <Show when={uncoveredCount() || emptyCount()}>
              <details
                onToggle={(event) => setCoverageOpen(event.currentTarget.open)}
              >
                <summary>
                  <Show when={uncoveredCount()}>
                    {uncoveredCount()} drawn{' '}
                    {uncoveredCount() === 1 ? 'item is' : 'items are'} not in
                    any quantity
                  </Show>
                  {uncoveredCount() && emptyCount() ? ' · ' : ''}
                  <Show when={emptyCount()}>
                    {emptyCount()}{' '}
                    {emptyCount() === 1
                      ? 'assignment has an empty group'
                      : 'assignments have empty groups'}
                  </Show>
                </summary>
                <Show when={coverageOpen()}>
                  <For each={coverageReasons}>
                    {([key, reason]) => (
                      <Show when={result().sourceCoverage[key].count}>
                        <p>
                          {reason} ({result().sourceCoverage[key].count})
                        </p>
                        <ul>
                          <For each={result().sourceCoverage[key].items}>
                            {(item) => (
                              <li>
                                <button
                                  type="button"
                                  disabled={props.navigationDisabled}
                                  onClick={() => {
                                    props.controller.showGeometry(
                                      item.geometryId,
                                      item.groupId ?? '',
                                    );
                                    props.onShowDrawing();
                                  }}
                                >
                                  {props.controller.project()?.geometries[
                                    item.geometryId
                                  ]?.name ?? item.geometryId}
                                </button>{' '}
                                {props.controller.project()?.sheets[
                                  item.sheetId
                                ]?.name ?? item.sheetId}{' '}
                                · {item.kind}
                              </li>
                            )}
                          </For>
                        </ul>
                      </Show>
                    )}
                  </For>
                  <Show when={emptyCount()}>
                    <p>Assignments to empty groups ({emptyCount()})</p>
                    <ul>
                      <For
                        each={
                          result().sourceCoverage.assignmentsWithEmptyGroups
                            .items
                        }
                      >
                        {(item) => (
                          <li>
                            {props.controller.project()?.groups[item.groupId]
                              ?.name ?? item.groupId}
                            {' / '}
                            {props.controller.project()?.recipes[item.recipeId]
                              ?.name ?? item.recipeId}
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </Show>
              </details>
            </Show>
            <Show when={!result().complete}>
              <p class="warning" role="status">
                Totals are incomplete. Review the diagnostics below before using
                these quantities.
              </p>
            </Show>
            <table>
              <caption>Material totals</caption>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Quantity</th>
                  <th>Category</th>
                  <th>Pieces / size</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <For each={entries()}>
                  {(entry) => (
                    <tr>
                      <td>
                        {entry.output.packedCount === undefined
                          ? (entry.row?.description ?? entry.description)
                          : entry.description}
                        <br />
                        <small>
                          {entry.output.direction ?? 'add'} ·{' '}
                          {entry.output.materialId} ·{' '}
                          {entry.output.packedCount !== undefined
                            ? 'Takeoff stock order'
                            : props.controller.project()?.groups[
                                entry.output.groupId
                              ]?.name}
                        </small>
                      </td>
                      <td>
                        {entry.row
                          ? quantityLabel(entry.row.quantity, entry.row.unit)
                          : entry.output.complete
                            ? quantityLabel(
                                entry.output.purchasedAmount,
                                entry.output.unit,
                              )
                            : 'Unavailable'}
                        <Show
                          when={
                            entry.row && entry.output.packedCount === undefined
                          }
                        >
                          <br />
                          <small>
                            {quantityLabel(
                              entry.output.purchasedAmount,
                              entry.output.unit,
                            )}
                          </small>
                        </Show>
                      </td>
                      <td>
                        {entry.category || '—'}
                        <details>
                          <summary>Order breakdown</summary>
                          <ul>
                            <For each={entry.subItems}>
                              {(line) => (
                                <li>
                                  {line.subItem.label} ·{' '}
                                  {quantityLabel(line.quantity, line.unit)}
                                  {line.packageQuantity === undefined
                                    ? ''
                                    : ' · ' +
                                      number(line.packageQuantity) +
                                      ' ' +
                                      (entry.output.packageKind ?? 'packages')}
                                </li>
                              )}
                            </For>
                          </ul>
                        </details>
                      </td>
                      <td>
                        {entry.output.packageKind
                          ? number(entry.output.packageCount ?? 0) +
                            ' ' +
                            entry.output.packageKind
                          : entry.output.packedCount !== undefined
                            ? `${number(entry.output.purchasedAmount)} sticks × `
                            : entry.row?.pieceCount !== undefined
                              ? number(entry.row.pieceCount) +
                                (entry.row.pieceLength ? ' pc × ' : ' packages')
                              : ''}
                        {entry.output.stockLength || entry.output.cutLength
                          ? displayLength(
                              entry.output.stockLength ??
                                entry.output.cutLength,
                            )
                          : entry.row?.pieceCount === undefined
                            ? '—'
                            : ''}
                        <Show when={entry.output.packedCount !== undefined}>
                          <br />
                          <small>
                            {number(entry.output.packedCount ?? 0)} packed +{' '}
                            {number(entry.output.wastePercent)}% waste
                            {entry.output.packageCount === null
                              ? ''
                              : ` · ${number(entry.output.packageCount)} packages`}
                          </small>
                        </Show>
                      </td>
                      <td>
                        {!entry.output.complete ? 'Incomplete · ' : ''}
                        {entry.issue
                          ? entry.issue.reason
                          : entry.output.modeling === 'estimate'
                            ? 'Formula estimate · no 3D placement'
                            : 'Calculated'}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
            <Show when={result().context?.kind === 'change-order'}>
              <table>
                <caption>
                  Gross additions, deductions and signed net by material
                </caption>
                <thead>
                  <tr>
                    <th>Material</th>
                    <th>Additions</th>
                    <th>Deductions</th>
                    <th>Net</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={result().totals}>
                    {(total) => (
                      <tr>
                        <td>
                          {total.materialId}
                          {total.orderDetail && ', ' + total.orderDetail} (
                          {total.unit})
                          {total.category && ` · ${total.category}`}
                        </td>
                        <For
                          each={[
                            total.additions,
                            total.deductions,
                            total.amount,
                          ]}
                        >
                          {(count) => (
                            <td>
                              {total.unit === 'ft' || total.unit === 'in'
                                ? quantityLabel(count, total.unit)
                                : number(count)}
                              <Show when={total.stockLength}>
                                {(stock) => (
                                  <>
                                    {' '}
                                    × {displayLength(stock())} ={' '}
                                    {formatLength(count * stock().value)}
                                  </>
                                )}
                              </Show>
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
            <Show when={props.controller.project()}>
              {(project) => (
                <PieceSchedule project={project()} result={result()} />
              )}
            </Show>
            <label class="field quantity-filter">
              Filter source breakdowns
              <input
                type="search"
                placeholder="Group, material or output…"
                value={filter()}
                onInput={(event) => setFilter(event.currentTarget.value)}
              />
            </label>
            <For
              keyed={(entry) =>
                entry.output.quantityKey ??
                JSON.stringify([
                  entry.output.assignmentId,
                  entry.output.outputId,
                ])
              }
              each={entries().filter(
                (entry) =>
                  !filter().trim() ||
                  [
                    entry.description,
                    entry.category,
                    entry.output.materialId,
                    ...(entry.output.installedByAssignment ?? []).map(
                      (item) =>
                        props.controller.project()?.groups[item.groupId]
                          ?.name ?? '',
                    ),
                    props.controller.project()?.groups[entry.output.groupId]
                      ?.name ?? '',
                  ]
                    .join(' ')
                    .toLowerCase()
                    .includes(filter().trim().toLowerCase()),
              )}
              fallback={
                <p class="muted">
                  {filter().trim()
                    ? 'No source breakdowns match.'
                    : 'Assign an assembly to a group to calculate quantities.'}
                </p>
              }
            >
              {(entry) => {
                const output = () => entry().output;
                return (
                  <details class="quantity-output">
                    <summary>
                      <strong>
                        {output().packedCount !== undefined
                          ? 'Installed cuts'
                          : (props.controller.project()?.groups[
                              output().groupId
                            ]?.name ?? output().groupId)}{' '}
                        /{' '}
                        {output().packedCount !== undefined
                          ? entry().description
                          : (entry().row?.description ?? entry().description)}
                      </strong>
                      <span>
                        <Show
                          when={output().packedCount === undefined}
                          fallback={`${number(output().baseAmount)} cuts`}
                        >
                          <Show
                            when={entry().row}
                            fallback={
                              output().complete
                                ? quantityLabel(
                                    output().purchasedAmount,
                                    output().unit,
                                  )
                                : 'Incomplete'
                            }
                          >
                            {(row) => (
                              <>{quantityLabel(row().quantity, row().unit)}</>
                            )}
                          </Show>
                        </Show>
                      </span>
                    </summary>
                    <Show when={entry().issue}>
                      {(issue) => (
                        <p class="warning">
                          Cannot export: {issue().reason} ({issue().code})
                        </p>
                      )}
                    </Show>
                    <Show
                      when={
                        output().packedCount === undefined &&
                        entry().row?.cutSchedule?.length
                      }
                    >
                      <p class="muted">
                        Required cuts (before waste/packages):{' '}
                        {entry()
                          .row?.cutSchedule?.map(
                            (cut) =>
                              `${number(cut.count)} pc × ${displayLength(cut.length)}`,
                          )
                          .join('; ')}
                        . Purchases use{' '}
                        {entry().row?.provenance.physicalLengthSource} length
                        once per purchased piece.
                      </p>
                    </Show>
                    <p class="muted">
                      <Show when={output().recipeId}>
                        Assembly:{' '}
                        {props.controller.project()?.recipes[output().recipeId]
                          ?.name ?? output().recipeId}{' '}
                        ·{' '}
                      </Show>
                      Material: {output().materialId}
                      {' · '}
                      {output().modeling === 'modeled'
                        ? 'Measured from 3D'
                        : output().modeling === 'estimate'
                          ? 'Estimate only · no 3D placement'
                          : 'Model incomplete'}
                    </p>
                    <Show when={output().cutLength}>
                      <p class="muted">
                        {output().role} · Cut:{' '}
                        {displayLength(output().cutLength)} · Stock:{' '}
                        {displayLength(output().stockLength)}
                      </p>
                    </Show>
                    <For each={output().installedByAssignment}>
                      {(item) => (
                        <p>
                          {props.controller.project()?.groups[item.groupId]
                            ?.name ?? item.groupId}{' '}
                          /{' '}
                          {props.controller.project()?.recipes[item.recipeId]
                            ?.name ?? item.recipeId}{' '}
                          · {number(item.pieceCount)} cuts ·{' '}
                          {formatLength(item.cutLength.value)} installed
                        </p>
                      )}
                    </For>
                    <Show when={output().packedCount === undefined}>
                      <dl class="quantity-breakdown">
                        <div>
                          <dt>Net / base</dt>
                          <dd>
                            {quantityLabel(output().baseAmount, output().unit)}
                          </dd>
                        </div>
                        <Show when={output().grossArea !== undefined}>
                          <div>
                            <dt>Waste from openings</dt>
                            <dd>
                              {number(output().openingArea ?? 0)} SF (
                              {number(
                                ((output().openingArea ?? 0) * 100) /
                                  (output().grossArea || 1),
                              )}
                              % of gross)
                            </dd>
                          </div>
                        </Show>
                        <div>
                          <dt>Waste ({number(output().wastePercent)}%)</dt>
                          <dd>
                            {quantityLabel(output().wasteAmount, output().unit)}
                          </dd>
                        </div>
                        <div>
                          <dt>With waste</dt>
                          <dd>
                            {quantityLabel(
                              output().adjustedAmount,
                              output().unit,
                            )}
                          </dd>
                        </div>
                        <Show when={output().orderArea !== undefined}>
                          <div>
                            <dt>Order area before waste</dt>
                            <dd>{number(output().orderArea ?? 0)} SF</dd>
                          </div>
                        </Show>
                        <Show when={output().packageCount !== null}>
                          <div>
                            <dt>{output().packageKind ?? 'Packages'}</dt>
                            <dd>{output().packageCount}</dd>
                          </div>
                        </Show>
                        <div>
                          <dt>Purchased</dt>
                          <dd>
                            {quantityLabel(
                              output().purchasedAmount,
                              output().unit,
                            )}
                          </dd>
                        </div>
                      </dl>
                    </Show>
                    <For each={output().diagnostics}>
                      {(message) => <p class="warning">{message}</p>}
                    </For>
                    <table>
                      <caption>Drawing contributions</caption>
                      <thead>
                        <tr>
                          <th>Source</th>
                          <th>Inputs</th>
                          <th>Base contribution</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For
                          each={output().sources.slice(0, 300)}
                          keyed={(source) =>
                            source.pieceId ??
                            source.surfaceId ??
                            JSON.stringify([
                              source.assignmentId,
                              source.outputId,
                              source.geometryId,
                            ])
                          }
                        >
                          {(source) => (
                            <tr>
                              <td>
                                <button
                                  type="button"
                                  disabled={
                                    props.navigationDisabled ||
                                    !source().geometryId
                                  }
                                  onClick={() => {
                                    const geometry =
                                      props.controller.project()?.geometries[
                                        source().geometryId
                                      ];
                                    if (geometry) {
                                      props.controller.showGeometry(
                                        geometry.id,
                                        source().groupId ?? output().groupId,
                                      );
                                      props.onShowDrawing();
                                    }
                                  }}
                                >
                                  {props.controller.project()?.geometries[
                                    source().geometryId
                                  ]?.name ?? source().geometryId}
                                </button>
                                <For
                                  each={reviewMarks().filter(
                                    (mark) =>
                                      mark.target.kind === 'geometry' &&
                                      mark.target.id === source().geometryId,
                                  )}
                                >
                                  {(mark) => (
                                    <small> · {mark.effectiveStatus}</small>
                                  )}
                                </For>
                              </td>
                              <td>
                                {Object.entries(source().inputs)
                                  .map(([key, value]) => {
                                    const unit = entry().inputDefinitions.find(
                                      (input) => input.name === key,
                                    )?.unit;
                                    const text =
                                      typeof value === 'number' &&
                                      (unit === 'ft' || unit === 'in')
                                        ? quantityLabel(value, unit)
                                        : String(value);
                                    return key + ': ' + text;
                                  })
                                  .join(', ') || '—'}
                              </td>
                              <td>
                                {source().value === null
                                  ? (source().diagnostic ?? 'Unavailable')
                                  : quantityLabel(
                                      source().value ?? 0,
                                      output().unit,
                                    )}
                                <Show when={source().cutLength}>
                                  {(cut) => <> × {displayLength(cut())}</>}
                                </Show>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                    <Show when={output().sources.length > 300}>
                      <p class="muted">
                        Showing 300 of {output().sources.length} contributions.
                        Exports include every contribution.
                      </p>
                    </Show>
                  </details>
                );
              }}
            </For>
          </>
        )}
      </Show>
    </section>
  );
}
