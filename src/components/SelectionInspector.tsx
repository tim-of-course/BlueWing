import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { Observation } from '../app/application';
import type { WorkspaceController } from '../app/contracts';
import { convertQuantity, measureGeometry } from '../core/geometry';
import type { GeometryKind, Measurement, Unit } from '../core/types';

interface Props {
  controller: WorkspaceController;
  onError: (message: string) => void;
  onDraftChange?: (dirty: boolean) => void;
  navigationDisabled?: boolean;
}

interface NameDraft {
  id: string;
  name: string;
  expected: Observation;
}

const typeNames: Record<GeometryKind, string> = {
  path: 'Path',
  area: 'Area',
  count: 'Count set',
};
const metrics: Record<
  GeometryKind,
  { key: Exclude<keyof Measurement, 'diagnostic'>; label: string; unit: Unit }[]
> = {
  path: [{ key: 'length', label: 'Length', unit: 'ft' }],
  area: [
    { key: 'area', label: 'Area', unit: 'ft2' },
    { key: 'perimeter', label: 'Perimeter', unit: 'ft' },
  ],
  count: [{ key: 'count', label: 'Count', unit: 'ea' }],
};
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });

export default function SelectionInspector(props: Props) {
  const selected = createMemo(
    () => {
      const project = props.controller.project();
      return props.controller.selection().flatMap((id) => {
        const geometry = project?.geometries[id];
        return geometry ? [geometry] : [];
      });
    },
    { name: 'selectionInspector.objects' },
  );
  const single = () => (selected().length === 1 ? selected()[0] : undefined);
  const kind = createMemo(() => {
    const first = selected()[0];
    return first && selected().every((object) => object.kind === first.kind)
      ? first.kind
      : undefined;
  });
  const typeName = () => {
    const type = kind();
    return type ? typeNames[type] : 'Mixed types';
  };
  const measured = createMemo(
    () => {
      const project = props.controller.project();
      return project
        ? selected().map((object) => measureGeometry(project, object))
        : [];
    },
    { name: 'selectionInspector.measurements' },
  );
  const totals = createMemo(() => {
    const type = kind();
    return type
      ? metrics[type].map((metric) => {
          const values = measured().map((value) => value[metric.key]);
          const unavailable = values.some((value) => !value);
          const value = unavailable
            ? null
            : values.reduce(
                (sum, quantity) =>
                  sum +
                  (quantity ? convertQuantity(quantity, metric.unit).value : 0),
                0,
              );
          return { ...metric, value };
        })
      : [];
  });
  const diagnostics = () => [
    ...new Set(
      measured().flatMap((value) =>
        value.diagnostic ? [value.diagnostic] : [],
      ),
    ),
  ];
  const groups = createMemo(() =>
    Object.values(props.controller.project()?.groups ?? {}).map((group) => ({
      ...group,
      selectedMembers: selected().filter((object) =>
        group.geometryIds.includes(object.id),
      ).length,
    })),
  );
  const [draft, setDraft] = createSignal<NameDraft | null>(null, {
    name: 'selectionInspector.nameDraft',
  });
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const [groupId, setGroupId] = createSignal('');
  const disabled = () => pending() || props.controller.busy();
  createEffect(
    () => ({ dirty: !!draft(), notify: props.onDraftChange }),
    ({ dirty, notify }) => {
      notify?.(dirty);
    },
    { name: 'selectionInspector.draftStatus' },
  );
  const run = (action: () => Promise<unknown>) => {
    const report = props.onError;
    setPending(true);
    void action()
      .then(() => setError(''))
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        report(message);
      })
      .finally(() => setPending(false));
  };
  const changeMembership = (id: string, add: boolean) => {
    const controller = props.controller;
    const group = controller.project()?.groups[id];
    if (!group) return;
    const ids = selected().map((object) => object.id);
    run(() =>
      controller.setMembership(
        id,
        add
          ? [...new Set([...group.geometryIds, ...ids])]
          : group.geometryIds.filter((member) => !ids.includes(member)),
      ),
    );
  };

  return (
    <Show when={selected().length > 0}>
      <div class="stack">
        <section class="panel-section stack">
          <h3>
            {selected().length === 1
              ? 'Selection'
              : `${String(selected().length)} objects selected`}
          </h3>
          <Show when={single()}>
            {(object) => (
              <form
                class="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = draft();
                  if (!value || disabled()) return;
                  run(async () => {
                    await props.controller.updateGeometry(
                      value.id,
                      { name: value.name },
                      value.expected,
                    );
                    setDraft(null);
                  });
                }}
              >
                <label class="field">
                  Object name
                  <input
                    value={
                      draft()?.id === object().id
                        ? draft()?.name
                        : object().name
                    }
                    disabled={disabled()}
                    onInput={(event) => {
                      const current = object();
                      const existing = draft();
                      setDraft({
                        id: current.id,
                        name: event.currentTarget.value,
                        expected:
                          existing?.id === current.id
                            ? existing.expected
                            : props.controller.observe(),
                      });
                    }}
                  />
                </label>
                <Show when={draft()}>
                  <div class="button-row">
                    <button class="primary" type="submit" disabled={disabled()}>
                      Save name
                    </button>
                    <button
                      type="button"
                      disabled={disabled()}
                      onClick={() => {
                        setDraft(null);
                        setError('');
                      }}
                    >
                      Cancel name edit
                    </button>
                  </div>
                </Show>
              </form>
            )}
          </Show>
          <p class="muted">Type: {typeName()}</p>
          <Show
            when={kind()}
            fallback={
              <p class="hint">
                Mixed selection. Select objects of one type to see combined
                measurements.
              </p>
            }
          >
            <For each={totals()}>
              {(metric) => (
                <div class="button-row">
                  <span>
                    {selected().length > 1
                      ? `Total ${metric.label.toLowerCase()}`
                      : metric.label}
                  </span>
                  <strong>
                    {metric.value === null
                      ? 'Unavailable'
                      : `${number.format(metric.value)} ${metric.unit === 'ft2' ? 'ft²' : metric.unit}`}
                  </strong>
                </div>
              )}
            </For>
          </Show>
          <For each={diagnostics()}>
            {(message) => (
              <p class="hint">
                {message}.{' '}
                {message === 'Sheet is not calibrated'
                  ? 'Calibrate the sheet to measure lengths and areas.'
                  : ''}
              </p>
            )}
          </For>
        </section>
        <section class="panel-section stack">
          <h3>Groups</h3>
          <Show
            when={groups().some((group) => group.selectedMembers > 0)}
            fallback={<p class="muted">No group memberships.</p>}
          >
            <For each={groups().filter((group) => group.selectedMembers > 0)}>
              {(group) => (
                <div class="stack">
                  <strong>{group.name}</strong>
                  <Show when={selected().length > 1}>
                    <span class="muted">
                      {group.selectedMembers} of {selected().length} selected
                      objects
                    </span>
                  </Show>
                  <div class="button-row">
                    <Show when={group.selectedMembers < selected().length}>
                      <button
                        type="button"
                        disabled={disabled() || !!draft()}
                        onClick={() => {
                          changeMembership(group.id, true);
                        }}
                      >
                        Add all selected
                      </button>
                    </Show>
                    <button
                      type="button"
                      disabled={disabled() || !!draft()}
                      onClick={() => {
                        changeMembership(group.id, false);
                      }}
                    >
                      Remove selection
                    </button>
                    <button
                      type="button"
                      disabled={
                        disabled() || !!draft() || props.navigationDisabled
                      }
                      onClick={() => {
                        props.controller.setActiveGroupId(group.id);
                        props.controller.setSelection([]);
                      }}
                    >
                      Edit group recipes
                    </button>
                  </div>
                </div>
              )}
            </For>
          </Show>
          <Show
            when={groups().some(
              (group) => group.selectedMembers < selected().length,
            )}
            fallback={
              <p class="hint">
                {groups().length === 0
                  ? 'Create a group above to use recipes.'
                  : 'All selected objects belong to every group.'}
              </p>
            }
          >
            <label class="field">
              Add selection to group
              <select
                value={groupId()}
                disabled={disabled() || !!draft()}
                onChange={(event) => setGroupId(event.currentTarget.value)}
              >
                <option value="">Choose group</option>
                <For
                  each={groups().filter(
                    (group) => group.selectedMembers < selected().length,
                  )}
                >
                  {(group) => <option value={group.id}>{group.name}</option>}
                </For>
              </select>
            </label>
            <button
              type="button"
              disabled={
                disabled() ||
                !!draft() ||
                !groups().some(
                  (group) =>
                    group.id === groupId() &&
                    group.selectedMembers < selected().length,
                )
              }
              onClick={() => {
                changeMembership(groupId(), true);
              }}
            >
              Add selection
            </button>
          </Show>
        </section>
        <Show when={pending()}>
          <p class="panel-section hint" role="status">
            Saving…
          </p>
        </Show>
        <Show when={error()}>
          <p class="panel-section warning" role="alert">
            {error()}
          </p>
        </Show>
      </div>
    </Show>
  );
}
