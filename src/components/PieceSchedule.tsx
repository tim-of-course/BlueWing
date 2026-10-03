import { createMemo, For, Show } from 'solid-js';
import { pieceSchedule } from '../core/calculations';
import type { CalculationResult, Project, Quantity } from '../core/types';

export function displayLength(quantity: Quantity | undefined): string {
  if (!quantity) return '—';
  // Calculated schedules use metres, displayed in feet and inches.
  const inches = Math.round((quantity.value / 0.0254) * 1000) / 1000;
  const feet = Math.floor(inches / 12);
  const rest = Math.round((inches - feet * 12) * 1000) / 1000;
  return `${String(feet)}′ ${String(rest)}″`;
}
function displayMetres(value: number | null): string {
  return displayLength(value === null ? undefined : { value, unit: 'm' });
}
export default function PieceSchedule(props: {
  project: Project;
  result: CalculationResult;
}) {
  const rows = createMemo(() => pieceSchedule(props.project, props.result));
  return (
    <Show when={rows().length}>
      <details class="quantity-output" open>
        <summary>Required pieces by location</summary>
        <p class="muted">
          Required pieces exclude purchasing waste and package rounding. Stock
          counts allow one stock length per piece; offcut reuse is not
          calculated. Rows without a positioned piece are formula estimates.
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
                    {row().sheet} / {row().location}
                  </td>
                  <td>
                    {row().materialId} / {row().role}
                  </td>
                  <td>{row().quantity ?? '—'}</td>
                  <td>{displayMetres(row().cutLength_m)}</td>
                  <td>{displayMetres(row().stockLength_m)}</td>
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
