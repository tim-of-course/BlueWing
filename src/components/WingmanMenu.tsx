import { createSignal, onSettled } from 'solid-js';

export default function WingmanMenu(props: {
  waiting: boolean;
  onCopyPrompt(): void;
  onEnd(): void;
}) {
  const [open, setOpen] = createSignal(false);
  let root!: HTMLDivElement;
  let trigger!: HTMLButtonElement;
  let copy!: HTMLButtonElement;
  let end!: HTMLButtonElement;

  function show(last = false) {
    setOpen(true);
    queueMicrotask(() => {
      (last && !end.disabled ? end : copy).focus();
    });
  }
  function close() {
    setOpen(false);
    trigger.focus();
  }
  onSettled(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.contains(event.target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
    };
  });
  return (
    <div
      class="wingman-options"
      ref={root}
      onFocusOut={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !root.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        type="button"
        class="wingman-icon"
        ref={trigger}
        aria-label="Wingman options"
        title="Wingman options"
        aria-haspopup="menu"
        aria-controls="wingman-options-menu"
        aria-expanded={open() ? 'true' : 'false'}
        onClick={() => {
          if (open()) close();
          else show();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            show(event.key === 'ArrowUp');
          }
        }}
      >
        ⋯
      </button>
      <div
        id="wingman-options-menu"
        class="wingman-menu"
        role="menu"
        tabindex={-1}
        aria-label="Wingman options"
        hidden={!open()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          } else if (
            ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
          ) {
            event.preventDefault();
            const focusEnd =
              event.key === 'End' ||
              (event.key !== 'Home' && document.activeElement === copy);
            (focusEnd && !end.disabled ? end : copy).focus();
          }
        }}
      >
        <button
          ref={copy}
          tabindex={-1}
          type="button"
          role="menuitem"
          onClick={() => {
            close();
            props.onCopyPrompt();
          }}
        >
          Copy AI prompt
        </button>
        <button
          ref={end}
          tabindex={-1}
          type="button"
          role="menuitem"
          disabled={!props.waiting}
          onClick={() => {
            close();
            props.onEnd();
          }}
        >
          End conversation
        </button>
      </div>
    </div>
  );
}
