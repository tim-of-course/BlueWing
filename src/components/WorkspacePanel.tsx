import { createEffect, createSignal, onSettled, untrack } from 'solid-js';
import type { JSX } from '@solidjs/web';
import './workspace-panel.css';

export interface WorkspacePanelProps {
  id: string;
  label: string;
  side: 'left' | 'right';
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  pinned: boolean;
  onPinnedChange: (value: boolean) => void;
  children: JSX.Element;
  peekRequest?: number;
}

export default function WorkspacePanel(props: WorkspacePanelProps) {
  const clamp = (value: number) =>
    Math.min(props.maxWidth, Math.max(props.minWidth, value));
  const storageKey = () => `bluewing.panel.${props.id}.width`;
  const initialWidth = untrack(() => {
    try {
      const stored = localStorage.getItem(storageKey());
      if (stored !== null && Number.isFinite(Number(stored)))
        return clamp(Number(stored));
    } catch {
      // Layout preferences are optional when browser storage is unavailable.
    }
    return clamp(props.defaultWidth);
  });
  const [width, setWidth] = createSignal(initialWidth);
  const [peeking, setPeeking] = createSignal(false);
  const [resizing, setResizing] = createSignal(false);
  const visible = () => props.pinned || peeking();
  let root!: HTMLDivElement;
  let control!: HTMLButtonElement;
  let pointerInside = false;
  let enterTimer: ReturnType<typeof setTimeout> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let stopResize: (() => void) | undefined;
  let lastRequest = untrack(() => props.peekRequest);

  const clearTimers = () => {
    clearTimeout(enterTimer);
    clearTimeout(exitTimer);
    enterTimer = undefined;
    exitTimer = undefined;
  };
  const engaged = () => pointerInside || root.contains(document.activeElement);
  const enter = () => {
    clearTimers();
    if (!props.pinned && !peeking()) {
      enterTimer = setTimeout(() => {
        enterTimer = undefined;
        if (!props.pinned && engaged()) setPeeking(true);
      }, 180);
    }
  };
  const leave = () => {
    if (engaged() || stopResize) return;
    clearTimeout(enterTimer);
    enterTimer = undefined;
    if (exitTimer === undefined) {
      exitTimer = setTimeout(() => {
        exitTimer = undefined;
        if (!engaged() && !stopResize) setPeeking(false);
      }, 250);
    }
  };
  const saveWidth = (value: number) => {
    try {
      localStorage.setItem(storageKey(), String(value));
    } catch {
      // Resizing still works without saving a device preference.
    }
  };
  const resizeByKeyboard = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction =
      (event.key === 'ArrowRight' ? 1 : -1) * (props.side === 'left' ? 1 : -1);
    const nextWidth = clamp(width() + direction * 16);
    setWidth(nextWidth);
    saveWidth(nextWidth);
  };
  const startResize = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stopResize?.();
    clearTimers();
    setResizing(true);
    const startX = event.clientX;
    const initialDragWidth = width();
    const direction = props.side === 'left' ? 1 : -1;
    let lastWidth = initialDragWidth;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return;
      lastWidth = clamp(initialDragWidth + (next.clientX - startX) * direction);
      setWidth(lastWidth);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      setResizing(false);
      saveWidth(lastWidth);
      stopResize = undefined;
      leave();
    };
    stopResize = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
  };

  createEffect(
    () => ({ pinned: props.pinned, request: props.peekRequest }),
    ({ pinned, request }) => {
      const requested = request !== lastRequest;
      lastRequest = request;
      if (pinned) {
        clearTimers();
        setPeeking(false);
      } else if (requested) {
        clearTimers();
        setPeeking(true);
      }
    },
    { name: 'workspace.panelPeekRequest' },
  );

  onSettled(() => {
    const pointerEnter = () => {
      pointerInside = true;
      enter();
    };
    const pointerLeave = () => {
      pointerInside = false;
      leave();
    };
    const focusOut = (event: FocusEvent) => {
      if (
        !(event.relatedTarget instanceof Node) ||
        !root.contains(event.relatedTarget)
      )
        queueMicrotask(leave);
    };
    const outsidePointer = (event: PointerEvent) => {
      if (
        peeking() &&
        event.target instanceof Node &&
        !root.contains(event.target)
      )
        leave();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || props.pinned || !peeking()) return;
      event.preventDefault();
      event.stopPropagation();
      clearTimers();
      stopResize?.();
      setPeeking(false);
      document
        .querySelector<HTMLElement>('[aria-label="Drawing canvas"]')
        ?.focus();
    };
    root.addEventListener('pointerenter', pointerEnter);
    root.addEventListener('pointerleave', pointerLeave);
    root.addEventListener('focusin', enter);
    root.addEventListener('focusout', focusOut);
    window.addEventListener('pointermove', outsidePointer);
    window.addEventListener('keydown', escape, true);
    return () => {
      root.removeEventListener('pointerenter', pointerEnter);
      root.removeEventListener('pointerleave', pointerLeave);
      root.removeEventListener('focusin', enter);
      root.removeEventListener('focusout', focusOut);
      window.removeEventListener('pointermove', outsidePointer);
      window.removeEventListener('keydown', escape, true);
      stopResize?.();
      clearTimers();
    };
  });

  return (
    <div
      ref={root}
      class="workspace-panel"
      data-side={props.side}
      data-peeking={!props.pinned && peeking() ? 'true' : 'false'}
      data-resizing={resizing() ? 'true' : 'false'}
      style={{ width: props.pinned ? `${String(width())}px` : '0px' }}
    >
      <aside
        id={props.id}
        class="workspace-panel-surface"
        aria-label={props.label}
        aria-hidden={visible() ? 'false' : 'true'}
        inert={!visible()}
        style={{
          width: `${String(width())}px`,
          visibility: visible() ? 'visible' : 'hidden',
        }}
      >
        <div class="workspace-panel-content">{props.children}</div>
        {/* A focusable ARIA separator is the keyboard-operated window splitter. */}
        {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <div
          class="workspace-panel-separator"
          role="separator"
          tabindex={0}
          aria-label={`Resize ${props.label}`}
          aria-controls={props.id}
          aria-orientation="vertical"
          aria-valuemin={props.minWidth}
          aria-valuemax={props.maxWidth}
          aria-valuenow={width()}
          onPointerDown={startResize}
          onKeyDown={resizeByKeyboard}
        />
        {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
      </aside>
      <button
        ref={control}
        type="button"
        class="workspace-panel-control"
        aria-label={`${props.pinned ? 'Collapse' : 'Pin'} ${props.label}`}
        aria-controls={props.id}
        aria-expanded={visible() ? 'true' : 'false'}
        title={
          props.pinned
            ? `Collapse ${props.label}`
            : `Pin ${props.label} (hover to peek)`
        }
        onClick={() => {
          clearTimers();
          setPeeking(false);
          control.focus();
          props.onPinnedChange(!props.pinned);
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          aria-hidden="true"
        >
          <rect x="1.5" y="2" width="13" height="12" rx="1.5" />
          <path d={props.side === 'left' ? 'M6 2v12' : 'M10 2v12'} />
          <path
            d={
              (props.side === 'left') === props.pinned
                ? 'm10 6-2 2 2 2'
                : 'm6 6 2 2-2 2'
            }
          />
        </svg>
      </button>
    </div>
  );
}
