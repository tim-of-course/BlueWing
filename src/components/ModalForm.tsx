import { onSettled } from 'solid-js';
import type { JSX } from '@solidjs/web';

export default function ModalForm(props: {
  children: JSX.Element;
  class?: string;
  label?: string;
  labelledBy?: string;
  opener: HTMLElement | undefined;
  busy: boolean;
  onClose: () => void;
}) {
  let dialog: HTMLDialogElement | undefined;
  onSettled(() => {
    const opener = props.opener;
    dialog?.showModal();
    return () => {
      dialog?.close();
      opener?.focus({ preventScroll: true });
    };
  });

  return (
    <dialog
      ref={dialog}
      class={['dialog compact modal-form', props.class]}
      aria-label={props.label}
      aria-labelledby={props.labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        if (!props.busy) props.onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          'input:not(:disabled), button:not(:disabled)',
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        const edge = event.shiftKey ? first : last;
        if (!controls.length || document.activeElement === edge) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }}
    >
      {props.children}
    </dialog>
  );
}
