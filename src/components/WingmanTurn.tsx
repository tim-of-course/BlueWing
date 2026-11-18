import { createMemo, createSignal, For, onSettled, Show } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import { activityEntity, workDuration } from '../app/wingman-activity';
import type {
  ActivityCategory,
  ActivityTarget,
  WingmanActivity,
  WingmanVisual,
} from '../app/wingman-types';
import type { RegionImages } from '../pdf/region-images';
import WingmanPreview from './WingmanPreview';

interface Props {
  entries: readonly WingmanActivity[];
  endedAt?: number;
  visible: boolean;
  controller: WorkspaceController;
  planImages: RegionImages;
  onOpenView(view: WingmanVisual): void;
  onOpenTarget(target: ActivityTarget, takeoffId?: string): void;
  navigationDisabled: boolean;
}

function Thumbnail(props: {
  entry: WingmanActivity;
  turn: Props;
  latest?: boolean;
}) {
  let row!: HTMLButtonElement;
  const [onscreen, setOnscreen] = createSignal(false);
  onSettled(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setOnscreen(!!entry?.isIntersecting),
      { root: row.closest('[role="log"]') },
    );
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  });
  const visual = () => props.entry.visual;
  const source = createMemo(() => {
    const view = visual();
    if (!view) return;
    const project = props.turn.controller.project();
    if (!project?.takeoffs[view.takeoffId]) return;
    return view.view.kind === 'plan'
      ? project.sheets[view.view.sheetId]?.name
      : 'Construction · 3D';
  });
  return (
    <button
      type="button"
      ref={row}
      class="wingman-swap"
      aria-label="Swap to agent view"
      aria-describedby={`wingman-caption-${props.entry.id}`}
      title={
        props.turn.navigationDisabled
          ? 'Finish your edit to open this view'
          : undefined
      }
      disabled={!source() || props.turn.navigationDisabled}
      onClick={() => {
        const view = visual();
        if (view) props.turn.onOpenView(view);
      }}
    >
      <div class="wingman-thumbnail">
        <Show
          when={props.turn.visible && (props.latest || onscreen()) && visual()}
        >
          {(view) => (
            <WingmanPreview
              controller={props.turn.controller}
              takeoffId={view().takeoffId}
              view={view().view}
              frame={view().frame}
              planImages={props.turn.planImages}
            />
          )}
        </Show>
      </div>
      <span id={`wingman-caption-${props.entry.id}`} class="wingman-caption">
        {visual()?.caption || source() || 'View unavailable'} ·{' '}
        {props.entry.takeoffName}
      </span>
    </button>
  );
}

const categories: ActivityCategory[] = [
  'Looked at',
  'Read',
  'Changed',
  'Rendered',
];

export default function WingmanTurn(props: Props) {
  const [expanded, setExpanded] = createSignal(false);
  const [openCategories, setOpenCategories] = createSignal<ActivityCategory[]>(
    [],
  );
  const latest = createMemo(() =>
    props.endedAt === undefined
      ? props.entries.filter((e) => e.visual).at(-1)
      : undefined,
  );
  function available(target: ActivityTarget, entry: WingmanActivity) {
    const project = entry.takeoffId
      ? props.controller.projectForTakeoff(entry.takeoffId)
      : props.controller.project();
    if (!project) return false;
    return !!activityEntity(project, target.kind, target.id);
  }
  return (
    <section class="wingman-turn" aria-label="Agent activity">
      <Show when={props.endedAt !== undefined}>
        <button
          class="wingman-disclosure"
          type="button"
          aria-expanded={expanded() ? 'true' : 'false'}
          onClick={() => setExpanded((v) => !v)}
        >
          Worked for{' '}
          {workDuration(
            props.entries[0]?.turnStartedAt ?? props.entries[0]?.startedAt ?? 0,
            props.endedAt ?? 0,
          )}
        </button>
      </Show>
      <Show when={props.endedAt === undefined || expanded()}>
        <For each={categories}>
          {(category) => {
            const entries = createMemo(
              () => props.entries.filter((e) => e.category === category),
              {
                equals: (a, b) =>
                  a.length === b.length &&
                  a.every((entry, index) => entry === b[index]),
              },
            );
            const failures = createMemo(
              () =>
                entries().filter((entry) => entry.outcome === 'failed').length,
            );
            const open = () => openCategories().includes(category);
            return (
              <Show when={entries().length > 0}>
                <button
                  class="wingman-disclosure"
                  type="button"
                  aria-expanded={open() ? 'true' : 'false'}
                  onClick={() =>
                    setOpenCategories((previous) =>
                      open()
                        ? previous.filter((c) => c !== category)
                        : [...previous, category],
                    )
                  }
                >
                  {category}{' '}
                  <span>
                    {entries().length}
                    {failures() ? ` · ${String(failures())} failed` : ''}
                  </span>
                </button>
                <Show when={open()}>
                  <ul>
                    <For each={entries()}>
                      {(entry) => (
                        <li>
                          <span>
                            {entry.outcome === 'failed' ? 'Failed · ' : ''}
                            {entry.command}
                          </span>
                          <Show when={entry.description !== entry.command}>
                            <p>{entry.description}</p>
                          </Show>
                          <Show when={entry.takeoffName}>
                            <small>{entry.takeoffName}</small>
                          </Show>
                          <For each={entry.targets}>
                            {(target) => (
                              <Show
                                when={available(target, entry)}
                                fallback={
                                  <span>{target.label} (unavailable)</span>
                                }
                              >
                                <button
                                  type="button"
                                  class="wingman-target"
                                  disabled={props.navigationDisabled}
                                  onClick={() => {
                                    props.onOpenTarget(target, entry.takeoffId);
                                  }}
                                >
                                  {target.label}
                                </button>
                              </Show>
                            )}
                          </For>
                          <Show
                            when={entry.visual && latest()?.id !== entry.id}
                          >
                            <Thumbnail entry={entry} turn={props} />
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </Show>
            );
          }}
        </For>
        <Show when={latest()}>
          {(entry) => <Thumbnail entry={entry()} turn={props} latest />}
        </Show>
      </Show>
    </section>
  );
}
