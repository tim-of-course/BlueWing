import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  onSettled,
} from 'solid-js';
import {
  evaluateFormula,
  formulaOutput,
  formulaQuantity,
} from '../core/formula';
import type { FormulaValue } from '../core/formula';
import type { WorkspaceController } from '../app/contracts';
import type { Observation } from '../app/application';
import { calculateProject } from '../core/calculations';
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
  const [scope, setScope] = createSignal<'project' | 'global'>('project');
  let libraryRevision = 0;
  const [error, setError] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const preview = createMemo(
    () => {
      const recipe = draft();
      const project = props.controller.project();
      const ids = props.controller.selection();
      if (!recipe || !project || !ids.length) return null;
      return calculateProject({
        ...project,
        recipes: { [recipe.id]: recipe },
        groups: {
          preview: {
            id: 'preview',
            name: 'Selected drawing',
            geometryIds: ids,
          },
        },
        assignments: {
          preview: {
            id: 'preview',
            groupId: 'preview',
            recipeId: recipe.id,
            inputs: {},
            allowances: {},
          },
        },
      });
    },
    { name: 'recipe.selectedDrawingPreview' },
  );
  const validation = createMemo(
    () => {
      const recipe = draft();
      if (!recipe) return [];
      const messages: string[] = [];
      for (const kind of recipe.geometryKinds) {
        for (const output of recipe.outputs) {
          try {
            const values: Record<string, FormulaValue> = {};
            for (const input of recipe.inputs) {
              if (input.default === undefined)
                throw new Error(`Required input: ${input.name}`);
              values[input.name] =
                typeof input.default === 'boolean'
                  ? input.default
                  : formulaQuantity({ value: input.default, unit: input.unit });
            }
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
    libraryRevision = props.controller.library()?.revision ?? 0;
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
    void (
      scope() === 'project'
        ? props.controller.saveRecipe(recipe, observation)
        : props.controller.saveLibraryAssembly(recipe, libraryRevision)
    )
      .then(() => {
        setDirty(false);
        observation = controller.observe();
        libraryRevision = controller.library()?.revision ?? 0;
      })
      .catch(report)
      .finally(() => setSaving(false));
  };
  const remove = () => {
    const recipe = draft();
    if (!recipe) return;
    setSaving(true);
    void (
      scope() === 'project'
        ? props.controller.deleteRecipe(recipe.id)
        : props.controller.deleteLibraryAssembly(recipe.id, libraryRevision)
    )
      .then(() => {
        setDraft(null);
        setDirty(false);
      })
      .catch(report)
      .finally(() => setSaving(false));
  };
  onSettled(() => {
    void props.controller.refreshLibrary().catch(report);
  });
  const definitions = () =>
    scope() === 'project'
      ? (props.controller.project()?.recipes ?? {})
      : (props.controller.library()?.assemblies ?? {});
  const transfer = () => {
    const recipe = draft();
    if (!recipe) return;
    const controller = props.controller;
    setSaving(true);
    void (async () => {
      if (scope() === 'global') {
        const id = await controller.importAssembly(recipe.id);
        setScope('project');
        begin({
          ...structuredClone(recipe),
          id,
          librarySource: { id: recipe.id, name: recipe.name },
        });
      } else {
        const copy = { ...structuredClone(recipe), id: crypto.randomUUID() };
        delete copy.librarySource;
        await controller.saveLibraryAssembly(
          copy,
          controller.library()?.revision ?? 0,
        );
        setScope('global');
        begin(copy);
      }
    })()
      .catch(report)
      .finally(() => setSaving(false));
  };
  return (
    <div class="stack">
      <div class="button-row">
        <h2>Assemblies</h2>
        <button
          type="button"
          disabled={saving() || dirty()}
          onClick={() => {
            begin({
              id: crypto.randomUUID(),
              name: 'New assembly',
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
          New assembly
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
      <div class="button-row" aria-label="Assembly scope">
        <button
          type="button"
          aria-pressed={scope() === 'project' ? 'true' : 'false'}
          disabled={dirty() || saving()}
          onClick={() => {
            setScope('project');
            setDraft(null);
          }}
        >
          Project assemblies
        </button>
        <button
          type="button"
          aria-pressed={scope() === 'global' ? 'true' : 'false'}
          disabled={dirty() || saving()}
          onClick={() => {
            setScope('global');
            setDraft(null);
          }}
        >
          Global library
        </button>
        <button
          type="button"
          disabled={dirty() || saving()}
          onClick={() => {
            setDraft(null);
            void props.controller.refreshLibrary().catch(report);
          }}
        >
          Refresh library
        </button>
        <Show when={scope() === 'global'}>
          <button
            type="button"
            disabled={dirty() || saving() || !props.controller.library()}
            title="Add missing starters, including deleted starters. Existing definitions stay unchanged."
            onClick={() => {
              const controller = props.controller;
              setSaving(true);
              void controller
                .addLibraryStarters(controller.library()?.revision ?? 0)
                .then(() => {
                  libraryRevision = controller.library()?.revision ?? 0;
                })
                .catch(report)
                .finally(() => setSaving(false));
            }}
          >
            Add missing starters
          </button>
        </Show>
      </div>
      <p class="muted">
        {scope() === 'project'
          ? 'Project assemblies are saved with this file. Editing one updates its assignments and supports Undo.'
          : 'Global assemblies are saved on this device. Import creates an independent project copy. Global changes do not use project Undo.'}
      </p>
      <label class="field">
        Choose assembly
        <select
          aria-label="Choose assembly"
          value={draft()?.id ?? ''}
          disabled={dirty() || saving()}
          onChange={(event) => {
            const recipe = definitions()[event.currentTarget.value];
            if (recipe) begin(recipe);
            else setDraft(null);
          }}
        >
          <option value="">Select an assembly</option>
          <For each={Object.values(definitions())}>
            {(recipe) => <option value={recipe.id}>{recipe.name}</option>}
          </For>
        </select>
      </label>
      <Show when={draft()}>
        {(recipe) => (
          <>
            <label class="field">
              Assembly name
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
            <div class="button-row">
              <button
                type="button"
                disabled={
                  dirty() ||
                  saving() ||
                  !definitions()[recipe().id] ||
                  !props.controller.library()
                }
                onClick={transfer}
              >
                {scope() === 'project'
                  ? 'Save a copy to global library'
                  : 'Import into project'}
              </button>
              <button
                type="button"
                disabled={dirty() || saving()}
                onClick={() => {
                  begin({
                    ...structuredClone(recipe()),
                    id: crypto.randomUUID(),
                    name: `${recipe().name} copy`,
                  });
                  setDirty(true);
                }}
              >
                Duplicate assembly
              </button>
            </div>
            <Show when={recipe().librarySource}>
              <p class="muted">
                Copied from global library: {recipe().librarySource?.name}. This
                definition is independent.
              </p>
            </Show>
            <label class="field">
              Category
              <input
                value={recipe().category ?? ''}
                disabled={saving()}
                onInput={(event) => {
                  const category = event.currentTarget.value;
                  change((current) => ({ ...current, category }));
                }}
              />
            </label>
            <label class="field">
              Description
              <textarea
                value={recipe().description ?? ''}
                disabled={saving()}
                onInput={(event) => {
                  const description = event.currentTarget.value;
                  change((current) => ({ ...current, description }));
                }}
              />
            </label>
            <label class="field">
              Detail / specification reference
              <input
                value={recipe().reference ?? ''}
                disabled={saving()}
                onInput={(event) => {
                  const reference = event.currentTarget.value;
                  change((current) => ({ ...current, reference }));
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
                          change((current) => ({
                            ...current,
                            inputs: current.inputs.map((field, at) => {
                              if (at !== index) return field;
                              const next: RecipeInput = {
                                ...field,
                                type,
                                default: type === 'boolean' ? false : 0,
                                unit: 'scalar' as const,
                              };
                              delete next.minimum;
                              return next;
                            }),
                          }));
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
                          value={
                            item().default === undefined
                              ? ''
                              : Number(item().default)
                          }
                          disabled={item().default === undefined}
                          onChange={(event) => {
                            input(index, {
                              default: event.currentTarget.valueAsNumber,
                            });
                          }}
                        />
                      </label>
                    </Show>
                    <label>
                      <input
                        type="checkbox"
                        checked={item().default === undefined}
                        onChange={(event) => {
                          const required = event.currentTarget.checked;
                          change((current) => ({
                            ...current,
                            inputs: current.inputs.map((field, at) => {
                              if (at !== index) return field;
                              const next = { ...field };
                              if (required) delete next.default;
                              else
                                next.default =
                                  field.type === 'boolean' ? false : 0;
                              return next;
                            }),
                          }));
                        }}
                      />{' '}
                      Required input (no default)
                    </label>
                    <Show when={item().type === 'number'}>
                      <label class="field">
                        Minimum (optional)
                        <input
                          type="number"
                          step="any"
                          value={item().minimum ?? ''}
                          onChange={(event) => {
                            const minimum =
                              event.currentTarget.value === ''
                                ? undefined
                                : event.currentTarget.valueAsNumber;
                            change((current) => ({
                              ...current,
                              inputs: current.inputs.map((field, at) => {
                                if (at !== index) return field;
                                const next = { ...field };
                                if (minimum === undefined) delete next.minimum;
                                else next.minimum = minimum;
                                return next;
                              }),
                            }));
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
            <details class="formula-reference">
              <summary>Variables, units and formula reference</summary>
              <p>
                Path: <code>length</code>. Area: <code>area</code> and{' '}
                <code>perimeter</code>. Count: <code>count</code>. Only the
                measurements available for the drawing type can be used.
              </p>
              <p>
                Inputs in this assembly:{' '}
                {recipe()
                  .inputs.map((input) => `${input.name} (${input.unit})`)
                  .join(', ') || 'None'}
                .
              </p>
              <p>
                Arithmetic: <code>+ - * / ^</code>. Comparison:{' '}
                <code>&lt; &lt;= &gt; &gt;= == !=</code>. Conditions:{' '}
                <code>if(condition, yes, no)</code>. Functions:{' '}
                <code>ceil, floor, round, min, max</code>.
              </p>
              <p>
                Declared input units supply dimensions. For example,{' '}
                <code>length * height * layers</code> produces area when height
                is a length and layers is scalar. Units convert automatically to
                the output unit. Plain numbers have no length or area unit.
              </p>
            </details>
            <Show when={preview()}>
              {(result) => (
                <details class="formula-reference">
                  <summary>Preview on selected drawing</summary>
                  <p>
                    Base quantities using this assembly's default inputs, before
                    waste and package rounding. Preview does not save or assign
                    the assembly.
                  </p>
                  <For each={result().outputs}>
                    {(output) => (
                      <div>
                        <strong>
                          {output.name}:{' '}
                          {output.complete
                            ? `${output.baseAmount.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${output.unit}`
                            : 'Unavailable'}
                        </strong>
                        <For each={output.diagnostics}>
                          {(message) => <p class="warning">{message}</p>}
                        </For>
                      </div>
                    )}
                  </For>
                </details>
              )}
            </Show>
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
                      Material / product
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
                  <label>
                    <input
                      type="checkbox"
                      checked={!!item().piece}
                      onChange={(event) => {
                        const enabled = event.currentTarget.checked;
                        change((current) => ({
                          ...current,
                          outputs: current.outputs.map((entry, at) => {
                            if (at !== index) return entry;
                            const next = { ...entry };
                            if (enabled) {
                              next.unit = 'ea';
                              next.piece = {
                                role: entry.name,
                                cutLength: { formula: 'height', unit: 'ft' },
                              };
                            } else delete next.piece;
                            return next;
                          }),
                        }));
                      }}
                    />{' '}
                    Schedule pieces with cut lengths
                  </label>
                  <Show when={item().piece}>
                    {(piece) => (
                      <div class="stack">
                        <label class="field">
                          Piece role
                          <input
                            value={piece().role}
                            onInput={(event) => {
                              output(index, {
                                piece: {
                                  ...piece(),
                                  role: event.currentTarget.value,
                                },
                              });
                            }}
                          />
                        </label>
                        <label class="field">
                          Cut length formula
                          <input
                            value={piece().cutLength.formula}
                            onInput={(event) => {
                              output(index, {
                                piece: {
                                  ...piece(),
                                  cutLength: {
                                    ...piece().cutLength,
                                    formula: event.currentTarget.value,
                                  },
                                },
                              });
                            }}
                          />
                        </label>
                        <label class="field">
                          Stock length formula (optional)
                          <input
                            value={piece().stockLength?.formula ?? ''}
                            onInput={(event) => {
                              const next = { ...piece() };
                              if (event.currentTarget.value)
                                next.stockLength = {
                                  formula: event.currentTarget.value,
                                  unit: 'ft',
                                };
                              else delete next.stockLength;
                              output(index, { piece: next });
                            }}
                          />
                        </label>
                        <p class="muted">
                          Length formulas use declared length inputs. Pieces
                          require whole-number quantities in ea. Stock length
                          must cover the cut length; cutting several pieces from
                          one stock length is not optimized.
                        </p>
                      </div>
                    )}
                  </Show>
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
                {saving() ? 'Saving…' : 'Save assembly'}
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
                disabled={saving() || dirty() || !definitions()[recipe().id]}
                onClick={remove}
              >
                Delete assembly
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
