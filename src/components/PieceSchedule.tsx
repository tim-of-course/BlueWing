import { formatLength } from '../core/length';
import { createMemo, For, Show } from 'solid-js';
import { pieceSchedule } from '../core/calculations';
import type { Project, Quantity } from '../core/types';
import type { CalculationSnapshot } from '../core/calculation-state';

export function displayLength(quantity: Quantity | undefined): string {
  return quantity
    ? formatLength(
        quantity.unit === 'in' ? quantity.value / 12 : quantity.value,
      )
    : '—';
}
export default function PieceSchedule(props: {
  project: Project;
  result: CalculationSnapshot;
}) {
  const rows = createMemo(() =>
    pieceSchedule(props.project, props.result).filter(
      (row) => row.recordType !== 'stock-purchase',
    ),
  );
  return (
    <Show when={rows().length}>
      <details class="quantity-output" open>
        <summary>Required pieces by location</summary>
        <p class="muted">
          Each row shows an installed cut or a formula estimate. Material totals
          above show shared stock orders after offcut reuse and waste.
        </p>
        <table>
          <caption>Piece schedule</caption>
          <thead>
            <tr>
              <th>Location</th>
              <th>Material / role</th>
              <th>Quantity</th>
              <th>Cut length</th>
              <th>Stock length</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <For
              each={rows().slice(0, 300)}
              keyed={(row) =>
                JSON.stringify([
                  row.assignmentId,
                  row.outputId,
                  row.geometryId,
                  row.pieceId,
                ])
              }
            >
              {(row) => (
                <tr>
                  <td>
                    {row().sheet} / {row().location} ({row().direction})
                  </td>
                  <td>
                    {row().materialId} / {row().role}
                  </td>
                  <td>{row().quantity ?? '—'}</td>
                  <td>
                    {row().cutLength_ft === null
                      ? '—'
                      : formatLength(row().cutLength_ft ?? 0)}
                  </td>
                  <td>
                    {row().stockLength_ft === null
                      ? '—'
                      : formatLength(row().stockLength_ft ?? 0)}
                  </td>
                  <td>
                    {row().complete
                      ? row().pieceId
                        ? 'Measured from 3D'
                        : 'Estimate only'
                      : row().diagnostic}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <Show when={rows().length > 300}>
          <p class="muted">
            Showing 300 of {rows().length} pieces. CSV and JSON exports include
            every piece.
          </p>
        </Show>
      </details>
    </Show>
  );
}
