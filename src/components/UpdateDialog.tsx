import { createSignal, Show } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
export default function UpdateDialog(props: {
  controller: WorkspaceController;
  hasDraft: boolean;
  onClose: () => void;
}) {
  const [url, setUrl] = createSignal('');
  const [version, setVersion] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    void action()
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <div class="modal-backdrop">
      <section
        class="dialog compact stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-title"
      >
        <h2 id="update-title">Web application updates</h2>
        <p>
          Download a complete release, then activate it after closing your
          project and finishing edits.
        </p>
        <label class="field">
          Manifest URL
          <input
            type="url"
            placeholder="https://…/manifest.json"
            value={url()}
            onInput={(event) => setUrl(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          disabled={!url().trim() || busy()}
          onClick={() => {
            run(async () => {
              setVersion(await props.controller.installWebUpdate(url()));
            });
          }}
        >
          {busy() ? 'Working…' : 'Download update'}
        </button>
        <Show when={version()}>
          <p>Release {version()} is ready.</p>
          <button
            class="primary"
            type="button"
            disabled={!!props.controller.project() || props.hasDraft || busy()}
            onClick={() => {
              run(() => props.controller.activateWebUpdate(version()));
            }}
          >
            Activate release {version()}
          </button>
        </Show>
        <p role="alert">{error()}</p>
        <button
          type="button"
          disabled={busy()}
          onClick={() => {
            props.onClose();
          }}
        >
          Close
        </button>
      </section>
    </div>
  );
}
