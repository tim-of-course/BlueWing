import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import type { Observation } from '../app/application';
import type { Assignment, OutputAllowance } from '../core/types';

interface Props {
  controller: WorkspaceController;
  navigationDisabled?: boolean;
  onError: (message: string) => void;
  onDraftChange?: (dirty: boolean) => void;
}
interface GroupDraft {
  id: string;
  name: string;
  color: string;
  expected: Observation;
}
interface AssignmentDraft {
  value: Assignment;
  expected: Observation;
}

export default function GroupInspector(props: Props) {
  const group = createMemo(
    () => {
      const id = props.controller.activeGroupId();
      return id ? props.controller.project()?.groups[id] : undefined;
    },
    { name: 'inspector.activeGroup' },
  );
  const [groupDraft, setGroupDraft] = createSignal<GroupDraft | null>(null, {
    name: 'inspector.groupDraft',
  });
  const [assignmentDrafts, setAssignmentDrafts] = createSignal<
    Record<string, AssignmentDraft>
  >({}, { name: 'inspector.assignmentDrafts' });
  const [error, setError] = createSignal('');
  const [pending, setPending] = createSignal(false);
  const [recipeId, setRecipeId] = createSignal('');
  const dirty = () =>
    !!groupDraft() || Object.keys(assignmentDrafts()).length > 0;
  createEffect(
    () => ({ dirty: dirty(), notify: props.onDraftChange }),
    ({ dirty, notify }) => {
      notify?.(dirty);
    },
    { name: 'inspector.draftStatus' },
  );
  const run = (action: () => Promise<unknown>) => {
    const report = props.onError;
    setPending(true);
    setError('');
    void action()
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        report(message);
      })
      .finally(() => setPending(false));
  };
  const editGroup = (patch: { name?: string; color?: string }) => {
    const current = group();
    if (!current) return;
    const existing = groupDraft();
    setGroupDraft({
      id: current.id,
      name: current.name,
      color: current.color ?? '#3b82f6',
      expected: props.controller.observe(),
      ...existing,
      ...patch,
    });
  };
  const editAssignment = (
    id: string,
    update: (assignment: Assignment) => Assignment,
  ) => {
    const existing = assignmentDrafts()[id];
    const current =
      existing?.value ?? props.controller.project()?.assignments[id];
    if (!current) return;
    const next = {
      value: update(structuredClone(current)),
      expected: existing?.expected ?? props.controller.observe(),
    };
    setAssignmentDrafts((drafts) => ({ ...drafts, [id]: next }));
  };
  const discardAssignment = (id: string) =>
    setAssignmentDrafts((drafts) =>
      Object.fromEntries(Object.entries(drafts).filter(([key]) => key !== id)),
    );
  const setAllowance = (
    id: string,
    outputId: string,
    defaults: OutputAllowance,
    patch: { wastePercent?: number; packageSize?: number | undefined },
  ) => {
    editAssignment(id, (assignment) => {
      const allowance = {
        ...(assignment.allowances[outputId] ?? defaults),
        ...patch,
      };
      assignment.allowances[outputId] = {
        wastePercent: allowance.wastePercent,
        ...(allowance.packageSize === undefined
          ? {}
          : { packageSize: allowance.packageSize }),
      };
      return assignment;
    });
  };
  return (
    <div class="stack">
      <Show when={dirty()}>
        <div class="panel-section">
          <button
            type="button"
            disabled={pending()}
            onClick={() => {
              setGroupDraft(null);
              setAssignmentDrafts({});
              setError('');
            }}
          >
            Discard all inspector edits
          </button>
        </div>
      </Show>
      <p class="hint">
        {props.controller.selection().length} drawing objects selected
      </p>
      <Show
        when={group()}
        fallback={
          <div class="panel-section">
            <p>
              Select a group to edit its members and recipes. Drawing objects
              can belong to several groups.
            </p>
          </div>
        }
      >
        {(current) => (
          <>
            <section class="panel-section stack">
              <h3>Group</h3>
              <label class="field">
                Group name
                <input
                  value={groupDraft()?.name ?? current().name}
                  disabled={pending()}
                  onInput={(event) => {
                    editGroup({ name: event.currentTarget.value });
                  }}
                />
              </label>
              <label class="field">
                Highlight color
                <input
                  type="color"
                  value={groupDraft()?.color ?? current().color ?? '#3b82f6'}
                  disabled={pending()}
                  onInput={(event) => {
                    editGroup({ color: event.currentTarget.value });
                  }}
                />
              </label>
              <Show when={groupDraft()}>
                {(draft) => (
                  <div class="button-row">
                    <button
                      class="primary"
                      type="button"
                      disabled={pending()}
                      onClick={() => {
                        const value = draft();
                        run(async () => {
                          await props.controller.updateGroup(
                            value.id,
                            { name: value.name, color: value.color },
                            value.expected,
                          );
                          setGroupDraft(null);
                        });
                      }}
                    >
                      Save group
                    </button>
                    <button
                      type="button"
                      disabled={pending()}
                      onClick={() => setGroupDraft(null)}
                    >
                      Cancel group edit
                    </button>
                  </div>
                )}
              </Show>
              <div class="button-row">
                <button
                  type="button"
                  disabled={pending() || dirty()}
                  onClick={() => {
                    run(() => props.controller.duplicateGroup(current().id));
                  }}
                >
                  Duplicate group
                </button>
                <button
                  type="button"
                  class="danger"
                  disabled={pending() || dirty()}
                  onClick={() => {
                    run(() => props.controller.deleteGroup(current().id));
                  }}
                >
                  Delete group
                </button>
              </div>
              <p class="muted">
                Deleting this group keeps its drawing objects.
              </p>
            </section>
            <section class="panel-section stack">
              <h3>Members ({current().geometryIds.length})</h3>
              <div class="button-row">
                <button
                  type="button"
                  disabled={pending() || !props.controller.selection().length}
                  onClick={() => {
                    const value = current();
                    const ids = [
                      ...new Set([
                        ...value.geometryIds,
                        ...props.controller.selection(),
                      ]),
                    ];
                    run(() => props.controller.setMembership(value.id, ids));
                  }}
                >
                  Add selection
                </button>
                <button
                  type="button"
                  disabled={pending() || !props.controller.selection().length}
                  onClick={() => {
                    const value = current();
                    const selected = props.controller.selection();
                    run(() =>
                      props.controller.setMembership(
                        value.id,
                        value.geometryIds.filter(
                          (id) => !selected.includes(id),
                        ),
                      ),
                    );
                  }}
                >
                  Remove selection
                </button>
              </div>
              <For each={current().geometryIds}>
                {(id) => (
                  <div class="button-row">
                    <button
                      type="button"
                      disabled={props.navigationDisabled}
                      onClick={() => {
                        const geometry =
                          props.controller.project()?.geometries[id];
                        if (geometry) {
                          props.controller.setActiveSheetId(geometry.sheetId);
                          props.controller.setSelection([id]);
                        }
                      }}
                    >
                      {props.controller.project()?.geometries[id]?.name ?? id}
                    </button>
                    <button
                      type="button"
                      disabled={pending()}
                      aria-label={`Remove ${props.controller.project()?.geometries[id]?.name ?? id} from group`}
                      onClick={() => {
                        const value = current();
                        run(() =>
                          props.controller.setMembership(
                            value.id,
                            value.geometryIds.filter((member) => member !== id),
                          ),
                        );
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </For>
            </section>
            <section class="panel-section stack">
              <h3>Recipes</h3>
              <label class="field">
                Recipe to assign
                <select
                  value={recipeId()}
                  onChange={(event) => setRecipeId(event.currentTarget.value)}
                >
                  <option value="">Choose recipe</option>
                  <For
                    each={Object.values(
                      props.controller.project()?.recipes ?? {},
                    )}
                  >
                    {(recipe) => (
                      <option value={recipe.id}>{recipe.name}</option>
                    )}
                  </For>
                </select>
              </label>
              <button
                type="button"
                disabled={pending() || !recipeId()}
                onClick={() => {
                  run(() =>
                    props.controller.assignRecipe(current().id, recipeId()),
                  );
                }}
              >
                Assign recipe
              </button>
            </section>
            <For
              each={Object.values(props.controller.project()?.assignments ?? {})
                .filter((assignment) => assignment.groupId === current().id)
                .map((assignment) => assignment.id)}
            >
              {(id) => {
                const assignment = () =>
                  assignmentDrafts()[id]?.value ??
                  props.controller.project()?.assignments[id];
                const recipe = () => {
                  const value = assignment();
                  return value
                    ? props.controller.project()?.recipes[value.recipeId]
                    : undefined;
                };
                return (
                  <section class="panel-section stack">
                    <h3>{recipe()?.name ?? 'Missing recipe'}</h3>
                    <For each={recipe()?.inputs ?? []}>
                      {(input) => (
                        <Show
                          when={input.type === 'number'}
                          fallback={
                            <label>
                              <input
                                type="checkbox"
                                disabled={pending()}
                                checked={
                                  (assignment()?.inputs[input.name] ??
                                    input.default) === true
                                }
                                onChange={(event) => {
                                  const checked = event.currentTarget.checked;
                                  editAssignment(id, (value) => ({
                                    ...value,
                                    inputs: {
                                      ...value.inputs,
                                      [input.name]: checked,
                                    },
                                  }));
                                }}
                              />{' '}
                              {input.name}
                            </label>
                          }
                        >
                          <label class="field">
                            {input.name} ({input.unit})
                            <input
                              type="number"
                              step="any"
                              disabled={pending()}
                              value={Number(
                                assignment()?.inputs[input.name] ??
                                  input.default,
                              )}
                              onChange={(event) => {
                                const amount =
                                  event.currentTarget.valueAsNumber;
                                editAssignment(id, (value) => ({
                                  ...value,
                                  inputs: {
                                    ...value.inputs,
                                    [input.name]: amount,
                                  },
                                }));
                              }}
                            />
                          </label>
                        </Show>
                      )}
                    </For>
                    <For each={recipe()?.outputs ?? []}>
                      {(output) => (
                        <fieldset disabled={pending()} class="stack">
                          <legend>
                            {output.name} ({output.unit})
                          </legend>
                          <label class="field">
                            Waste %
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={
                                assignment()?.allowances[output.id]
                                  ?.wastePercent ??
                                output.allowance.wastePercent
                              }
                              onChange={(event) => {
                                setAllowance(id, output.id, output.allowance, {
                                  wastePercent:
                                    event.currentTarget.valueAsNumber,
                                });
                              }}
                            />
                          </label>
                          <label class="field">
                            Quantity per package (optional)
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={
                                (
                                  assignment()?.allowances[output.id] ??
                                  output.allowance
                                ).packageSize ?? ''
                              }
                              onChange={(event) => {
                                setAllowance(id, output.id, output.allowance, {
                                  packageSize:
                                    event.currentTarget.value === ''
                                      ? undefined
                                      : event.currentTarget.valueAsNumber,
                                });
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              editAssignment(id, (value) => {
                                value.allowances = Object.fromEntries(
                                  Object.entries(value.allowances).filter(
                                    ([key]) => key !== output.id,
                                  ),
                                );
                                return value;
                              });
                            }}
                          >
                            Use recipe allowance
                          </button>
                        </fieldset>
                      )}
                    </For>
                    <div class="button-row">
                      <button
                        type="button"
                        class="primary"
                        disabled={pending() || !assignmentDrafts()[id]}
                        onClick={() => {
                          const value = assignmentDrafts()[id];
                          if (value)
                            run(async () => {
                              await props.controller.updateAssignment(
                                id,
                                value.value.inputs,
                                value.value.allowances,
                                value.expected,
                              );
                              discardAssignment(id);
                            });
                        }}
                      >
                        Save assignment
                      </button>
                      <button
                        type="button"
                        disabled={pending() || !assignmentDrafts()[id]}
                        onClick={() => {
                          discardAssignment(id);
                        }}
                      >
                        Cancel assignment edit
                      </button>
                      <button
                        type="button"
                        class="danger"
                        disabled={pending() || !!assignmentDrafts()[id]}
                        onClick={() => {
                          run(() => props.controller.deleteAssignment(id));
                        }}
                      >
                        Remove recipe
                      </button>
                    </div>
                  </section>
                );
              }}
            </For>
          </>
        )}
      </Show>
      <Show when={error()}>
        <p class="panel-section warning" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  );
}
