import { createSignal, For, Show } from 'solid-js';
import type { AssemblyComponent, Recipe, RecipeOutput } from '../core/types';
import { formulaQuantity } from '../core/formula';

export default function SystemComponents(props: {
  recipe: Recipe;
  available: Recipe[];
  onChange: (recipe: Recipe) => void;
}) {
  const [source, setSource] = createSignal('');
  const patch = (
    id: string,
    update: (component: AssemblyComponent) => AssemblyComponent,
  ) => {
    props.onChange({
      ...props.recipe,
      components:
        props.recipe.components?.map((c) =>
          c.id === id ? update(structuredClone(c)) : c,
        ) ?? [],
    });
  };
  const output = (id: string, index: number, update: Partial<RecipeOutput>) => {
    patch(id, (c) => ({
      ...c,
      assembly: {
        ...c.assembly,
        outputs: c.assembly.outputs.map((item, i) =>
          i === index ? { ...item, ...update } : item,
        ),
      },
    }));
  };
  function add() {
    const original = props.available.find((recipe) => recipe.id === source());
    if (
      !original ||
      original.components ||
      original.wallTemplate ||
      original.ceilingTemplate
    )
      return;
    const bindings: Record<string, string> = {};
    const inputs = [...props.recipe.inputs];
    for (const input of original.inputs) {
      let shared = inputs.find((field) => field.name === input.name);
      if (!shared) {
        shared = structuredClone(input);
        inputs.push(shared);
      }
      if (
        shared.type === input.type &&
        formulaQuantity({ value: 1, unit: shared.unit }).dimension ===
          formulaQuantity({ value: 1, unit: input.unit }).dimension
      )
        bindings[input.name] = shared.name;
    }
    props.onChange({
      ...props.recipe,
      inputs,
      geometryKinds: original.geometryKinds.filter((kind) =>
        (props.recipe.components ?? []).every((c) =>
          c.assembly.geometryKinds.includes(kind),
        ),
      ),
      components: [
        ...(props.recipe.components ?? []),
        {
          id: crypto.randomUUID(),
          assembly: structuredClone(original),
          bindings,
        },
      ],
    });
  }
  return (
    <section class="stack">
      <h3>System components</h3>
      <p class="hint">
        Each component is an independent copy. Shared inputs connect dimensions
        across the system. Add a second drywall component for the other wall
        face. These formula estimates do not place materials in 3D.
      </p>
      <div class="button-row">
        <label class="field">
          Assembly to add
          <select
            value={source()}
            onChange={(e) => setSource(e.currentTarget.value)}
          >
            <option value="">Choose assembly…</option>
            <For
              each={props.available.filter(
                (recipe) =>
                  !recipe.components &&
                  !recipe.wallTemplate &&
                  !recipe.ceilingTemplate &&
                  recipe.id !== props.recipe.id,
              )}
            >
              {(recipe) => <option value={recipe.id}>{recipe.name}</option>}
            </For>
          </select>
        </label>
        <button type="button" disabled={!source()} onClick={add}>
          Add component
        </button>
      </div>
      <For each={props.recipe.components ?? []} keyed={(c) => c.id}>
        {(component) => (
          <fieldset class="stack">
            <legend>{component().assembly.name}</legend>
            <label class="field">
              Component name
              <input
                value={component().assembly.name}
                onInput={(e) => {
                  const name = e.currentTarget.value;
                  patch(component().id, (c) => ({
                    ...c,
                    assembly: { ...c.assembly, name },
                  }));
                }}
              />
            </label>
            <For
              each={component().assembly.inputs}
              keyed={(input) => input.name}
            >
              {(input) => (
                <div class="button-row">
                  <label class="field">
                    {input().name} ({input().unit})
                    <select
                      value={component().bindings[input().name] ?? ''}
                      onChange={(e) => {
                        const binding = e.currentTarget.value;
                        patch(component().id, (c) => {
                          if (binding) c.bindings[input().name] = binding;
                          else Reflect.deleteProperty(c.bindings, input().name);
                          return c;
                        });
                      }}
                    >
                      <option value="">Component default</option>
                      <For
                        each={props.recipe.inputs.filter(
                          (shared) =>
                            shared.type === input().type &&
                            formulaQuantity({ value: 1, unit: shared.unit })
                              .dimension ===
                              formulaQuantity({ value: 1, unit: input().unit })
                                .dimension,
                        )}
                      >
                        {(shared) => (
                          <option value={shared.name}>
                            {shared.name} ({shared.unit})
                          </option>
                        )}
                      </For>
                    </select>
                  </label>
                  <Show when={!component().bindings[input().name]}>
                    <label class="field">
                      Component default
                      <Show
                        when={input().type === 'boolean'}
                        fallback={
                          <input
                            type="number"
                            step="any"
                            value={
                              typeof input().default === 'number'
                                ? (input().default as number)
                                : ''
                            }
                            onInput={(e) => {
                              const raw = e.currentTarget.value;
                              patch(component().id, (c) => ({
                                ...c,
                                assembly: {
                                  ...c.assembly,
                                  inputs: c.assembly.inputs.map((field) => {
                                    if (field.name !== input().name)
                                      return field;
                                    const next = { ...field };
                                    if (raw === '') delete next.default;
                                    else next.default = Number(raw);
                                    return next;
                                  }),
                                },
                              }));
                            }}
                          />
                        }
                      >
                        <select
                          value={
                            input().default === undefined
                              ? ''
                              : String(input().default)
                          }
                          onChange={(e) => {
                            const raw = e.currentTarget.value;
                            patch(component().id, (c) => ({
                              ...c,
                              assembly: {
                                ...c.assembly,
                                inputs: c.assembly.inputs.map((field) => {
                                  if (field.name !== input().name) return field;
                                  const next = { ...field };
                                  if (raw === '') delete next.default;
                                  else next.default = raw === 'true';
                                  return next;
                                }),
                              },
                            }));
                          }}
                        >
                          <option value="">Required</option>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      </Show>
                    </label>
                  </Show>
                </div>
              )}
            </For>
            <For each={component().assembly.outputs} keyed={false}>
              {(item, index) => (
                <details>
                  <summary>{item().name}</summary>
                  <div class="construction-fields">
                    <label class="field">
                      Material / product
                      <input
                        value={item().materialId}
                        onInput={(e) => {
                          output(component().id, index, {
                            materialId: e.currentTarget.value,
                          });
                        }}
                      />
                    </label>
                    <label class="field">
                      Formula
                      <input
                        value={item().formula}
                        onInput={(e) => {
                          output(component().id, index, {
                            formula: e.currentTarget.value,
                          });
                        }}
                      />
                    </label>
                    <label class="field">
                      Waste (%)
                      <input
                        type="number"
                        step="any"
                        value={item().allowance.wastePercent}
                        onInput={(e) => {
                          output(component().id, index, {
                            allowance: {
                              ...item().allowance,
                              wastePercent: e.currentTarget.valueAsNumber,
                            },
                          });
                        }}
                      />
                    </label>
                    <label class="field">
                      Package size
                      <input
                        type="number"
                        step="any"
                        value={item().allowance.packageSize ?? ''}
                        onInput={(e) => {
                          const allowance = { ...item().allowance };
                          if (e.currentTarget.value === '')
                            delete allowance.packageSize;
                          else
                            allowance.packageSize =
                              e.currentTarget.valueAsNumber;
                          output(component().id, index, { allowance });
                        }}
                      />
                    </label>
                    <Show when={item().piece}>
                      {(piece) => (
                        <>
                          <label class="field">
                            Cut length formula ({piece().cutLength.unit})
                            <input
                              value={piece().cutLength.formula}
                              onInput={(e) => {
                                output(component().id, index, {
                                  piece: {
                                    ...piece(),
                                    cutLength: {
                                      ...piece().cutLength,
                                      formula: e.currentTarget.value,
                                    },
                                  },
                                });
                              }}
                            />
                          </label>
                          <Show when={piece().stockLength}>
                            {(stock) => (
                              <label class="field">
                                Stock length formula ({stock().unit})
                                <input
                                  value={stock().formula}
                                  onInput={(e) => {
                                    output(component().id, index, {
                                      piece: {
                                        ...piece(),
                                        stockLength: {
                                          ...stock(),
                                          formula: e.currentTarget.value,
                                        },
                                      },
                                    });
                                  }}
                                />
                              </label>
                            )}
                          </Show>
                        </>
                      )}
                    </Show>
                  </div>
                </details>
              )}
            </For>
            <button
              type="button"
              onClick={() => {
                props.onChange({
                  ...props.recipe,
                  components:
                    props.recipe.components?.filter(
                      (c) => c.id !== component().id,
                    ) ?? [],
                });
              }}
            >
              Remove component
            </button>
          </fieldset>
        )}
      </For>
    </section>
  );
}
