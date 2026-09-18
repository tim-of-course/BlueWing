import { createSignal, For, onSettled, Show, untrack } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import type { Observation } from '../app/application';
import type { Sheet } from '../core/types';
import './SheetNamesDialog.css';

interface Row {
  sheet: Sheet;
  name: string;
  selected: boolean;
  status: string;
  matched: boolean;
}

export default function SheetNamesDialog(props: {
  sheets: Sheet[];
  expected: Observation;
  controller: WorkspaceController;
  onClose: () => void;
}) {
  let dialog: HTMLDialogElement | undefined;
  const initial = untrack(() => ({
    sheets: props.sheets,
    expected: props.expected,
  }));
  const [rows, setRows] = createSignal<Row[]>(
    initial.sheets.map((sheet) => ({
      sheet,
      name: '',
      selected: false,
      status: 'Reading embedded text…',
      matched: false,
    })),
  );
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const selected = () =>
    rows().filter(
      (row) =>
        row.selected && row.matched && row.name.trim() !== row.sheet.name,
    );
  const valid = () =>
    selected().length > 0 && selected().every((row) => row.name.trim());
  function update(index: number, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row, at) => (at === index ? { ...row, ...patch } : row)),
    );
  }
  onSettled(() => {
    const focus = document.activeElement;
    const lifetime = { disposed: false };
    const isDisposed = () => lifetime.disposed;
    dialog?.showModal();
    void (async () => {
      for (const [index, sheet] of initial.sheets.entries()) {
        if (isDisposed()) return;
        try {
          const result = await props.controller.suggestSheetName(sheet);
          if (isDisposed()) return;
          if (result.status === 'suggested')
            update(index, {
              name: result.name,
              selected: result.name !== sheet.name,
              matched: true,
              status: result.title
                ? 'Code and nearby title found'
                : 'Code found; no nearby title',
            });
          else
            update(index, {
              status:
                result.status === 'no-embedded-text'
                  ? 'No embedded text. Name unchanged.'
                  : 'No sheet code found. Name unchanged.',
            });
        } catch (cause) {
          if (isDisposed()) return;
          update(index, {
            status: `Could not read text: ${cause instanceof Error ? cause.message : String(cause)}. Name unchanged.`,
          });
        }
      }
      if (!isDisposed()) setLoading(false);
    })();
    return () => {
      lifetime.disposed = true;
      dialog?.close();
      if (focus instanceof HTMLElement) focus.focus({ preventScroll: true });
    };
  });
  async function apply() {
    if (loading() || saving() || !valid()) return;
    setSaving(true);
    setError('');
    try {
      await props.controller.renameSheets(
        selected().map((row) => ({ id: row.sheet.id, name: row.name.trim() })),
        initial.expected,
      );
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
      class="dialog sheet-names-dialog"
      aria-labelledby="sheet-names-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving()) props.onClose();
      }}
    >
      <h2 id="sheet-names-title">Auto-name sheets</h2>
      <p>
        Review names from embedded PDF text in the bottom-right quarter of each
        page. Processing stays on this device; scanned pages need manual names.
      </p>
      <p class="hint">
        Nothing changes until you apply. Undo restores all applied names
        together.
      </p>
      <form
        class="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <p role="status">
          {loading()
            ? 'Reading sheet names…'
            : `${String(selected().length)} sheet names selected`}
        </p>
        <div class="sheet-name-rows">
          <For each={rows()} keyed={false}>
            {(row, index) => (
              <div class="sheet-name-row">
                <input
                  type="checkbox"
                  aria-label={`Rename ${row().sheet.name}`}
                  checked={row().selected}
                  disabled={!row().matched || saving()}
                  onChange={(event) => {
                    update(index, { selected: event.currentTarget.checked });
                  }}
                />
                <div class="stack">
                  <span class="sheet-name-current">{row().sheet.name}</span>
                  <Show when={row().matched}>
                    <input
                      aria-label={`Suggested name for ${row().sheet.name}`}
                      value={row().name}
                      disabled={saving()}
                      onInput={(event) => {
                        update(index, { name: event.currentTarget.value });
                      }}
                    />
                  </Show>
                  <small class="muted">{row().status}</small>
                </div>
              </div>
            )}
          </For>
        </div>
        <Show when={error()}>
          <p role="alert">{error()}</p>
        </Show>
        <div class="button-row">
          <button
            class="primary"
            type="submit"
            disabled={loading() || saving() || !valid()}
          >
            {saving() ? 'Saving…' : `Apply ${String(selected().length)} names`}
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
