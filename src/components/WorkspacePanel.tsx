import { createEffect, createSignal, onSettled, untrack } from 'solid-js';
import {
  panelSizes,
  panelStripWidth,
  type PanelName,
} from '../app/panel-layout';
import type { JSX } from '@solidjs/web';
import './workspace-panel.css';

export interface WorkspacePanelProps {
  name: PanelName;
  label: string;
  side: 'left' | 'right';
  preferences: PanelPreferences;
  temporarilyCollapsed: boolean;
  onPinnedChange: (value: boolean) => void;
  children: JSX.Element;
  peekRequest?: number;
  bottomControl?: boolean;
  bottomControlHost?: () => HTMLElement | undefined;
  unread?: number;
  peekState?: ReturnType<typeof createSignal<boolean>>;
}

export function createPanelPreferences(name: PanelName) {
  const spec = panelSizes[name];
  const widthKey = `bluewing.panel.${spec.id}.width`;
  const pinKey = `bluewing.panel.${name}.pinned`;
  const clamp = (value: number) =>
    Math.min(spec.max, Math.max(spec.min, value));
  const saved = localStorage.getItem(widthKey);
  const [width, setWidth] = createSignal(
    saved !== null && Number.isFinite(Number(saved))
      ? clamp(Number(saved))
      : spec.width,
  );
  const [pinned, setPinned] = createSignal(
    localStorage.getItem(pinKey) !== 'false',
  );
  return {
    width,
    setWidth,
    clamp,
    pinned,
    savePin(value: boolean) {
      if (value === pinned()) return;
      setPinned(value);
      localStorage.setItem(pinKey, String(value));
    },
    saveWidth: (value: number) => {
      try {
        localStorage.setItem(widthKey, String(value));
      } catch {
        // Resizing still works without saving a device preference.
      }
    },
  };
}
export type PanelPreferences = ReturnType<typeof createPanelPreferences>;

export default function WorkspacePanel(props: WorkspacePanelProps) {
  const spec = untrack(() => panelSizes[props.name]);
  const { width, setWidth, clamp, saveWidth } = untrack(
    () => props.preferences,
  );
  const pinned = () =>
    props.preferences.pinned() && !props.temporarilyCollapsed;
  const [localPeek, setLocalPeek] = createSignal(false);
  const [peeking, setPeeking] = untrack(() => props.peekState) ?? [
    localPeek,
    setLocalPeek,
  ];
  const [resizing, setResizing] = createSignal(false);
  const visible = () => pinned() || peeking();
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
    if (!pinned() && !peeking()) {
      enterTimer = setTimeout(() => {
        enterTimer = undefined;
        if (!pinned() && engaged()) setPeeking(true);
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
  const resizeByKeyboard = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    if (pinned()) props.onPinnedChange(true);
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
    if (pinned()) props.onPinnedChange(true);
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
    () => ({
      pinned: pinned(),
      request: props.peekRequest,
      collapsed: props.temporarilyCollapsed,
    }),
    ({ pinned, request, collapsed }) => {
      const requested = request !== lastRequest;
      lastRequest = request;
      if (pinned) {
        clearTimers();
        setPeeking(false);
      } else if (requested || (collapsed && stopResize)) {
        clearTimers();
        setPeeking(true);
      }
    },
    { name: 'workspace.panelPeekRequest' },
  );

  // Keep one keyboard control when moving between the composer and the strip.
  const composerHost = untrack(() => props.bottomControlHost);
  if (composerHost) {
    createEffect(
      visible,
      (show) => {
        // Moving a focused control dispatches focus events that read the current panel state.
        queueMicrotask(() => {
          const host = show ? composerHost() : undefined;
          const target = host ?? root;
          if (!root.isConnected || control.parentElement === target) return;
          const focused = document.activeElement === control;
          if (host) host.prepend(control);
          else root.append(control);
          if (focused) {
            control.focus();
            clearTimers();
          }
        });
      },
      { name: 'workspace.panelControlPosition' },
    );
  }

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
      if (
        event.key !== 'Escape' ||
        pinned() ||
        !peeking() ||
        (event.target instanceof Element &&
          event.target.closest('[role="menu"]'))
      )
        return;
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
      data-bottom-control={props.bottomControl || undefined}
      data-collapsed-strip={props.temporarilyCollapsed || undefined}
      data-peeking={!pinned() && peeking() ? 'true' : 'false'}
      data-resizing={resizing() ? 'true' : 'false'}
      style={{
        width: pinned()
          ? `${String(width())}px`
          : props.bottomControl || props.temporarilyCollapsed
            ? `${String(panelStripWidth)}px`
            : '0px',
      }}
    >
      <aside
        id={spec.id}
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
          aria-controls={spec.id}
          aria-orientation="vertical"
          aria-valuemin={spec.min}
          aria-valuemax={spec.max}
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
        aria-label={`${pinned() ? 'Collapse' : 'Pin'} ${props.label}${props.unread ? ` (${String(props.unread)} unread)` : ''}`}
        aria-controls={spec.id}
        aria-expanded={visible() ? 'true' : 'false'}
        title={
          pinned()
            ? `Collapse ${props.label}`
            : `Pin ${props.label} (hover to peek)`
        }
        onClick={() => {
          clearTimers();
          setPeeking(false);
          control.focus();
          const opening = !pinned();
          props.onPinnedChange(opening);
          if (opening) setPeeking(true);
        }}
      >
        {props.bottomControl && !visible() ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            aria-hidden="true"
          >
            <path d="M16 13H8l-4 3v-3H3V4h13z" />
            <path d="M6 7h7M6 10h4" />
          </svg>
        ) : (
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
                (props.side === 'left') === pinned()
                  ? 'm10 6-2 2 2 2'
                  : 'm6 6 2 2-2 2'
              }
            />
          </svg>
        )}
        {props.unread ? <span class="panel-unread" aria-hidden="true" /> : null}
      </button>
    </div>
  );
}
