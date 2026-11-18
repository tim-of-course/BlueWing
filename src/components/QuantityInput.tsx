import { createSignal, Show } from 'solid-js';
import { formatLength, lengthError, parseLength } from '../core/length';
import type { Unit } from '../core/types';

export default function QuantityInput(props: {
  value: number | undefined;
  unit: Unit;
  onChange: (value: number | undefined) => void;
  minimum?: number | undefined;
  disabled?: boolean | undefined;
  placeholder?: string | undefined;
}) {
  const [draft, setDraft] = createSignal<string | null>(null);
  const [invalidText, setInvalidText] = createSignal<string | null>(null);
  const invalid = () => invalidText() !== null && Number.isNaN(props.value);
  const length = () => props.unit === 'ft' || props.unit === 'in';
  const display = () => {
    const value = props.value;
    if (value === undefined || !Number.isFinite(value)) return '';
    return length()
      ? formatLength(props.unit === 'in' ? value / 12 : value)
      : String(value);
  };
  return (
    <>
      <input
        type={length() ? 'text' : 'number'}
        min={length() ? undefined : props.minimum}
        step={length() ? undefined : 'any'}
        disabled={props.disabled}
        placeholder={props.placeholder}
        aria-invalid={invalid() ? 'true' : undefined}
        value={(invalid() ? invalidText() : draft()) ?? display()}
        onInput={(event) => {
          const raw = event.currentTarget.value;
          setDraft(raw);
          let value;
          try {
            value =
              raw === ''
                ? undefined
                : length()
                  ? parseLength(raw) * (props.unit === 'in' ? 12 : 1)
                  : event.currentTarget.valueAsNumber;
            setInvalidText(null);
          } catch {
            value = NaN;
            setInvalidText(raw);
          }
          props.onChange(value);
        }}
        onBlur={() => {
          setDraft(null);
        }}
      />
      <Show when={invalid()}>
        <small role="alert">{lengthError}</small>
      </Show>
    </>
  );
}
