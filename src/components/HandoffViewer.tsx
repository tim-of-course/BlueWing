import { createSignal, onCleanup, onSettled } from 'solid-js';
import type { HandoffDocument } from '../app/handoff';
import './handoff-viewer.css';

export default function HandoffViewer(props: {
  document: HandoffDocument;
  onClose: () => void;
}) {
  let closeButton: HTMLButtonElement | undefined;
  let dialog: HTMLDialogElement | undefined;
  const [source, setSource] = createSignal<string>();
  let url: string | undefined;
  onSettled(() => {
    // A blob URL makes fragment links resolve inside this document, unlike srcdoc.
    url = URL.createObjectURL(
      new Blob([props.document.html], { type: 'text/html' }),
    );
    setSource(url);
    dialog?.showModal();
    closeButton?.focus();
  });
  onCleanup(() => {
    if (url) URL.revokeObjectURL(url);
  });
  return (
    <dialog
      ref={dialog}
      class="dialog handoff-viewer"
      aria-labelledby="handoff-title"
      onCancel={() => {
        props.onClose();
      }}
    >
      <div class="handoff-toolbar">
        <h2 id="handoff-title">{props.document.name}</h2>
        <span role="status">{props.document.status}</span>
        <button
          type="button"
          ref={closeButton}
          onClick={() => {
            props.onClose();
          }}
        >
          Close handoff document
        </button>
      </div>
      <iframe
        title="Handoff document"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        src={source()}
      />
    </dialog>
  );
}
