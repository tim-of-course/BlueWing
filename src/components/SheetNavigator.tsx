import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { Portal } from '@solidjs/web';
import type { WorkspaceController } from '../app/contracts';
import type { Observation } from '../app/application';
import type { Group, Sheet } from '../core/types';
import ToolIcon from './ToolIcon';
import './sheet-navigator.css';

interface Props {
  controller: WorkspaceController;
  disabled: boolean;
  onError: (message: string) => void;
  onDraftChange: (dirty: boolean) => void;
  onInspect: () => void;
}
interface Preview {
  sheet: Sheet;
  x: number;
  y: number;
}

function SheetPreview(props: {
  preview: Preview;
  controller: WorkspaceController;
}) {
  const [source, setSource] = createSignal('');
  const [error, setError] = createSignal('');
  createEffect(
    () => ({ sheet: props.preview.sheet, controller: props.controller }),
    ({ sheet, controller }) => {
      let current = true;
      setSource('');
      setError('');
      void controller
        .renderSheet(sheet, 640)
        .then((canvas) => {
          if (current) setSource(canvas.toDataURL());
        })
        .catch(() => {
          if (current) setError('Preview unavailable');
        });
      return () => {
        current = false;
      };
    },
    { name: 'navigator.sourcePreview' },
  );
  return (
    <div
      class="sheet-preview"
      role="tooltip"
      aria-label="Sheet preview"
      data-sheet-id={props.preview.sheet.id}
      style={{
        left: `${String(Math.min(props.preview.x + 12, window.innerWidth - 300))}px`,
        top: `${String(Math.max(56, Math.min(props.preview.y - 100, window.innerHeight - 285)))}px`,
      }}
    >
      <div class="sheet-preview-image">
        <Show
          when={source()}
          fallback={<span role="status">{error() || 'Loading preview…'}</span>}
        >
          <img
            src={source()}
            alt={`Plan preview: ${props.preview.sheet.name}`}
          />
        </Show>
      </div>
      <strong>{props.preview.sheet.name}</strong>
      <small>
        {props.preview.sheet.calibration ? 'Calibrated' : 'Uncalibrated'} · Page{' '}
        {props.preview.sheet.pageIndex + 1}
      </small>
    </div>
  );
}

export default function SheetNavigator(props: Props) {
  const [filter, setFilter] = createSignal('');
  const [collapsed, setCollapsed] = createSignal<string[]>([]);
  const [preview, setPreview] = createSignal<Preview | null>(null, {
    name: 'navigator.preview',
  });
  const [menu, setMenu] = createSignal<{
    sheet: Sheet;
    x: number;
    y: number;
  } | null>(null);
  const [dialog, setDialog] = createSignal<{
    sheet: Sheet;
    action: 'rename' | 'delete' | 'properties';
    expected: Observation;
  } | null>(null);
  const [name, setName] = createSignal('');
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);
  let draggedId: string | null = null;
  let enterTimer: ReturnType<typeof setTimeout> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  const sheets = createMemo(
    () =>
      Object.values(props.controller.project()?.sheets ?? {}).sort(
        (a, b) => (a.order ?? a.pageIndex) - (b.order ?? b.pageIndex),
      ),
    { name: 'navigator.orderedSheets' },
  );
  const groups = () => Object.values(props.controller.project()?.groups ?? {});
  const members = (group: Group, sheetId: string) =>
    group.geometryIds.filter(
      (id) => props.controller.project()?.geometries[id]?.sheetId === sheetId,
    );
  const sheetGroups = (sheetId: string) =>
    groups().filter((group) => members(group, sheetId).length > 0);
  const term = () => filter().trim().toLowerCase();
  const visibleSheets = () =>
    sheets().filter(
      (sheet) =>
        !term() ||
        sheet.name.toLowerCase().includes(term()) ||
        sheetGroups(sheet.id).some((group) =>
          group.name.toLowerCase().includes(term()),
        ),
    );
  const expanded = (sheetId: string) =>
    !!term() || !collapsed().includes(sheetId);
  const run = (action: () => Promise<unknown>) => {
    const report = props.onError;
    void action().catch((error: unknown) => {
      report(error instanceof Error ? error.message : String(error));
    });
  };
  const hidePreview = () => {
    clearTimeout(enterTimer);
    clearTimeout(exitTimer);
    setPreview(null);
  };
  onCleanup(() => {
    clearTimeout(enterTimer);
    clearTimeout(exitTimer);
  });
  createEffect(
    () => ({ open: dialog() !== null, notify: props.onDraftChange }),
    ({ open, notify }) => {
      notify(open);
    },
  );
  createEffect(
    () => props.controller.project()?.id,
    () => {
      hidePreview();
      setCollapsed([]);
      setFilter('');
      setMenu(null);
    },
  );
  createEffect(menu, (value) => {
    if (value)
      queueMicrotask(() =>
        document
          .querySelector<HTMLElement>('.sheet-menu button:not(:disabled)')
          ?.focus(),
      );
  });
  createEffect(dialog, (value) => {
    if (value)
      queueMicrotask(() =>
        document
          .querySelector<HTMLElement>(
            '[aria-label="Sheet details"] input, [aria-label="Sheet details"] button',
          )
          ?.focus(),
      );
  });
  const showPreview = (
    sheet: Sheet,
    element: HTMLElement,
    immediate = false,
  ) => {
    clearTimeout(enterTimer);
    clearTimeout(exitTimer);
    const rect = element.getBoundingClientRect();
    const next = { sheet, x: rect.right, y: rect.top + 16 };
    if (immediate || preview()) setPreview(next);
    else enterTimer = setTimeout(() => setPreview(next), 120);
  };
  const leavePreview = () => {
    clearTimeout(enterTimer);
    clearTimeout(exitTimer);
    exitTimer = setTimeout(() => setPreview(null), 160);
  };
  const openMenu = (sheet: Sheet, x: number, y: number) => {
    hidePreview();
    setMenu({
      sheet,
      x: Math.min(x, window.innerWidth - 210),
      y: Math.min(y, window.innerHeight - 195),
    });
  };
  const reorder = (id: string, target: string) => {
    const ids = sheets().map((sheet) => sheet.id);
    const from = ids.indexOf(id);
    const to = ids.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    const controller = props.controller;
    run(() => controller.reorderSheets(ids));
  };
  const selectGroup = (group: Group, sheetId?: string) => {
    if (sheetId) props.controller.setActiveSheetId(sheetId);
    props.controller.setSelection(sheetId ? members(group, sheetId) : []);
    props.controller.setActiveGroupId(group.id);
    props.onInspect();
  };
  const groupKinds = (group: Group, sheetId?: string) => {
    const project = props.controller.project();
    const kinds = new Set(
      group.geometryIds.flatMap((id) => {
        const item = project?.geometries[id];
        return item && (!sheetId || item.sheetId === sheetId)
          ? [item.kind]
          : [];
      }),
    );
    if (!kinds.size)
      for (const assignment of Object.values(project?.assignments ?? {})) {
        if (assignment.groupId === group.id)
          for (const kind of project?.recipes[assignment.recipeId]
            ?.geometryKinds ?? [])
            kinds.add(kind);
      }
    return [...kinds];
  };
  const groupRow = (group: Group, sheetId?: string) => (
    <button
      type="button"
      class={[
        'group-row',
        props.controller.activeGroupId() === group.id &&
        (!sheetId || props.controller.activeSheetId() === sheetId)
          ? 'active'
          : '',
      ]}
      disabled={props.disabled}
      onClick={() => {
        selectGroup(group, sheetId);
      }}
      aria-label={`${group.name}, ${String(sheetId ? members(group, sheetId).length : group.geometryIds.length)} drawing objects`}
      title={`${groupKinds(group, sheetId).join(', ') || 'Empty group'} · ${String(Object.values(props.controller.project()?.assignments ?? {}).filter((entry) => entry.groupId === group.id).length)} recipes`}
    >
      <span class="group-kind" style={{ color: group.color ?? '#3b82f6' }}>
        <Show
          when={groupKinds(group, sheetId).length === 1}
          fallback={
            <span aria-hidden="true">
              {groupKinds(group, sheetId).length ? '◈' : '○'}
            </span>
          }
        >
          <ToolIcon tool={groupKinds(group, sheetId)[0] ?? 'select'} />
        </Show>
      </span>
      <span class="row-name">{group.name}</span>
      <small>
        {sheetId ? members(group, sheetId).length : group.geometryIds.length}
      </small>
    </button>
  );
  return (
    <>
      <div class="panel-heading">
        <h2>
          Sheets <span class="muted">{sheets().length}</span>
        </h2>
        <button
          type="button"
          disabled={
            !props.controller.project() ||
            props.controller.busy() ||
            props.disabled
          }
          onClick={() => {
            run(() => props.controller.importPdf());
          }}
        >
          Import PDF
        </button>
      </div>
      <div class="navigator-filter">
        <input
          type="search"
          aria-label="Filter sheets and groups"
          placeholder="Filter sheets & groups…"
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
      </div>
      <div class="sheet-list" onScroll={hidePreview}>
        <For
          each={visibleSheets()}
          fallback={
            <p class="muted">
              {sheets().length
                ? 'No sheets or groups match.'
                : 'No sheets loaded'}
            </p>
          }
        >
          {(sheet) => (
            <section
              class={[
                'sheet-branch',
                dropTarget() === sheet.id ? 'drop-target' : '',
              ]}
              aria-label={sheet.name}
              data-sheet-id={sheet.id}
              onMouseEnter={(event) => {
                showPreview(sheet, event.currentTarget);
              }}
              onMouseLeave={leavePreview}
              onFocusIn={(event) => {
                if (
                  event.target instanceof HTMLElement &&
                  event.target.matches(':focus-visible')
                )
                  showPreview(sheet, event.currentTarget, true);
              }}
              onFocusOut={(event) => {
                if (
                  !(event.relatedTarget instanceof Node) ||
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  leavePreview();
              }}
            >
              <div class="sheet-line">
                <button
                  type="button"
                  class="sheet-expand"
                  aria-label={`${expanded(sheet.id) ? 'Collapse' : 'Expand'} groups for ${sheet.name}`}
                  aria-expanded={expanded(sheet.id) ? 'true' : 'false'}
                  disabled={!sheetGroups(sheet.id).length}
                  onClick={() =>
                    setCollapsed((ids) =>
                      ids.includes(sheet.id)
                        ? ids.filter((id) => id !== sheet.id)
                        : [...ids, sheet.id],
                    )
                  }
                >
                  {expanded(sheet.id) ? '▾' : '▸'}
                </button>
                <button
                  type="button"
                  class={[
                    'sheet-row',
                    props.controller.activeSheetId() === sheet.id
                      ? 'active'
                      : '',
                    !sheet.calibration ? 'uncalibrated' : '',
                  ]}
                  aria-label={`${sheet.name}${sheet.calibration ? '' : ', uncalibrated'}`}
                  title={sheet.name}
                  aria-current={
                    props.controller.activeSheetId() === sheet.id
                      ? 'page'
                      : undefined
                  }
                  disabled={props.disabled}
                  draggable={!props.disabled ? 'true' : 'false'}
                  onClick={() => {
                    hidePreview();
                    props.controller.setActiveSheetId(sheet.id);
                    props.controller.setActiveGroupId(null);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openMenu(sheet, event.clientX, event.clientY);
                  }}
                  onDragStart={(event) => {
                    hidePreview();
                    draggedId = sheet.id;
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', sheet.id);
                    }
                  }}
                  onDragOver={(event) => {
                    if (draggedId && !props.disabled) {
                      event.preventDefault();
                      setDropTarget(sheet.id);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedId && !props.disabled)
                      reorder(draggedId, sheet.id);
                    draggedId = null;
                    setDropTarget(null);
                  }}
                  onDragEnd={() => {
                    draggedId = null;
                    setDropTarget(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') hidePreview();
                    if (
                      event.key === 'ContextMenu' ||
                      (event.shiftKey && event.key === 'F10')
                    ) {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      openMenu(sheet, rect.left + 20, rect.bottom);
                    }
                    if (
                      event.altKey &&
                      ['ArrowUp', 'ArrowDown'].includes(event.key)
                    ) {
                      event.preventDefault();
                      const index = sheets().findIndex(
                        (item) => item.id === sheet.id,
                      );
                      const target =
                        sheets()[index + (event.key === 'ArrowUp' ? -1 : 1)];
                      if (target) reorder(sheet.id, target.id);
                    }
                  }}
                >
                  <span class="row-name">{sheet.name}</span>
                </button>
              </div>
              <Show when={expanded(sheet.id)}>
                <div class="sheet-groups">
                  <For
                    each={sheetGroups(sheet.id).filter(
                      (group) =>
                        !term() ||
                        sheet.name.toLowerCase().includes(term()) ||
                        group.name.toLowerCase().includes(term()),
                    )}
                  >
                    {(group) => groupRow(group, sheet.id)}
                  </For>
                </div>
              </Show>
            </section>
          )}
        </For>
        <Show when={groups().some((group) => !group.geometryIds.length)}>
          <h3 class="unplaced-heading">Empty groups</h3>
          <For
            each={groups().filter(
              (group) =>
                !group.geometryIds.length &&
                (!term() || group.name.toLowerCase().includes(term())),
            )}
          >
            {(group) => groupRow(group)}
          </For>
        </Show>
      </div>
      <Show when={preview()}>
        {(value) => (
          <Portal>
            <SheetPreview preview={value()} controller={props.controller} />
          </Portal>
        )}
      </Show>
      <Show when={menu()}>
        {(value) => (
          <Portal>
            <div
              class="menu-dismiss"
              onPointerDown={() => setMenu(null)}
              role="presentation"
            />
            <div
              class="sheet-menu"
              role="menu"
              tabindex={-1}
              aria-label="Sheet actions"
              style={{
                left: `${String(value().x)}px`,
                top: `${String(value().y)}px`,
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  const sheetId = value().sheet.id;
                  setMenu(null);
                  document
                    .querySelector<HTMLButtonElement>(
                      `.sheet-branch[data-sheet-id="${CSS.escape(sheetId)}"] .sheet-row`,
                    )
                    ?.focus();
                }
                if (
                  ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
                ) {
                  event.preventDefault();
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      'button:not(:disabled)',
                    ),
                  ];
                  const current = buttons.findIndex(
                    (button) => button === document.activeElement,
                  );
                  const index =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? buttons.length - 1
                        : (current +
                            (event.key === 'ArrowDown' ? 1 : -1) +
                            buttons.length) %
                          buttons.length;
                  buttons[index]?.focus();
                }
              }}
            >
              <For each={['rename', 'properties', 'delete'] as const}>
                {(action) => (
                  <button
                    type="button"
                    role="menuitem"
                    disabled={action !== 'properties' && props.disabled}
                    onClick={() => {
                      setName(value().sheet.name);
                      setDialog({
                        sheet: value().sheet,
                        action,
                        expected: props.controller.observe(),
                      });
                      setMenu(null);
                    }}
                  >
                    {action === 'rename'
                      ? 'Rename sheet…'
                      : action === 'properties'
                        ? 'Sheet properties…'
                        : 'Delete sheet…'}
                  </button>
                )}
              </For>
              <button
                type="button"
                role="menuitem"
                disabled={props.disabled}
                onClick={() => {
                  const id = value().sheet.id;
                  setMenu(null);
                  run(() => props.controller.duplicateSheet(id));
                }}
              >
                Duplicate source sheet
              </button>
            </div>
          </Portal>
        )}
      </Show>
      <Show when={dialog()}>
        {(value) => (
          <Portal>
            <div class="modal-backdrop">
              <section
                class="dialog compact"
                role="dialog"
                aria-modal="true"
                aria-label="Sheet details"
              >
                <h2>
                  {value().action === 'rename'
                    ? 'Rename sheet'
                    : value().action === 'delete'
                      ? 'Delete sheet'
                      : 'Sheet properties'}
                </h2>
                <form
                  class="stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const current = value();
                    run(async () => {
                      if (current.action === 'rename')
                        await props.controller.renameSheet(
                          current.sheet.id,
                          name().trim(),
                          current.expected,
                        );
                      if (current.action === 'delete')
                        await props.controller.deleteSheet(current.sheet.id);
                      setDialog(null);
                    });
                  }}
                >
                  <Show when={value().action === 'rename'}>
                    <label class="field">
                      Sheet name
                      <input
                        value={name()}
                        onInput={(event) => setName(event.currentTarget.value)}
                      />
                    </label>
                  </Show>
                  <Show when={value().action === 'delete'}>
                    <p>
                      Delete “{value().sheet.name}” and its drawing objects?
                      Group memberships will be removed. You can undo this edit.
                    </p>
                  </Show>
                  <Show when={value().action === 'properties'}>
                    <p>
                      {value().sheet.name}
                      <br />
                      Source page {value().sheet.pageIndex + 1}
                      <br />
                      {value().sheet.width} × {value().sheet.height} PDF points
                      <br />
                      {value().sheet.calibration
                        ? 'Calibrated'
                        : 'Uncalibrated'}
                    </p>
                  </Show>
                  <div class="button-row">
                    <Show when={value().action !== 'properties'}>
                      <button
                        type="submit"
                        class={
                          value().action === 'delete' ? 'danger' : 'primary'
                        }
                        disabled={props.controller.busy() || !name().trim()}
                      >
                        {value().action === 'delete'
                          ? 'Delete sheet'
                          : 'Save sheet'}
                      </button>
                    </Show>
                    <button type="button" onClick={() => setDialog(null)}>
                      {value().action === 'properties' ? 'Close' : 'Cancel'}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}
