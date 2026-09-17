import { createSignal, For, Show } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
export default function Quantities(props: {
  controller: WorkspaceController;
  onError: (message: string) => void;
  onShowDrawing: () => void;
  navigationDisabled?: boolean;
}) {
  const [filter, setFilter] = createSignal('');
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
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <For each={result().totals}>
                  {(total) => (
                    <tr>
                      <td>{total.materialId}</td>
                      <td>
                        {number(total.amount)} {total.unit}
                      </td>
                      <td>{total.complete ? 'Complete' : 'Incomplete'}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
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
              each={result().outputs.filter(
                (output) =>
                  !filter().trim() ||
                  [
                    output.materialId,
                    output.name,
                    props.controller.project()?.groups[output.groupId]?.name ??
                      '',
                  ]
                    .join(' ')
                    .toLowerCase()
                    .includes(filter().trim().toLowerCase()),
              )}
              fallback={
                <p class="muted">
                  {filter().trim()
                    ? 'No source breakdowns match.'
                    : 'Assign a recipe to a group to calculate quantities.'}
                </p>
              }
            >
              {(output) => (
                <details class="quantity-output" open>
                  <summary>
                    <strong>
                      {props.controller.project()?.groups[output.groupId]
                        ?.name ?? output.groupId}{' '}
                      / {output.name}
                    </strong>
                    <span>
                      {output.complete
                        ? `${number(output.purchasedAmount)} ${output.unit}`
                        : 'Incomplete'}
                    </span>
                  </summary>
                  <p class="muted">
                    Recipe:{' '}
                    {props.controller.project()?.recipes[output.recipeId]
                      ?.name ?? output.recipeId}{' '}
                    · Material: {output.materialId}
                  </p>
                  <dl class="quantity-breakdown">
                    <div>
                      <dt>Base</dt>
                      <dd>
                        {number(output.baseAmount)} {output.unit}
                      </dd>
                    </div>
                    <div>
                      <dt>Waste ({number(output.wastePercent)}%)</dt>
                      <dd>
                        {number(output.wasteAmount)} {output.unit}
                      </dd>
                    </div>
                    <div>
                      <dt>With waste</dt>
                      <dd>
                        {number(output.adjustedAmount)} {output.unit}
                      </dd>
                    </div>
                    <Show when={output.packageCount !== null}>
                      <div>
                        <dt>Packages</dt>
                        <dd>{output.packageCount}</dd>
                      </div>
                    </Show>
                    <div>
                      <dt>Purchased</dt>
                      <dd>
                        {number(output.purchasedAmount)} {output.unit}
                      </dd>
                    </div>
                  </dl>
                  <For each={output.diagnostics}>
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
                      <For each={output.sources}>
                        {(source) => (
                          <tr>
                            <td>
                              <button
                                type="button"
                                onClick={() => {
                                  const geometry =
                                    props.controller.project()?.geometries[
                                      source.geometryId
                                    ];
                                  if (geometry) {
                                    props.controller.setActiveSheetId(
                                      geometry.sheetId,
                                    );
                                    props.controller.setSelection([
                                      geometry.id,
                                    ]);
                                    props.controller.setActiveGroupId(
                                      output.groupId,
                                    );
                                    props.onShowDrawing();
                                  }
                                }}
                              >
                                {props.controller.project()?.geometries[
                                  source.geometryId
                                ]?.name ?? source.geometryId}
                              </button>
                            </td>
                            <td>
                              {Object.entries(source.inputs)
                                .map(
                                  ([key, value]) => `${key}: ${String(value)}`,
                                )
                                .join(', ') || '—'}
                            </td>
                            <td>
                              {source.value === null
                                ? (source.diagnostic ?? 'Unavailable')
                                : `${number(source.value)} ${output.unit}`}
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </details>
              )}
            </For>
          </>
        )}
      </Show>
    </section>
  );
}
