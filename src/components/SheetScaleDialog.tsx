import { createSignal, For, onSettled, Show, untrack } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import type { Observation } from '../app/application';
import type { LengthUnit, Sheet } from '../core/types';
import {
  formatScale,
  matchingScalePreset,
  scalePresets,
  type PaperScale,
} from '../core/scale';

export default function SheetScaleDialog(props: {
  sheet: Sheet;
  expected: Observation;
  controller: WorkspaceController;
  onClose: () => void;
  onMeasure: () => void;
}) {
  let dialog: HTMLDialogElement | undefined;
  const initial = untrack(() => props.sheet.calibration);
  const matched = matchingScalePreset(initial);
  const [method, setMethod] = createSignal<'preset' | 'ratio' | 'measure'>(
    initial && !matched ? 'ratio' : 'preset',
    { name: 'scale.method' },
  );
  const [preset, setPreset] = createSignal(matched?.label ?? '1/4″ = 1′-0″');
  const [paperValue, setPaperValue] = createSignal('1');
  const [paperUnit, setPaperUnit] = createSignal<LengthUnit>('in');
  const [realValue, setRealValue] = createSignal(
    initial ? String((initial.metresPerUnit * 72) / 0.3048) : '1',
  );
  const [realUnit, setRealUnit] = createSignal<LengthUnit>('ft');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const valid = () =>
    [Number(paperValue()), Number(realValue())].every(
      (value) => Number.isFinite(value) && value > 0,
    );
  onSettled(() => {
    const focus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (focus instanceof HTMLElement) focus.focus({ preventScroll: true });
    };
  });
  async function apply() {
    if (saving()) return;
    if (method() === 'measure') {
      props.onMeasure();
      return;
    }
    const scale: PaperScale | undefined =
      method() === 'preset'
        ? scalePresets.find((item) => item.label === preset())
        : {
            paper: { value: Number(paperValue()), unit: paperUnit() },
            real: { value: Number(realValue()), unit: realUnit() },
          };
    if (!scale) return;
    setSaving(true);
    setError('');
    try {
      await props.controller.setScale(props.sheet.id, scale, props.expected);
      props.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      class="dialog sheet-scale-dialog"
      aria-labelledby="sheet-scale-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving()) props.onClose();
      }}
    >
      <h2 id="sheet-scale-title">Set sheet scale</h2>
      <p class="muted">{props.sheet.name}</p>
      <p>Use the scale printed on this sheet.</p>
      <p class="hint">Current: {formatScale(props.sheet.calibration)}</p>
      <form
        class="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <div class="button-row" role="group" aria-label="Scale method">
          <For
            each={
              [
                { id: 'preset', label: 'Preset' },
                { id: 'ratio', label: 'Custom ratio' },
                { id: 'measure', label: 'Two points' },
              ] as const
            }
          >
            {(item) => (
              <button
                type="button"
                class={method() === item.id ? 'active' : ''}
                aria-pressed={method() === item.id ? 'true' : 'false'}
                disabled={saving()}
                onClick={() => setMethod(item.id)}
              >
                {item.label}
              </button>
            )}
          </For>
        </div>
        <Show when={method() === 'preset'}>
          <label class="field">
            Printed scale
            <select
              value={preset()}
              disabled={saving()}
              onChange={(event) => setPreset(event.currentTarget.value)}
            >
              <For each={scalePresets}>
                {(item) => <option value={item.label}>{item.label}</option>}
              </For>
            </select>
          </label>
        </Show>
        <Show when={method() === 'ratio'}>
          <div class="scale-ratio-fields">
            <label class="field">
              Paper distance
              <input
                type="number"
                min="0"
                step="any"
                value={paperValue()}
                disabled={saving()}
                onInput={(event) => setPaperValue(event.currentTarget.value)}
              />
            </label>
            <label class="field">
              Paper unit
              <select
                value={paperUnit()}
                disabled={saving()}
                onChange={(event) =>
                  setPaperUnit(event.currentTarget.value as LengthUnit)
                }
              >
                <option value="in">inches</option>
                <option value="mm">mm</option>
                <option value="m">metres</option>
                <option value="ft">feet</option>
              </select>
            </label>
            <label class="field">
              Real distance
              <input
                type="number"
                min="0"
                step="any"
                value={realValue()}
                disabled={saving()}
                onInput={(event) => setRealValue(event.currentTarget.value)}
              />
            </label>
            <label class="field">
              Real unit
              <select
                value={realUnit()}
                disabled={saving()}
                onChange={(event) =>
                  setRealUnit(event.currentTarget.value as LengthUnit)
                }
              >
                <option value="ft">feet</option>
                <option value="in">inches</option>
                <option value="m">metres</option>
                <option value="mm">mm</option>
              </select>
            </label>
          </div>
          <p class="hint">
            For 1:100, enter 1 mm on paper = 100 mm real distance.
          </p>
        </Show>
        <Show when={method() === 'measure'}>
          <p>
            Click the ends of a known dimension on the plan, then enter its real
            length.
          </p>
        </Show>
        <Show when={error()}>
          <p role="alert">{error()}</p>
        </Show>
        <div class="button-row">
          <button
            class="primary"
            type="submit"
            disabled={saving() || (method() === 'ratio' && !valid())}
          >
            {saving()
              ? 'Saving…'
              : method() === 'measure'
                ? 'Measure on plan'
                : 'Apply scale'}
          </button>
          <button
            type="button"
            disabled={saving()}
            onClick={() => {
              props.onClose();
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}
