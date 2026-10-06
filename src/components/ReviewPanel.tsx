import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import type { WorkspaceController } from '../app/contracts';
import type { Observation } from '../app/application';
import type { PlanSnippet, SourceReference } from '../core/review';
import { inspectReview, sourceEntity } from '../core/review';
import { resolveConstruction } from '../core/applied-assemblies';

export default function ReviewPanel(props: {
  controller: WorkspaceController;
  onClose: () => void;
  onError: (message: string) => void;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const [tab, setTab] = createSignal<'review' | 'snippets'>('review');
  const [target, setTarget] = createSignal<SourceReference | null>(null);
  const [note, setNote] = createSignal('');
  const [draft, setDraft] = createSignal<PlanSnippet | null>(null);
  const [dirty, setDirty] = createSignal(false);
  const [error, setError] = createSignal('');
  const [image, setImage] = createSignal('');
  const [picking, setPicking] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [annotation, setAnnotation] = createSignal('');
  const [filter, setFilter] = createSignal('');
  const [linkSource, setLinkSource] = createSignal('');
  let expected: Observation | undefined;
  let imageRequest = 0;
  let corner: { x: number; y: number } | undefined;
  const construction = createMemo(() => {
    const project = props.controller.project();
    return project ? resolveConstruction(project) : undefined;
  });
  const review = createMemo(() => {
    const project = props.controller.project();
    return project ? inspectReview(project) : null;
  });
  function sourceName(source: SourceReference): string {
    const project = props.controller.project();
    if (!project) return source.id;
    const item = sourceEntity(project, source, construction()) as
      { name?: string; geometryId?: string; wallId?: string } | undefined;
    const geometryId =
      item?.geometryId ??
      (item?.wallId
        ? construction()?.walls[item.wallId]?.geometryId
        : undefined);
    return (
      item?.name ??
      (geometryId ? project.geometries[geometryId]?.name : undefined) ??
      source.id
    );
  }
  const sourceChoices = createMemo(() => {
    const project = props.controller.project();
    const data = construction();
    return (
      [
        ['geometry', project?.geometries],
        ['wall', data?.walls],
        ['opening', data?.openings],
        ['header', data?.headers],
        ['assembly', project?.recipes],
        ['ceiling', data?.ceilings],
      ] as const
    ).flatMap(([kind, records]) =>
      Object.keys(records ?? {}).map((id) => ({ kind, id })),
    );
  });
  const reviewRows = createMemo(() => [
    ...(review()?.marks.map((mark) => ({
      target: mark.target,
      status: mark.effectiveStatus,
      note: mark.note,
    })) ?? []),
    ...(review()?.unreviewed.map((target) => ({
      target,
      status: 'needs-review',
      note: '',
    })) ?? []),
  ]);
  const rows = createMemo(() =>
    reviewRows().filter((row) =>
      `${row.target.kind} ${sourceName(row.target)} ${row.target.id} ${row.status} ${row.note}`
        .toLowerCase()
        .includes(filter().toLowerCase()),
    ),
  );
  createEffect(
    () => ({ dirty: dirty(), notify: props.onDraftChange }),
    (value) => {
      value.notify?.(value.dirty);
    },
  );
  function run(action: () => Promise<unknown>) {
    const report = props.onError;
    setError('');
    void action().catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      report(message);
    });
  }
  function selectSource(source: SourceReference) {
    const project = props.controller.project();
    if (!project) return;
    setTarget(source);
    setNote(
      review()?.marks.find(
        (mark) =>
          mark.target.kind === source.kind && mark.target.id === source.id,
      )?.note ?? '',
    );
    expected = props.controller.observe();
    setDirty(false);
  }
  function showSource(source: SourceReference) {
    const project = props.controller.project();
    if (!project) return;
    const entity = sourceEntity(project, source, construction()) as
      { geometryId?: string; wallId?: string } | undefined;
    const id =
      source.kind === 'geometry'
        ? source.id
        : (entity?.geometryId ??
          (entity?.wallId
            ? construction()?.walls[entity.wallId]?.geometryId
            : undefined));
    const geometry = id ? project.geometries[id] : undefined;
    if (geometry) {
      props.controller.setSheetVisible(geometry.sheetId, true);
      for (const group of Object.values(project.groups))
        if (group.geometryIds.includes(geometry.id))
          props.controller.setGroupVisible(group.id, geometry.sheetId, true);
      props.controller.setActiveSheetId(geometry.sheetId);
      props.controller.setSelection([geometry.id]);
      props.onClose();
    }
  }
  async function mark(status: 'reviewed' | 'question' | 'needs-review') {
    const source = target();
    if (!source) return;
    const existing = review()?.marks.find(
      (mark) =>
        mark.target.kind === source.kind && mark.target.id === source.id,
    );
    await props.controller.execute(
      {
        name: 'review.mark',
        payload: {
          id: existing?.id ?? crypto.randomUUID(),
          target: source,
          status,
          note: note(),
        },
      },
      expected,
    );
    expected = props.controller.observe();
    setDirty(false);
  }
  function update(patch: Partial<PlanSnippet>) {
    setDraft((current) => (current ? { ...current, ...patch } : null));
    setDirty(true);
  }
  function begin(snippet?: PlanSnippet) {
    const project = props.controller.project();
    const sheet = project?.sheets[props.controller.activeSheetId() ?? ''];
    if (!project || (!sheet && !snippet)) return;
    const ids = props.controller
      .selection()
      .filter((id) => project.geometries[id]?.sheetId === sheet?.id);
    const points = ids.flatMap((id) => project.geometries[id]?.points ?? []);
    const x = Math.max(0, Math.min(...points.map((p) => p.x)) - 24);
    const y = Math.max(0, Math.min(...points.map((p) => p.y)) - 24);
    const bounds =
      sheet && points.length
        ? {
            x,
            y,
            width: Math.min(
              sheet.width - x,
              Math.max(...points.map((p) => p.x)) + 24 - x,
            ),
            height: Math.min(
              sheet.height - y,
              Math.max(...points.map((p) => p.y)) + 24 - y,
            ),
          }
        : { x: 0, y: 0, width: sheet?.width ?? 1, height: sheet?.height ?? 1 };
    setDraft(
      structuredClone(
        snippet ?? {
          id: crypto.randomUUID(),
          name: 'Plan detail',
          sheetId: sheet?.id ?? '',
          bounds,
          geometryIds: ids,
          sources: target()
            ? [target() as SourceReference]
            : ids.map((id) => ({ kind: 'geometry' as const, id })),
          annotations: [],
          note: '',
        },
      ),
    );
    expected = props.controller.observe();
    setDirty(!snippet);
    setImage('');
    setPicking(false);
    imageRequest++;
  }
  async function preview(full = false) {
    const snippet = draft();
    const project = props.controller.project();
    if (!snippet || !project) return;
    const request = ++imageRequest;
    setLoading(true);
    try {
      if (full) {
        const sheet = project.sheets[snippet.sheetId];
        if (!sheet) throw new Error('Sheet not found');
        const canvas = await props.controller.renderSheet(sheet, 1200);
        if (request === imageRequest) {
          setImage(canvas.toDataURL('image/png'));
          setPicking(true);
        }
      } else {
        const result = await props.controller.renderSnippet(snippet);
        if (request === imageRequest) {
          setImage(result);
          setPicking(false);
        }
      }
    } finally {
      if (request === imageRequest) setLoading(false);
    }
  }
  function imagePoint(event: PointerEvent) {
    const image =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.querySelector('img')
        : null;
    const rect = image?.getBoundingClientRect();
    const snippet = draft();
    if (!rect || !snippet) return undefined;
    const sheet = props.controller.project()?.sheets[snippet.sheetId];
    const bounds = picking()
      ? { x: 0, y: 0, width: sheet?.width ?? 1, height: sheet?.height ?? 1 }
      : snippet.bounds;
    return {
      x:
        bounds.x +
        Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) *
          bounds.width,
      y:
        bounds.y +
        Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) *
          bounds.height,
    };
  }
  return (
    <div class="stack">
      <div class="panel-heading">
        <div>
          <h2>Takeoff review</h2>
          <p>Check source details, changes, and unresolved dimensions.</p>
        </div>
        <button
          type="button"
          disabled={dirty() || props.controller.busy()}
          onClick={() => {
            props.onClose();
          }}
        >
          Close
        </button>
      </div>
      <div class="button-row">
        <button
          type="button"
          disabled={dirty()}
          onClick={() => setTab('review')}
        >
          Review status
        </button>
        <button
          type="button"
          disabled={dirty()}
          onClick={() => setTab('snippets')}
        >
          Plan snippets
        </button>
      </div>
      <Show when={error()}>
        <p role="alert" class="error-banner">
          {error()}
        </p>
      </Show>
      <Show when={tab() === 'review'}>
        <div class="review-columns">
          <div>
            <label class="field">
              Filter review items
              <input
                type="search"
                value={filter()}
                onInput={(e) => setFilter(e.currentTarget.value)}
              />
            </label>
            <div class="review-list">
              <For
                each={rows().slice(0, 300)}
                keyed={(row) => `${row.target.kind}:${row.target.id}`}
              >
                {(row) => (
                  <div class="review-row">
                    <button
                      type="button"
                      disabled={dirty()}
                      onClick={() => {
                        selectSource(row().target);
                      }}
                    >
                      {row().target.kind} · {sourceName(row().target)}
                    </button>
                    <span>{row().status}</span>
                  </div>
                )}
              </For>
            </div>
            <Show when={rows().length > 300}>
              <p>Showing 300 items. Filter to narrow the list.</p>
            </Show>
          </div>
          <div class="stack">
            <Show when={target()} fallback={<p>Select an item to review.</p>}>
              {(source) => (
                <>
                  <h3>
                    {source().kind} · {sourceName(source())}
                  </h3>
                  <label class="field">
                    Review note
                    <textarea
                      value={note()}
                      onInput={(e) => {
                        setNote(e.currentTarget.value);
                        setDirty(true);
                      }}
                    />
                  </label>
                  <div class="button-row">
                    <button
                      type="button"
                      onClick={() => {
                        run(() => mark('reviewed'));
                      }}
                    >
                      Mark reviewed
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        run(() => mark('question'));
                      }}
                    >
                      Needs clarification
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        run(() => mark('needs-review'));
                      }}
                    >
                      Needs review
                    </button>
                  </div>
                  <div class="button-row">
                    <button
                      type="button"
                      disabled={dirty()}
                      onClick={() => {
                        showSource(source());
                      }}
                    >
                      Show on plan
                    </button>
                    <button
                      type="button"
                      disabled={dirty()}
                      onClick={() => {
                        setTab('snippets');
                        begin();
                      }}
                    >
                      Attach plan snippet
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        selectSource(source());
                      }}
                    >
                      Discard note edits
                    </button>
                  </div>
                </>
              )}
            </Show>
            <h3>Unresolved calculations</h3>
            <For each={props.controller.construction()?.diagnostics ?? []}>
              {(item) => (
                <p class="warning">
                  {item.wallId ?? item.geometryId ?? 'Project'}: {item.message}
                </p>
              )}
            </For>
            <Show when={!props.controller.construction()?.diagnostics.length}>
              <p>No unresolved construction dimensions.</p>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={tab() === 'snippets'}>
        <div class="review-columns">
          <div>
            <button
              type="button"
              disabled={dirty()}
              onClick={() => {
                begin();
              }}
            >
              New snippet from selection
            </button>
            <div class="review-list">
              <For each={review()?.snippets ?? []}>
                {(snippet) => (
                  <div class="review-row">
                    <button
                      type="button"
                      disabled={dirty()}
                      onClick={() => {
                        begin(snippet);
                      }}
                    >
                      {snippet.name}
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
          <Show
            when={draft()}
            fallback={
              <p>
                Select drawing objects, then create a snippet, or open a saved
                snippet.
              </p>
            }
          >
            {(snippet) => (
              <div class="stack">
                <label class="field">
                  Snippet name
                  <input
                    value={snippet().name}
                    onInput={(e) => {
                      update({ name: e.currentTarget.value });
                    }}
                  />
                </label>
                <label class="field">
                  Source sheet
                  <select
                    value={snippet().sheetId}
                    onChange={(event) => {
                      const sheet =
                        props.controller.project()?.sheets[
                          event.currentTarget.value
                        ];
                      if (!sheet) return;
                      update({
                        sheetId: sheet.id,
                        bounds: {
                          x: 0,
                          y: 0,
                          width: sheet.width,
                          height: sheet.height,
                        },
                        geometryIds: [],
                        annotations: [],
                      });
                      setImage('');
                      setPicking(false);
                    }}
                  >
                    <For
                      each={Object.values(
                        props.controller.project()?.sheets ?? {},
                      )}
                    >
                      {(sheet) => (
                        <option value={sheet.id}>{sheet.name}</option>
                      )}
                    </For>
                  </select>
                </label>
                <label class="field">
                  Detail note
                  <textarea
                    value={snippet().note}
                    onInput={(e) => {
                      update({ note: e.currentTarget.value });
                    }}
                  />
                </label>
                <div class="snippet-fields">
                  <For each={['x', 'y', 'width', 'height'] as const}>
                    {(field) => (
                      <label class="field">
                        {field} (page units)
                        <input
                          type="number"
                          step="any"
                          value={snippet().bounds[field]}
                          onInput={(e) => {
                            update({
                              bounds: {
                                ...snippet().bounds,
                                [field]: e.currentTarget.valueAsNumber,
                              },
                            });
                          }}
                        />
                      </label>
                    )}
                  </For>
                </div>
                <fieldset class="construction-section">
                  <legend>Linked takeoff items</legend>
                  <For each={snippet().sources}>
                    {(source) => (
                      <div class="button-row">
                        <span>
                          {source.kind} · {sourceName(source)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            update({
                              sources: snippet().sources.filter(
                                (item) =>
                                  item.kind !== source.kind ||
                                  item.id !== source.id,
                              ),
                            });
                          }}
                        >
                          Remove link
                        </button>
                      </div>
                    )}
                  </For>
                  <label class="field">
                    Link source
                    <select
                      value={linkSource()}
                      onChange={(event) =>
                        setLinkSource(event.currentTarget.value)
                      }
                    >
                      <option value="">Choose a takeoff item</option>
                      <For each={sourceChoices()}>
                        {(source) => (
                          <option value={JSON.stringify(source)}>
                            {source.kind} · {sourceName(source)}
                          </option>
                        )}
                      </For>
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={!linkSource()}
                    onClick={() => {
                      const source = JSON.parse(
                        linkSource(),
                      ) as SourceReference;
                      if (
                        !snippet().sources.some(
                          (item) =>
                            item.kind === source.kind && item.id === source.id,
                        )
                      )
                        update({ sources: [...snippet().sources, source] });
                      setLinkSource('');
                    }}
                  >
                    Add source link
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      update({
                        geometryIds: props.controller
                          .selection()
                          .filter(
                            (id) =>
                              props.controller.project()?.geometries[id]
                                ?.sheetId === snippet().sheetId,
                          ),
                      });
                    }}
                  >
                    Highlight selected drawing
                  </button>
                </fieldset>
                <div class="button-row">
                  <button
                    type="button"
                    disabled={loading()}
                    onClick={() => {
                      run(() => preview(true));
                    }}
                  >
                    Pick region on sheet
                  </button>
                  <button
                    type="button"
                    disabled={loading()}
                    onClick={() => {
                      run(() => preview());
                    }}
                  >
                    Preview snippet
                  </button>
                </div>
                <Show when={loading()}>
                  <p role="status">Rendering plan…</p>
                </Show>
                <Show when={image()}>
                  <p class="hint">
                    {picking()
                      ? 'Drag across the plan to choose a crop. You can also enter bounds above.'
                      : 'Enter a callout below, then click its position in the preview.'}
                  </p>
                  <button
                    type="button"
                    class="snippet-picker"
                    aria-label="Plan snippet crop and callout position"
                    onPointerDown={(event) => {
                      corner = imagePoint(event);
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onPointerUp={(event) => {
                      const end = imagePoint(event);
                      const start = corner;
                      corner = undefined;
                      if (!end || !start) return;
                      if (picking()) {
                        const width = Math.abs(end.x - start.x),
                          height = Math.abs(end.y - start.y);
                        if (width > 1 && height > 1) {
                          update({
                            bounds: {
                              x: Math.min(start.x, end.x),
                              y: Math.min(start.y, end.y),
                              width,
                              height,
                            },
                            annotations: [],
                          });
                          setImage('');
                          setPicking(false);
                        }
                      } else if (annotation().trim()) {
                        update({
                          annotations: [
                            ...snippet().annotations,
                            {
                              points: [end],
                              label: annotation(),
                              color: '#ef4444',
                            },
                          ],
                        });
                        setAnnotation('');
                      }
                    }}
                  >
                    <img
                      class="snippet-image"
                      src={image()}
                      alt="Highlighted plan snippet preview"
                      draggable="false"
                    />
                  </button>
                </Show>
                <label class="field">
                  Callout text
                  <input
                    value={annotation()}
                    onInput={(e) => setAnnotation(e.currentTarget.value)}
                  />
                </label>
                <For each={snippet().annotations}>
                  {(item, index) => (
                    <div class="button-row">
                      <span>{item.label}</span>
                      <button
                        type="button"
                        onClick={() => {
                          update({
                            annotations: snippet().annotations.filter(
                              (_, i) => i !== index(),
                            ),
                          });
                        }}
                      >
                        Remove callout
                      </button>
                    </div>
                  )}
                </For>
                <div class="button-row">
                  <button
                    type="button"
                    disabled={props.controller.busy()}
                    onClick={() => {
                      run(async () => {
                        await props.controller.execute(
                          { name: 'snippet.put', payload: snippet() },
                          expected,
                        );
                        expected = props.controller.observe();
                        setDirty(false);
                      });
                    }}
                  >
                    Save snippet
                  </button>
                  <button
                    type="button"
                    disabled={
                      dirty() ||
                      !props.controller.project()?.review?.snippets[
                        snippet().id
                      ]
                    }
                    onClick={() => {
                      run(() => props.controller.exportSnippet(snippet().id));
                    }}
                  >
                    Export PNG
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(null);
                      setDirty(false);
                      setImage('');
                      imageRequest++;
                    }}
                  >
                    Cancel edits
                  </button>
                  <button
                    type="button"
                    disabled={
                      dirty() ||
                      !props.controller.project()?.review?.snippets[
                        snippet().id
                      ]
                    }
                    onClick={() => {
                      run(async () => {
                        await props.controller.execute(
                          {
                            name: 'snippet.delete',
                            payload: { id: snippet().id },
                          },
                          expected,
                        );
                        setDraft(null);
                        setImage('');
                      });
                    }}
                  >
                    Delete snippet
                  </button>
                </div>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}
