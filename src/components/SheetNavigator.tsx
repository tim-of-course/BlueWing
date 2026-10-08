import {
  createEffect,
  createMemo,
  createProjection,
  createSignal,
  For,
  onCleanup,
  onSettled,
  Show,
  untrack,
} from 'solid-js';
import { Portal } from '@solidjs/web';
import type { WorkspaceController } from '../app/contracts';
import type { Observation } from '../app/application';
import type { Group, Sheet } from '../core/types';
import { convertQuantity, measureGeometry } from '../core/geometry';
import ToolIcon from './ToolIcon';
import { SheetThumbnails } from './sheet-thumbnails';
import './sheet-navigator.css';

interface Props {
  controller: WorkspaceController;
  disabled: boolean;
  onError: (message: string) => void;
  onDraftChange: (dirty: boolean) => void;
  onInspect: () => void;
  onAutoName: () => void;
}
interface Preview {
  sheet: Sheet;
  session: { id: string | undefined };
  x: number;
  y: number;
}

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const groupMetrics = [
  { kind: 'path', key: 'length', unit: 'ft', label: 'ft' },
  { kind: 'area', key: 'area', unit: 'ft2', label: 'ft²' },
  { kind: 'count', key: 'count', unit: 'ea', label: 'ea' },
] as const;

function VisibilityIcon(props: { visible: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M2 10s3-5.5 8-5.5 8 5.5 8 5.5-3 5.5-8 5.5S2 10 2 10Z" />
      <circle cx="10" cy="10" r="2.3" />
      <Show when={!props.visible}>
        <path d="m3 3 14 14" />
      </Show>
    </svg>
  );
}

function SheetPreview(props: {
  preview: Preview;
  thumbnail: { source: string; error: string } | undefined;
}) {
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
          when={props.thumbnail?.source}
          fallback={
            <span role="status">
              {props.thumbnail?.error || 'Loading preview…'}
            </span>
          }
        >
          <img
            src={props.thumbnail?.source}
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
  const projectSession = createMemo(
    () => ({ id: props.controller.project()?.id }),
    {
      name: 'navigator.projectSession',
      equals: (previous, next) => previous.id === next.id,
    },
  );
  const [filter, setFilter] = createSignal('');
  const [collapsed, setCollapsed] = createSignal<string[]>([], {
    name: 'navigator.collapsedSheets',
  });
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
  let list: HTMLFieldSetElement | undefined;
  const [visibleRows, setVisibleRows] = createSignal(new Set<string>(), {
    name: 'navigator.visibleRows',
    equals: (previous, next) =>
      previous.size === next.size && [...previous].every((id) => next.has(id)),
  });
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
  const [thumbnailVersion, setThumbnailVersion] = createSignal(0);
  const controller = untrack(() => props.controller);
  const thumbnails = new SheetThumbnails(
    (sheet, signal) => controller.previewSheet(sheet, signal),
    () => setThumbnailVersion((version) => version + 1),
  );
  const currentPreview = createMemo(() => {
    const value = preview();
    if (value?.session !== projectSession()) return null;
    const sheet = props.controller.project()?.sheets[value.sheet.id];
    return sheet ? { ...value, sheet } : null;
  });
  const previewThumbnail = () => {
    thumbnailVersion();
    const value = currentPreview();
    const entry = value ? thumbnails.get(value.sheet) : undefined;
    return entry ? { source: entry.source, error: entry.error } : undefined;
  };
  createEffect(
    () => ({
      projectId: props.controller.project()?.id,
      sheets: sheets().filter((sheet) => visibleRows().has(sheet.id)),
      preview: currentPreview()?.sheet,
    }),
    ({ projectId, sheets, preview }) => {
      thumbnails.sync(projectId, sheets, preview);
    },
    { name: 'navigator.thumbnailCache' },
  );
  onCleanup(() => {
    thumbnails.clear();
  });
  const groups = () => Object.values(props.controller.project()?.groups ?? {});
  const members = (group: Group, sheetId: string) =>
    group.geometryIds.filter(
      (id) => props.controller.project()?.geometries[id]?.sheetId === sheetId,
    );
  const groupsBySheet = createProjection<Record<string, Group[]>>(
    () => {
      const project = props.controller.project();
      const result: Record<string, Group[]> = {};
      for (const group of Object.values(project?.groups ?? {})) {
        const sheetIds = new Set(
          group.geometryIds.flatMap(
            (id) => project?.geometries[id]?.sheetId ?? [],
          ),
        );
        for (const id of sheetIds) (result[id] ??= []).push(group);
      }
      return result;
    },
    {},
    { name: 'navigator.groupsBySheet' },
  );
  const sheetGroups = (sheetId: string) => groupsBySheet[sheetId] ?? [];
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
  const rowState = createProjection<
    Record<
      string,
      { active: boolean; expanded: boolean; drop: boolean; visible: boolean }
    >
  >(
    (draft) => {
      const active = props.controller.activeSheetId();
      const drop = dropTarget();
      const filtering = !!term();
      const hiddenGroups = new Set(collapsed());
      const ids = new Set<string>();
      for (const sheet of sheets()) {
        ids.add(sheet.id);
        const state = (draft[sheet.id] ??= {
          active: false,
          expanded: true,
          drop: false,
          visible: true,
        });
        state.active = sheet.id === active;
        state.expanded = filtering || !hiddenGroups.has(sheet.id);
        state.drop = sheet.id === drop;
        state.visible = props.controller.isSheetVisible(sheet.id);
      }
      for (const id of Object.keys(draft))
        if (!ids.has(id)) Reflect.deleteProperty(draft, id);
    },
    {},
    { name: 'navigator.sheetRowState' },
  );
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
  onSettled(() => {
    if (!list) return;
    const root = list;
    const panel = root.closest('.workspace-panel-surface');
    const observed = new Map<Element, string>();
    const visible = new Set<Element>();
    const publish = () => {
      setVisibleRows(
        new Set([...visible].flatMap((element) => observed.get(element) ?? [])),
      );
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!observed.has(entry.target)) continue;
          if (entry.isIntersecting && entry.intersectionRatio > 0)
            visible.add(entry.target);
          else visible.delete(entry.target);
        }
        publish();
      },
      { root },
    );
    const syncRows = () => {
      const shown = panel?.getAttribute('aria-hidden') !== 'true';
      const rows = new Set(shown ? root.querySelectorAll('.sheet-row') : []);
      const previousIds = new Set(
        [...visible].map((element) => observed.get(element)),
      );
      for (const element of observed.keys()) {
        if (rows.has(element)) continue;
        observer.unobserve(element);
        observed.delete(element);
        visible.delete(element);
      }
      for (const element of rows) {
        if (observed.has(element)) continue;
        const id =
          element.closest<HTMLElement>('.sheet-branch')?.dataset['sheetId'];
        if (!id) continue;
        observed.set(element, id);
        // Renaming can replace a row before the observer reports its position.
        if (previousIds.has(id)) visible.add(element);
        observer.observe(element);
      }
      if (!shown) hidePreview();
      publish();
    };
    const mutations = new MutationObserver(syncRows);
    mutations.observe(root, { childList: true, subtree: true });
    if (panel)
      mutations.observe(panel, {
        attributes: true,
        attributeFilter: ['aria-hidden'],
      });
    syncRows();
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  });
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
  createEffect(projectSession, () => {
    clearTimeout(enterTimer);
    clearTimeout(exitTimer);
    setCollapsed((ids) => (ids.length ? [] : ids));
    setFilter('');
    setMenu(null);
  });
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
    const initialPreview = {
      sheet,
      session: projectSession(),
      x: rect.right,
      y: rect.top + 16,
    };
    const open = () => {
      setPreview(initialPreview);
    };
    if (immediate || preview()) open();
    else enterTimer = setTimeout(open, 120);
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
    props.controller.setSelection(
      sheetId
        ? members(group, sheetId).filter((id) =>
            props.controller.visibleGeometryIds().has(id),
          )
        : [],
    );
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
  const GroupRow = (row: { group: Group; sheetId?: string }) => {
    const totals = createMemo(
      () => {
        const project = props.controller.project();
        if (!project) return [];
        const measured = row.group.geometryIds.flatMap((id) => {
          const geometry = project.geometries[id];
          return geometry && geometry.sheetId === row.sheetId
            ? [
                {
                  kind: geometry.kind,
                  value: measureGeometry(project, geometry),
                },
              ]
            : [];
        });
        return groupMetrics.flatMap((metric) => {
          const values = measured.filter((item) => item.kind === metric.kind);
          if (!values.length) return [];
          const unavailable = values.some((item) => !item.value[metric.key]);
          const total = values.reduce((sum, item) => {
            const quantity = item.value[metric.key];
            return (
              sum +
              (quantity ? convertQuantity(quantity, metric.unit).value : 0)
            );
          }, 0);
          return [
            {
              text: `${unavailable ? '—' : number.format(total)} ${metric.label}`,
              title: unavailable
                ? `${metric.key} unavailable: ${[...new Set(values.flatMap((item) => (item.value.diagnostic ? [item.value.diagnostic] : [])))].join('; ')}`
                : `${metric.key}: ${number.format(total)} ${metric.label}`,
            },
          ];
        });
      },
      { name: 'navigator.groupTotals' },
    );
    const kinds = createMemo(() => groupKinds(row.group, row.sheetId));
    const visible = () =>
      !row.sheetId ||
      props.controller.isGroupVisible(row.group.id, row.sheetId);
    return (
      <div class={['group-line', !visible() ? 'geometry-hidden' : '']}>
        <button
          type="button"
          class={[
            'group-row',
            props.controller.activeGroupId() === row.group.id &&
            (!row.sheetId || props.controller.activeSheetId() === row.sheetId)
              ? 'active'
              : '',
          ]}
          onClick={() => {
            selectGroup(row.group, row.sheetId);
          }}
          aria-label={`${row.group.name}, ${String(row.sheetId ? members(row.group, row.sheetId).length : row.group.geometryIds.length)} drawing objects`}
          title={`${row.group.name} · ${kinds().join(', ') || 'Empty group'} · ${String(Object.values(props.controller.project()?.assignments ?? {}).filter((entry) => entry.groupId === row.group.id).length)} recipes`}
        >
          <span class="group-kind">
            <Show
              when={kinds().length === 1}
              fallback={
                <span aria-hidden="true">{kinds().length ? '◈' : '○'}</span>
              }
            >
              <ToolIcon tool={kinds()[0] ?? 'select'} />
            </Show>
          </span>
          <span class="row-name">{row.group.name}</span>
          <span class="group-totals">
            <For each={totals()} fallback={<small>Empty</small>}>
              {(total) => <small title={total.title}>{total.text}</small>}
            </For>
          </span>
          <span
            class="group-color"
            style={{ 'background-color': row.group.color ?? '#3b82f6' }}
            aria-hidden="true"
          />
        </button>
        <Show when={row.sheetId} fallback={<span class="visibility-spacer" />}>
          {(id) => (
            <button
              type="button"
              class="navigator-visibility"
              aria-label={`${visible() ? 'Hide' : 'Show'} ${row.group.name} on ${props.controller.project()?.sheets[id()]?.name ?? 'sheet'}`}
              title={`${visible() ? 'Hide' : 'Show'} group drawing objects`}
              onClick={() => {
                props.controller.setGroupVisible(
                  row.group.id,
                  id(),
                  !visible(),
                );
              }}
            >
              <VisibilityIcon visible={visible()} />
            </button>
          )}
        </Show>
      </div>
    );
  };
  return (
    <>
      <div class="panel-heading navigator-heading">
        <h2>
          Sheets <span class="muted">{sheets().length}</span>
        </h2>
        <button
          type="button"
          aria-label="Auto-name sheets"
          title="Auto-name sheets from local PDF text"
          disabled={
            props.disabled || props.controller.busy() || !sheets().length
          }
          onClick={() => {
            hidePreview();
            props.onAutoName();
          }}
        >
          Aa
        </button>
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
          placeholder="Find sheet or group"
          value={filter()}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
        <Show when={filter()}>
          <button
            type="button"
            class="navigator-clear"
            aria-label="Clear sheet and group filter"
            title="Clear filter"
            onClick={() => setFilter('')}
          >
            ×
          </button>
        </Show>
      </div>
      <fieldset
        class="sheet-list"
        disabled={props.disabled}
        ref={(element) => {
          list = element;
        }}
        onScroll={hidePreview}
      >
        <For
          each={visibleSheets()}
          keyed={(sheet) => sheet.id}
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
                rowState[sheet().id]?.drop ? 'drop-target' : '',
              ]}
              aria-label={sheet().name}
              data-sheet-id={sheet().id}
              onMouseEnter={(event) => {
                showPreview(sheet(), event.currentTarget);
              }}
              onMouseLeave={leavePreview}
              onFocusIn={(event) => {
                if (
                  event.target instanceof HTMLElement &&
                  event.target.matches(':focus-visible')
                )
                  showPreview(sheet(), event.currentTarget, true);
              }}
              onFocusOut={(event) => {
                if (
                  !(event.relatedTarget instanceof Node) ||
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  leavePreview();
              }}
            >
              <div
                class={[
                  'sheet-line',
                  !rowState[sheet().id]?.visible ? 'geometry-hidden' : '',
                ]}
              >
                <button
                  type="button"
                  class="sheet-expand"
                  aria-label={`${rowState[sheet().id]?.expanded ? 'Collapse' : 'Expand'} groups for ${sheet().name}`}
                  aria-expanded={
                    rowState[sheet().id]?.expanded ? 'true' : 'false'
                  }
                  disabled={!sheetGroups(sheet().id).length}
                  onClick={() =>
                    setCollapsed((ids) =>
                      ids.includes(sheet().id)
                        ? ids.filter((id) => id !== sheet().id)
                        : [...ids, sheet().id],
                    )
                  }
                >
                  {rowState[sheet().id]?.expanded ? '▾' : '▸'}
                </button>
                <button
                  type="button"
                  class={[
                    'sheet-row',
                    rowState[sheet().id]?.active ? 'active' : '',
                    !sheet().calibration ? 'uncalibrated' : '',
                  ]}
                  aria-label={`${sheet().name}${sheet().calibration ? '' : ', uncalibrated'}`}
                  title={sheet().name}
                  aria-current={
                    rowState[sheet().id]?.active ? 'page' : undefined
                  }
                  draggable="true"
                  onClick={() => {
                    hidePreview();
                    props.controller.setActiveSheetId(sheet().id);
                    props.controller.setActiveGroupId(null);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openMenu(sheet(), event.clientX, event.clientY);
                  }}
                  onDragStart={(event) => {
                    if (props.disabled) {
                      event.preventDefault();
                      return;
                    }
                    hidePreview();
                    draggedId = sheet().id;
                    if (event.dataTransfer) {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', sheet().id);
                    }
                  }}
                  onDragOver={(event) => {
                    if (draggedId && !props.disabled) {
                      event.preventDefault();
                      setDropTarget(sheet().id);
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedId && !props.disabled)
                      reorder(draggedId, sheet().id);
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
                      openMenu(sheet(), rect.left + 20, rect.bottom);
                    }
                    if (
                      event.altKey &&
                      ['ArrowUp', 'ArrowDown'].includes(event.key)
                    ) {
                      event.preventDefault();
                      const index = sheets().findIndex(
                        (item) => item.id === sheet().id,
                      );
                      const target =
                        sheets()[index + (event.key === 'ArrowUp' ? -1 : 1)];
                      if (target) reorder(sheet().id, target.id);
                    }
                  }}
                >
                  <span class="row-name">{sheet().name}</span>
                </button>
                <button
                  type="button"
                  class="navigator-visibility"
                  aria-label={`${rowState[sheet().id]?.visible ? 'Hide' : 'Show'} drawing objects on ${sheet().name}`}
                  title={`${rowState[sheet().id]?.visible ? 'Hide' : 'Show'} sheet drawing objects`}
                  onClick={() => {
                    props.controller.setSheetVisible(
                      sheet().id,
                      !props.controller.isSheetVisible(sheet().id),
                    );
                  }}
                >
                  <VisibilityIcon
                    visible={rowState[sheet().id]?.visible ?? true}
                  />
                </button>
              </div>
              <Show
                when={
                  sheetGroups(sheet().id).length > 0 &&
                  rowState[sheet().id]?.expanded
                }
              >
                <div class="sheet-groups">
                  <For
                    keyed={(group) => group.id}
                    each={sheetGroups(sheet().id).filter(
                      (group) =>
                        !term() ||
                        sheet().name.toLowerCase().includes(term()) ||
                        group.name.toLowerCase().includes(term()),
                    )}
                  >
                    {(group) => (
                      <GroupRow group={group()} sheetId={sheet().id} />
                    )}
                  </For>
                </div>
              </Show>
            </section>
          )}
        </For>
        <Show when={groups().some((group) => !group.geometryIds.length)}>
          <h3 class="unplaced-heading">Empty groups</h3>
          <For
            keyed={(group) => group.id}
            each={groups().filter(
              (group) =>
                !group.geometryIds.length &&
                (!term() || group.name.toLowerCase().includes(term())),
            )}
          >
            {(group) => <GroupRow group={group()} />}
          </For>
        </Show>
      </fieldset>
      <Show when={currentPreview()}>
        {(value) => (
          <Portal>
            <SheetPreview preview={value()} thumbnail={previewThumbnail()} />
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
