import { createEffect, createMemo, createSignal } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import type { Observation } from '../app/application';
import { noteMatches } from '../core/notes';

interface Props {
  controller: WorkspaceController;
  onDraftChange: (dirty: boolean) => void;
  onError: (message: string) => void;
}

export default function NotesPanel(props: Props) {
  const [draft, setDraft] = createSignal<{
    markdown: string;
    expected: Observation;
  } | null>(null);
  const [query, setQuery] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const markdown = createMemo(
    () => draft()?.markdown ?? props.controller.project()?.notes ?? '',
  );
  const matches = createMemo(
    () => (query() ? noteMatches(markdown(), query()) : []),
    {
      name: 'notes.matches',
      equals: (a, b) =>
        a.length === b.length &&
        a.every(
          (match, i) => match.start === b[i]?.start && match.end === b[i].end,
        ),
    },
  );
  let editor: HTMLTextAreaElement | undefined;
  let matchIndex = -1;
  function clearDraft() {
    setDraft(null);
    props.onDraftChange(false);
  }
  let projectId: string | undefined;
  createEffect(
    () => props.controller.project()?.id,
    (id) => {
      if (id === projectId) return;
      projectId = id;
      clearDraft();
      setQuery('');
      matchIndex = -1;
    },
    { name: 'notes.project' },
  );
  function find(direction: number) {
    const found = matches();
    if (!found.length) return;
    matchIndex =
      matchIndex < 0
        ? direction > 0
          ? 0
          : found.length - 1
        : (matchIndex + direction + found.length) % found.length;
    const match = found[matchIndex];
    if (editor && match) {
      editor.focus();
      editor.setSelectionRange(match.start, match.end);
    }
  }
  async function save() {
    const pending = draft();
    if (!pending || saving()) return;
    setSaving(true);
    try {
      await props.controller.execute(
        { name: 'notes.write', payload: { markdown: pending.markdown } },
        pending.expected,
      );
      clearDraft();
    } catch (error) {
      props.onError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section class="panel-section stack" aria-label="Project notes">
      <label class="field">
        Find in notes
        <input
          aria-label="Find in notes"
          value={query()}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            matchIndex = -1;
          }}
        />
      </label>
      <div class="button-row">
        <button
          type="button"
          disabled={!matches().length}
          onClick={() => {
            find(-1);
          }}
        >
          Previous match
        </button>
        <button
          type="button"
          disabled={!matches().length}
          onClick={() => {
            find(1);
          }}
        >
          Next match
        </button>
        <span role="status">{matches().length} matches</span>
      </div>
      <label class="field">
        Markdown scratchpad
        <textarea
          aria-label="Markdown scratchpad"
          rows={22}
          value={markdown()}
          disabled={!props.controller.project() || saving()}
          ref={(element) => {
            editor = element;
          }}
          onInput={(event) => {
            const expected = draft()?.expected ?? props.controller.observe();
            setDraft({ markdown: event.currentTarget.value, expected });
            props.onDraftChange(true);
          }}
          onKeyDown={(event) => {
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key.toLowerCase() === 's'
            ) {
              event.preventDefault();
              event.stopPropagation();
              void save();
            }
          }}
        />
      </label>
      <div class="button-row">
        <button
          type="button"
          disabled={!draft() || saving()}
          onClick={() => void save()}
        >
          {saving() ? 'Saving…' : 'Save notes'}
        </button>
        <button
          type="button"
          disabled={!draft() || saving()}
          onClick={() => {
            clearDraft();
          }}
        >
          Cancel notes
        </button>
      </div>
    </section>
  );
}
