import { createSignal, For, Show } from 'solid-js';
import type { RecipeInput } from '../core/types';

export default function AssemblyInputs(props: {
  inputs: RecipeInput[];
  values: Record<string, number | boolean>;
  inherited?: Record<string, number | boolean>;
  disabled?: boolean;
  onChange: (values: Record<string, number | boolean>) => void;
}) {
  const set = (name: string, value: number | boolean | undefined) => {
    const next = { ...props.values };
    if (value === undefined) Reflect.deleteProperty(next, name);
    else next[name] = value;
    props.onChange(next);
  };
  return (
    <div class="stack">
      <For each={props.inputs} keyed={(input) => input.name}>
        {(input) => {
          const [editingValue, setEditingValue] = createSignal<string | null>(
            null,
          );
          const effective = () =>
            props.values[input().name] ??
            props.inherited?.[input().name] ??
            input().default;
          return (
            <div class="stack">
              <label class="field">
                {input().name} ({input().unit})
                <Show
                  when={input().type === 'number'}
                  fallback={
                    <select
                      disabled={props.disabled}
                      value={
                        effective() === undefined ? '' : String(effective())
                      }
                      onChange={(event) => {
                        set(
                          input().name,
                          event.currentTarget.value === ''
                            ? undefined
                            : event.currentTarget.value === 'true',
                        );
                      }}
                    >
                      <option value="">Required</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  }
                >
                  <input
                    type="number"
                    step="any"
                    min={input().minimum}
                    disabled={props.disabled}
                    placeholder={
                      input().default === undefined ? 'Required' : ''
                    }
                    value={
                      editingValue() ??
                      (effective() === undefined ? '' : Number(effective()))
                    }
                    onBlur={() => {
                      setEditingValue(null);
                    }}
                    onInput={(event) => {
                      setEditingValue(event.currentTarget.value);
                      set(
                        input().name,
                        event.currentTarget.value === ''
                          ? undefined
                          : event.currentTarget.valueAsNumber,
                      );
                    }}
                  />
                </Show>
              </label>
              <div class="button-row">
                <small class="muted">
                  {Object.hasOwn(props.values, input().name)
                    ? 'Override'
                    : props.inherited?.[input().name] !== undefined
                      ? 'Group value'
                      : input().default !== undefined
                        ? 'Assembly default'
                        : 'Value required'}
                </small>
                <button
                  type="button"
                  disabled={
                    props.disabled || !Object.hasOwn(props.values, input().name)
                  }
                  onClick={() => {
                    set(input().name, undefined);
                  }}
                >
                  Reset {input().name}
                </button>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}
