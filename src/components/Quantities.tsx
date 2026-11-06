import PieceSchedule, { displayLength } from './PieceSchedule';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { presentQuantities } from '../core/quantity-presentation';
import { inspectReview } from '../core/review';
import type { WorkspaceController } from '../app/contracts';
const formatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 3,
});
const number = (value: number) => formatter.format(value);
export default function Quantities(props: {
  controller: WorkspaceController;
  onError: (message: string) => void;
  onShowDrawing: () => void;
  navigationDisabled?: boolean;
}) {
  const [filter, setFilter] = createSignal('');
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
          <h1>Quantities</h1>
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
                        {entry.row?.description ?? entry.description}
                        <br />
                        <small>
                          {entry.output.materialId} ·{' '}
                          {
                            props.controller.project()?.groups[
                              entry.output.groupId
                            ]?.name
                          }
                        </small>
                      </td>
                      <td>
                        {entry.row
                          ? `${number(entry.row.quantity)} ${entry.row.unit}`
                          : entry.output.complete
                            ? `${number(entry.output.purchasedAmount)} ${entry.output.unit}`
                            : 'Unavailable'}
                        <Show when={entry.row}>
                          <br />
                          <small>
                            {number(entry.output.purchasedAmount)}{' '}
                            {entry.output.unit}
                          </small>
                        </Show>
                      </td>
                      <td>{entry.category || '—'}</td>
                      <td>
                        {entry.row?.pieceCount !== undefined
                          ? `${number(entry.row.pieceCount)} pc × `
                          : ''}
                        {displayLength(
                          entry.output.stockLength ?? entry.output.cutLength,
                        )}
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
                        {props.controller.project()?.groups[output().groupId]
                          ?.name ?? output().groupId}{' '}
                        / {entry().row?.description ?? entry().description}
                      </strong>
                      <span>
                        <Show
                          when={entry().row}
                          fallback={
                            output().complete
                              ? `${number(output().purchasedAmount)} ${output().unit}`
                              : 'Incomplete'
                          }
                        >
                          {(row) => (
                            <>
                              {number(row().quantity)} {row().unit}
                            </>
                          )}
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
                    <Show when={entry().row?.cutSchedule?.length}>
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
                      Assembly:{' '}
                      {props.controller.project()?.recipes[output().recipeId]
                        ?.name ?? output().recipeId}{' '}
                      · Material: {output().materialId}
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
                    <dl class="quantity-breakdown">
                      <div>
                        <dt>Net / base</dt>
                        <dd>
                          {number(output().baseAmount)} {output().unit}
                        </dd>
                      </div>
                      <div>
                        <dt>Waste ({number(output().wastePercent)}%)</dt>
                        <dd>
                          {number(output().wasteAmount)} {output().unit}
                        </dd>
                      </div>
                      <div>
                        <dt>With waste</dt>
                        <dd>
                          {number(output().adjustedAmount)} {output().unit}
                        </dd>
                      </div>
                      <Show when={output().packageCount !== null}>
                        <div>
                          <dt>Packages</dt>
                          <dd>{output().packageCount}</dd>
                        </div>
                      </Show>
                      <div>
                        <dt>Purchased</dt>
                        <dd>
                          {number(output().purchasedAmount)} {output().unit}
                        </dd>
                      </div>
                    </dl>
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
                            source.pieceId ?? source.geometryId
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
                                        output().groupId,
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
                                  .map(
                                    ([key, value]) =>
                                      `${key}: ${String(value)}`,
                                  )
                                  .join(', ') || '—'}
                              </td>
                              <td>
                                {source().value === null
                                  ? (source().diagnostic ?? 'Unavailable')
                                  : `${number(source().value ?? 0)} ${output().unit}`}
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
