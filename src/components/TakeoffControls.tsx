import { required, takeoffContext } from '../core/takeoffs';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
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
  const destinationId = createMemo(() => current().takeoffId);
  const sources = createMemo(() =>
    Object.values(current().takeoffs).filter((t) => t.id !== destinationId()),
  );
  const effectiveSourceId = createMemo(
    () => sources().find((t) => t.id === sourceId())?.id ?? sources()[0]?.id,
  );
  const source = createMemo(() => {
    if (!open()) return null;
    const id = effectiveSourceId();
    return id ? props.controller.projectForTakeoff(id) : null;
  });
  createEffect(
    () => [effectiveSourceId(), destinationId()],
    () => {
      setSelected([]);
    },
    { name: 'takeoff.copySelection' },
  );
  const copyIds = createMemo(() => {
    const geometries = source()?.geometries;
    return geometries
      ? selected().filter((id) => Object.hasOwn(geometries, id))
      : [];
  });
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
              value={effectiveSourceId() ?? ''}
              onChange={(e) => setSourceId(e.currentTarget.value)}
            >
              <For each={sources()}>
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
            disabled={props.disabled || !copyIds().length}
            onClick={() => {
              const sourceTakeoffId = effectiveSourceId();
              const geometryIds = copyIds();
              if (!sourceTakeoffId || !geometryIds.length) return;
              void run(() =>
                props.controller.execute({
                  name: 'takeoff.copyItems',
                  takeoffId: takeoff().id,
                  payload: {
                    sourceTakeoffId,
                    geometryIds,
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
