import { createSignal, onSettled, Show, untrack } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import type { Observation } from '../app/application';
import type { Sheet } from '../core/types';
import { pageNamingTask } from '../app/page-naming';
import './SheetNamesDialog.css';

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
    name: props.controller.project()?.name ?? 'Plans',
  }));
  const [progress, setProgress] = createSignal(
    untrack(() => props.controller.pageNamingStatus(initial.sheets)),
  );
  const [error, setError] = createSignal('');
  const [copyStatus, setCopyStatus] = createSignal('');
  const task = () =>
    pageNamingTask(props.controller.cliConnection(), {
      id: initial.expected.projectId,
      name: initial.name,
    });
  const activeProject = () =>
    props.controller.project()?.id === initial.expected.projectId;
  onSettled(() => {
    const focus = document.activeElement;
    let disposed = false;
    let started = false;
    dialog?.showModal();
    void props.controller
      .execute(
        {
          name: 'sheet.naming.start',
          payload: { sheetIds: initial.sheets.map((sheet) => sheet.id) },
        },
        initial.expected,
      )
      .then(() => {
        started = true;
      })
      .catch((cause: unknown) => {
        started = true;
        if (!disposed)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    const timer = setInterval(() => {
      if (!disposed) {
        const next = props.controller.pageNamingStatus(initial.sheets);
        setProgress(next);
        if (started && !next.queued && !next.reading) clearInterval(timer);
      }
    }, 250);
    return () => {
      disposed = true;
      clearInterval(timer);
      dialog?.close();
      if (focus instanceof HTMLElement) focus.focus({ preventScroll: true });
    };
  });
  async function copyTask() {
    try {
      await navigator.clipboard.writeText(task());
      setCopyStatus('Task copied. Paste it into your agent’s chat.');
    } catch {
      setCopyStatus('Select and copy the task below.');
    }
  }
  return (
    <dialog
      ref={dialog}
      class="dialog sheet-names-dialog"
      aria-labelledby="sheet-names-title"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <h2 id="sheet-names-title">AI Page Naming</h2>
      <p>
        Give your agent this task. It will identify printed sheet numbers and
        titles from compact bottom-right title-block text, inspect unclear
        crops, and apply names in one undoable batch.
      </p>
      <p role="status">
        {String(progress().ready)} of {String(progress().total)} title blocks
        prepared
        {progress().error
          ? ` · ${String(progress().error)} extraction errors`
          : ''}
        .
      </p>
      <p class="hint">
        You can hand off now; the agent can read preparation progress.
        Preparation continues after this window closes. Names stay unchanged
        until the agent applies them.
      </p>
      <label for="page-naming-task">AI page naming task</label>
      <textarea id="page-naming-task" readonly rows={7} value={task()} />
      <Show when={!props.controller.cliConnection()}>
        <p class="hint">
          Use the desktop app’s CLI connection when giving this task to an
          external agent.
        </p>
      </Show>
      <Show when={error()}>
        <p role="alert">{error()}</p>
      </Show>
      <p role="status">{copyStatus()}</p>
      <div class="button-row">
        <button
          type="button"
          class="primary"
          disabled={!activeProject()}
          onClick={() => {
            void copyTask();
          }}
        >
          Copy AI naming task
        </button>
        <button
          type="button"
          onClick={() => {
            props.onClose();
          }}
        >
          Close
        </button>
      </div>
    </dialog>
  );
}
