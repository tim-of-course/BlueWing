import { required, takeoffContext } from '../core/takeoffs';
import { createSignal, For, Show } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';

export default function TakeoffControls(props: {
  controller: WorkspaceController;
  disabled: boolean;
}) {
  const [open, setOpen] = createSignal(false);
  const [name, setName] = createSignal('');
  const [kind, setKind] = createSignal<'phase' | 'change-order'>('phase');
  const [sourceId, setSourceId] = createSignal('main');
  const [selected, setSelected] = createSignal<string[]>([]);
  const [direction, setDirection] = createSignal<'add' | 'deduct'>('add');
  const [error, setError] = createSignal('');
  const current = () => required(props.controller.project() ?? undefined);
  const takeoff = () => takeoffContext(current());
  const source = () =>
    props.controller
      .takeoffSources()
      .find(
        (p) => p.takeoffId === sourceId() && p.takeoffId !== takeoff().id,
      ) ??
    props.controller.takeoffSources().find((p) => p.takeoffId !== takeoff().id);
  const run = async (work: () => unknown) => {
    try {
      setError('');
      await work();
    } catch (e) {
      setError(String(e));
    }
  };
  return (
    <div>
      <select
        aria-label="Active takeoff"
        value={current().takeoffId}
        disabled={props.disabled}
        onChange={(e) => {
          void run(() => {
            props.controller.selectTakeoff(e.currentTarget.value);
          });
        }}
      >
        <For each={Object.values(current().takeoffs)}>
          {(t) => (
            <option value={t.id}>
              {t.name} ({t.kind})
            </option>
          )}
        </For>
      </select>
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => setOpen((v) => !v)}
      >
        Takeoffs
      </button>
      <Show when={open()}>
        <section class="takeoff-controls" aria-label="Manage takeoffs">
          <p>
            Current: {takeoff().name}. Copies are independent; change orders
            reference Main.
          </p>
          <label>
            Name{' '}
            <input
              aria-label="Takeoff name"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </label>
          <select
            aria-label="New takeoff kind"
            value={kind()}
            onChange={(e) =>
              setKind(e.currentTarget.value as 'phase' | 'change-order')
            }
          >
            <option value="phase">Phase</option>
            <option value="change-order">Change order</option>
          </select>
          <button
            type="button"
            disabled={props.disabled || !name().trim()}
            onClick={() => {
              void run(async () => {
                const id = crypto.randomUUID();
                await props.controller.execute({
                  name: 'takeoff.create',
                  payload: { id, name: name(), kind: kind() },
                });
                props.controller.selectTakeoff(id);
                setSelected([]);
              });
            }}
          >
            Create takeoff
          </button>
          <button
            type="button"
            disabled={props.disabled || !name().trim()}
            onClick={() => {
              void run(() =>
                props.controller.execute({
                  name: 'takeoff.rename',
                  payload: { id: takeoff().id, name: name() },
                }),
              );
            }}
          >
            Rename takeoff
          </button>
          <button
            type="button"
            disabled={props.disabled || takeoff().kind === 'main'}
            onClick={() => {
              void run(async () => {
                await props.controller.execute({
                  name: 'takeoff.delete',
                  payload: { id: takeoff().id },
                });
                props.controller.selectTakeoff('main');
              });
            }}
          >
            Delete takeoff and its items
          </button>
          <label>
            Copy from{' '}
            <select
              aria-label="Source takeoff"
              value={source()?.takeoffId ?? ''}
              onChange={(e) => {
                setSourceId(e.currentTarget.value);
                setSelected([]);
              }}
            >
              <For
                each={Object.values(current().takeoffs).filter(
                  (t) => t.id !== takeoff().id,
                )}
              >
                {(t) => <option value={t.id}>{t.name}</option>}
              </For>
            </select>
          </label>
          <For each={Object.values(source()?.geometries ?? {})}>
            {(g) => (
              <label>
                <input
                  type="checkbox"
                  checked={selected().includes(g.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.currentTarget.checked
                        ? [...ids, g.id]
                        : ids.filter((id) => id !== g.id),
                    )
                  }
                />
                {g.name}
              </label>
            )}
          </For>
          <select
            aria-label="Copy direction"
            value={direction()}
            onChange={(e) =>
              setDirection(e.currentTarget.value as 'add' | 'deduct')
            }
          >
            <option value="add">Addition</option>
            <Show when={takeoff().kind === 'change-order'}>
              <option value="deduct">Deduction</option>
            </Show>
          </select>
          <button
            type="button"
            disabled={props.disabled || !selected().length || !source()}
            onClick={() => {
              void run(() =>
                props.controller.execute({
                  name: 'takeoff.copyItems',
                  takeoffId: takeoff().id,
                  payload: {
                    sourceTakeoffId: source()?.takeoffId,
                    geometryIds: selected(),
                    direction:
                      takeoff().kind === 'change-order' ? direction() : 'add',
                  },
                }),
              );
            }}
          >
            Copy selected items
          </button>
          <p>
            For a changed wall, copy the Main wall as a deduction, then draw or
            copy its replacement as an addition.
          </p>
          <Show when={error()}>
            <p role="alert">{error()}</p>
          </Show>
        </section>
      </Show>
    </div>
  );
}
