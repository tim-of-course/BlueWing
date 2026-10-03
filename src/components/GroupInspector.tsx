import type { Recipe } from '../core/types';
import { assemblyOutputs } from '../core/systems';
import AssemblyInputs from './AssemblyInputs';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import type { Observation } from '../app/application';
import type { Assignment, OutputAllowance } from '../core/types';
import type { PayloadSchema } from '../core/commands';
import {
  wallOverrideSchema,
  ceilingOverrideSchema,
} from '../core/detailed-commands';
import { ConstructionFields } from './ConstructionEditor';

function selectedFields(schema: PayloadSchema, keys: string[]): PayloadSchema {
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(schema.properties ?? {}).filter(([key]) =>
        keys.includes(key),
      ),
    ),
  };
}

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
              <h3>Assemblies</h3>
              <label class="field">
                Assembly to assign
                <select
                  value={recipeId()}
                  onChange={(event) => setRecipeId(event.currentTarget.value)}
                >
                  <option value="">Choose assembly</option>
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
                Assign assembly
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
                const [inputTarget, setInputTarget] = createSignal('');
                return (
                  <section class="panel-section stack">
                    <h3>{recipe()?.name ?? 'Missing assembly'}</h3>
                    <Show when={recipe()?.description}>
                      <p class="muted">{recipe()?.description}</p>
                    </Show>
                    <Show when={recipe()?.reference}>
                      <p class="muted">Reference: {recipe()?.reference}</p>
                    </Show>
                    <label class="field">
                      Input scope
                      <select
                        value={inputTarget()}
                        disabled={pending()}
                        onChange={(event) =>
                          setInputTarget(event.currentTarget.value)
                        }
                      >
                        <option value="">Group values</option>
                        <For each={current().geometryIds}>
                          {(geometryId) => (
                            <option value={geometryId}>
                              {props.controller.project()?.geometries[
                                geometryId
                              ]?.name ?? geometryId}
                            </option>
                          )}
                        </For>
                      </select>
                    </label>
                    <Show when={recipe()?.wallTemplate}>
                      <fieldset disabled={pending()}>
                        <legend>Wall values</legend>
                        <p class="muted">
                          Height drives framing and full-height finishes
                          together. Reset a value to use the group or assembly
                          value again.
                        </p>
                        <ConstructionFields
                          schema={selectedFields(wallOverrideSchema, [
                            'height',
                            'baseElevation',
                            'levelId',
                            'studSpacing',
                            'topAllowance',
                            'bottomAllowance',
                          ])}
                          value={{
                            ...(inputTarget()
                              ? assignment()?.geometryDetails?.[inputTarget()]
                                  ?.wall
                              : assignment()?.wallOverrides),
                          }}
                          inherited={{
                            ...recipe()?.wallTemplate,
                            ...(inputTarget()
                              ? assignment()?.wallOverrides
                              : {}),
                          }}
                          unit="ft"
                          parent="walls"
                          controller={props.controller}
                          onChange={(wall) => {
                            const target = inputTarget();
                            editAssignment(id, (value) =>
                              target
                                ? {
                                    ...value,
                                    geometryDetails: {
                                      ...value.geometryDetails,
                                      [target]: {
                                        ...value.geometryDetails?.[target],
                                        wall,
                                      },
                                    },
                                  }
                                : { ...value, wallOverrides: wall },
                            );
                          }}
                        />
                      </fieldset>
                    </Show>
                    <Show when={recipe()?.ceilingTemplate}>
                      <fieldset disabled={pending()}>
                        <legend>Ceiling values</legend>
                        <p class="muted">
                          Changes update the measured ceiling and its material
                          quantities.
                        </p>
                        <ConstructionFields
                          schema={selectedFields(ceilingOverrideSchema, [
                            'elevation',
                            'levelId',
                            'layers',
                          ])}
                          value={{
                            ...(inputTarget()
                              ? assignment()?.geometryDetails?.[inputTarget()]
                                  ?.ceiling
                              : assignment()?.ceilingOverrides),
                          }}
                          inherited={{
                            ...recipe()?.ceilingTemplate,
                            ...(inputTarget()
                              ? assignment()?.ceilingOverrides
                              : {}),
                          }}
                          unit="ft"
                          parent="ceilings"
                          controller={props.controller}
                          onChange={(ceiling) => {
                            const target = inputTarget();
                            editAssignment(id, (value) =>
                              target
                                ? {
                                    ...value,
                                    geometryDetails: {
                                      ...value.geometryDetails,
                                      [target]: {
                                        ...value.geometryDetails?.[target],
                                        ceiling,
                                      },
                                    },
                                  }
                                : { ...value, ceilingOverrides: ceiling },
                            );
                          }}
                        />
                      </fieldset>
                    </Show>
                    <AssemblyInputs
                      inputs={recipe()?.inputs ?? []}
                      values={
                        inputTarget()
                          ? (assignment()?.geometryInputs?.[inputTarget()] ??
                            {})
                          : (assignment()?.inputs ?? {})
                      }
                      inherited={
                        inputTarget() ? (assignment()?.inputs ?? {}) : {}
                      }
                      disabled={pending()}
                      onChange={(inputs) => {
                        const target = inputTarget();
                        editAssignment(id, (value) =>
                          target
                            ? {
                                ...value,
                                geometryInputs: {
                                  ...value.geometryInputs,
                                  [target]: inputs,
                                },
                              }
                            : { ...value, inputs },
                        );
                      }}
                    />
                    <For
                      each={
                        recipe()
                          ? assemblyOutputs(recipe() as Recipe).map(
                              (entry) => entry.output,
                            )
                          : []
                      }
                      keyed={(output) => output.id}
                    >
                      {(output) => (
                        <fieldset disabled={pending()} class="stack">
                          <legend>
                            {output().name} ({output().unit})
                          </legend>
                          <label class="field">
                            Waste %
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={
                                assignment()?.allowances[output().id]
                                  ?.wastePercent ??
                                output().allowance.wastePercent
                              }
                              onChange={(event) => {
                                setAllowance(
                                  id,
                                  output().id,
                                  output().allowance,
                                  {
                                    wastePercent:
                                      event.currentTarget.valueAsNumber,
                                  },
                                );
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
                                  assignment()?.allowances[output().id] ??
                                  output().allowance
                                ).packageSize ?? ''
                              }
                              onChange={(event) => {
                                setAllowance(
                                  id,
                                  output().id,
                                  output().allowance,
                                  {
                                    packageSize:
                                      event.currentTarget.value === ''
                                        ? undefined
                                        : event.currentTarget.valueAsNumber,
                                  },
                                );
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              editAssignment(id, (value) => {
                                value.allowances = Object.fromEntries(
                                  Object.entries(value.allowances).filter(
                                    ([key]) => key !== output().id,
                                  ),
                                );
                                return value;
                              });
                            }}
                          >
                            Use assembly allowance
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
                              await props.controller.saveAssignment(
                                value.value,
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
                        Remove assembly
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
