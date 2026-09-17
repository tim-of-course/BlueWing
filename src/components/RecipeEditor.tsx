import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import {
  evaluateFormula,
  formulaOutput,
  formulaQuantity,
} from '../core/formula';
import type { FormulaValue } from '../core/formula';
import type { WorkspaceController } from '../app/contracts';
import type { Observation } from '../app/application';
import type {
  GeometryKind,
  Recipe,
  RecipeInput,
  RecipeOutput,
  Unit,
} from '../core/types';

const units: Unit[] = ['scalar', 'ea', 'm', 'mm', 'ft', 'in', 'm2', 'ft2'];
const kinds: GeometryKind[] = ['path', 'area', 'count'];
export default function RecipeEditor(props: {
  controller: WorkspaceController;
  onClose: () => void;
  onError: (message: string) => void;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = createSignal<Recipe | null>(null, {
    name: 'recipe.editorDraft',
  });
  const [dirty, setDirty] = createSignal(false);
  const [error, setError] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const validation = createMemo(
    () => {
      const recipe = draft();
      if (!recipe) return [];
      const messages: string[] = [];
      for (const kind of recipe.geometryKinds) {
        for (const output of recipe.outputs) {
          try {
            const values: Record<string, FormulaValue> = {};
            for (const input of recipe.inputs)
              values[input.name] =
                typeof input.default === 'boolean'
                  ? input.default
                  : formulaQuantity({ value: input.default, unit: input.unit });
            if (kind === 'path')
              values['length'] = formulaQuantity({ value: 1, unit: 'm' });
            if (kind === 'area') {
              values['area'] = formulaQuantity({ value: 1, unit: 'm2' });
              values['perimeter'] = formulaQuantity({ value: 4, unit: 'm' });
            }
            if (kind === 'count')
              values['count'] = formulaQuantity({ value: 1, unit: 'ea' });
            formulaOutput(evaluateFormula(output.formula, values), output.unit);
          } catch (cause) {
            messages.push(
              `${output.name} (${kind}): ${cause instanceof Error ? cause.message : String(cause)}`,
            );
          }
        }
      }
      return messages;
    },
    { name: 'recipe.formulaValidation' },
  );
  let observation: Observation | undefined;
  createEffect(
    () => ({ dirty: dirty(), notify: props.onDraftChange }),
    ({ dirty, notify }) => {
      notify?.(dirty);
    },
    { name: 'recipe.draftStatus' },
  );
  const begin = (recipe: Recipe) => {
    observation = props.controller.observe();
    setDraft(structuredClone(recipe));
    setDirty(false);
    setError('');
  };
  const change = (update: (recipe: Recipe) => Recipe) => {
    setDraft((current) => (current ? update(current) : null));
    setDirty(true);
  };
  const input = (index: number, patch: Partial<RecipeInput>) => {
    change((recipe) => ({
      ...recipe,
      inputs: recipe.inputs.map((value, at) =>
        at === index ? { ...value, ...patch } : value,
      ),
    }));
  };
  const output = (index: number, patch: Partial<RecipeOutput>) => {
    change((recipe) => ({
      ...recipe,
      outputs: recipe.outputs.map((value, at) =>
        at === index ? { ...value, ...patch } : value,
      ),
    }));
  };
  const report = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message);
    props.onError(message);
  };
  const save = () => {
    const controller = props.controller;
    const recipe = draft();
    if (!recipe) return;
    setSaving(true);
    setError('');
    void props.controller
      .saveRecipe(recipe, observation)
      .then(() => {
        setDirty(false);
        observation = controller.observe();
      })
      .catch(report)
      .finally(() => setSaving(false));
  };
  const remove = () => {
    const recipe = draft();
    if (!recipe) return;
    setSaving(true);
    void props.controller
      .deleteRecipe(recipe.id)
      .then(() => {
        setDraft(null);
        setDirty(false);
      })
      .catch(report)
      .finally(() => setSaving(false));
  };
  return (
    <div class="stack">
      <div class="button-row">
        <h2>Project recipes</h2>
        <button
          type="button"
          disabled={saving() || dirty()}
          onClick={() => {
            begin({
              id: crypto.randomUUID(),
              name: 'New recipe',
              geometryKinds: ['path'],
              inputs: [],
              outputs: [
                {
                  id: crypto.randomUUID(),
                  name: 'Length',
                  materialId: 'length',
                  unit: 'ft',
                  formula: 'length',
                  allowance: { wastePercent: 0 },
                },
              ],
            });
            setDirty(true);
          }}
        >
          New recipe
        </button>
        <button
          type="button"
          disabled={saving() || dirty()}
          onClick={() => {
            props.onClose();
          }}
        >
          Close
        </button>
      </div>
      <label class="field">
        Choose recipe
        <select
          aria-label="Choose recipe"
          value={draft()?.id ?? ''}
          disabled={dirty() || saving()}
          onChange={(event) => {
            const recipe =
              props.controller.project()?.recipes[event.currentTarget.value];
            if (recipe) begin(recipe);
            else setDraft(null);
          }}
        >
          <option value="">Select a recipe</option>
          <For each={Object.values(props.controller.project()?.recipes ?? {})}>
            {(recipe) => <option value={recipe.id}>{recipe.name}</option>}
          </For>
        </select>
      </label>
      <Show when={draft()}>
        {(recipe) => (
          <>
            <label class="field">
              Recipe name
              <input
                value={recipe().name}
                disabled={saving()}
                onInput={(event) => {
                  const name = event.currentTarget.value;
                  change((current) => ({
                    ...current,
                    name,
                  }));
                }}
              />
            </label>
            <fieldset disabled={saving()}>
              <legend>Compatible geometry</legend>
              <div class="button-row">
                <For each={kinds}>
                  {(kind) => (
                    <label>
                      <input
                        type="checkbox"
                        checked={recipe().geometryKinds.includes(kind)}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          change((current) => ({
                            ...current,
                            geometryKinds: checked
                              ? [...current.geometryKinds, kind]
                              : current.geometryKinds.filter(
                                  (value) => value !== kind,
                                ),
                          }));
                        }}
                      />{' '}
                      {kind}
                    </label>
                  )}
                </For>
              </div>
            </fieldset>
            <h3>Inputs</h3>
            <For each={recipe().inputs} keyed={false}>
              {(item, index) => (
                <fieldset disabled={saving()} class="stack">
                  <legend>Input {index + 1}</legend>
                  <div class="button-row">
                    <label class="field">
                      Name
                      <input
                        value={item().name}
                        onInput={(event) => {
                          input(index, { name: event.currentTarget.value });
                        }}
                      />
                    </label>
                    <label class="field">
                      Type
                      <select
                        value={item().type}
                        onChange={(event) => {
                          const type =
                            event.currentTarget.value === 'boolean'
                              ? 'boolean'
                              : 'number';
                          input(index, {
                            type,
                            default: type === 'boolean' ? false : 0,
                            unit: 'scalar',
                          });
                        }}
                      >
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                      </select>
                    </label>
                    <label class="field">
                      Unit
                      <select
                        value={item().unit}
                        disabled={item().type === 'boolean'}
                        onChange={(event) => {
                          input(index, {
                            unit: event.currentTarget.value as Unit,
                          });
                        }}
                      >
                        <For each={units}>
                          {(unit) => <option value={unit}>{unit}</option>}
                        </For>
                      </select>
                    </label>
                    <Show
                      when={item().type === 'number'}
                      fallback={
                        <label>
                          <input
                            type="checkbox"
                            checked={item().default === true}
                            onChange={(event) => {
                              input(index, {
                                default: event.currentTarget.checked,
                              });
                            }}
                          />{' '}
                          Default true
                        </label>
                      }
                    >
                      <label class="field">
                        Default
                        <input
                          type="number"
                          step="any"
                          value={Number(item().default)}
                          onChange={(event) => {
                            input(index, {
                              default: event.currentTarget.valueAsNumber,
                            });
                          }}
                        />
                      </label>
                    </Show>
                    <button
                      class="danger"
                      type="button"
                      onClick={() => {
                        change((current) => ({
                          ...current,
                          inputs: current.inputs.filter(
                            (_, at) => at !== index,
                          ),
                        }));
                      }}
                    >
                      Remove input
                    </button>
                  </div>
                </fieldset>
              )}
            </For>
            <button
              type="button"
              disabled={saving()}
              onClick={() => {
                change((current) => ({
                  ...current,
                  inputs: [
                    ...current.inputs,
                    {
                      name: `input${String(current.inputs.length + 1)}`,
                      type: 'number',
                      unit: 'scalar',
                      default: 1,
                    },
                  ],
                }));
              }}
            >
              Add input
            </button>
            <h3>Outputs</h3>
            <p class="muted">
              Use length, area, perimeter, count and declared input names.
              Formulas support arithmetic, ceil, floor, round, min, max and
              if(condition, yes, no). Output units must match the formula.
            </p>
            <For each={recipe().outputs} keyed={false}>
              {(item, index) => (
                <fieldset disabled={saving()} class="stack">
                  <legend>Output {index + 1}</legend>
                  <div class="button-row">
                    <label class="field">
                      Output name
                      <input
                        value={item().name}
                        onInput={(event) => {
                          output(index, { name: event.currentTarget.value });
                        }}
                      />
                    </label>
                    <label class="field">
                      Material ID
                      <input
                        value={item().materialId}
                        onInput={(event) => {
                          output(index, {
                            materialId: event.currentTarget.value,
                          });
                        }}
                      />
                    </label>
                    <label class="field">
                      Unit
                      <select
                        value={item().unit}
                        onChange={(event) => {
                          output(index, {
                            unit: event.currentTarget.value as Unit,
                          });
                        }}
                      >
                        <For each={units}>
                          {(unit) => <option value={unit}>{unit}</option>}
                        </For>
                      </select>
                    </label>
                  </div>
                  <label class="field">
                    Formula
                    <input
                      value={item().formula}
                      onInput={(event) => {
                        output(index, { formula: event.currentTarget.value });
                      }}
                    />
                  </label>
                  <div class="button-row">
                    <label class="field">
                      Waste %
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={item().allowance.wastePercent}
                        onChange={(event) => {
                          output(index, {
                            allowance: {
                              ...item().allowance,
                              wastePercent: event.currentTarget.valueAsNumber,
                            },
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
                        value={item().allowance.packageSize ?? ''}
                        onChange={(event) => {
                          output(index, {
                            allowance: {
                              wastePercent: item().allowance.wastePercent,
                              ...(event.currentTarget.value === ''
                                ? {}
                                : {
                                    packageSize:
                                      event.currentTarget.valueAsNumber,
                                  }),
                            },
                          });
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      class="danger"
                      onClick={() => {
                        change((current) => ({
                          ...current,
                          outputs: current.outputs.filter(
                            (_, at) => at !== index,
                          ),
                        }));
                      }}
                    >
                      Remove output
                    </button>
                  </div>
                </fieldset>
              )}
            </For>
            <button
              type="button"
              disabled={saving()}
              onClick={() => {
                change((current) => ({
                  ...current,
                  outputs: [
                    ...current.outputs,
                    {
                      id: crypto.randomUUID(),
                      name: 'Output',
                      materialId: 'material',
                      unit: 'scalar',
                      formula: '1',
                      allowance: { wastePercent: 0 },
                    },
                  ],
                }));
              }}
            >
              Add output
            </button>
            <Show when={validation().length > 0}>
              <div class="warning" role="status">
                <strong>
                  Formula check with sample measurements and default inputs
                </strong>
                <For each={validation()}>{(message) => <p>{message}</p>}</For>
              </div>
            </Show>
            <p role="alert">{error()}</p>
            <div class="button-row">
              <button
                class="primary"
                type="button"
                disabled={saving() || !dirty()}
                onClick={save}
              >
                {saving() ? 'Saving…' : 'Save recipe'}
              </button>
              <button
                type="button"
                disabled={saving()}
                onClick={() => {
                  setDraft(null);
                  setDirty(false);
                  setError('');
                }}
              >
                Cancel editing
              </button>
              <button
                type="button"
                class="danger"
                disabled={
                  saving() ||
                  dirty() ||
                  !props.controller.project()?.recipes[recipe().id]
                }
                onClick={remove}
              >
                Delete recipe
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
