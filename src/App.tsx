import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  onSettled,
  flush,
  untrack,
} from 'solid-js';
import { createWorkspace } from './app/controller';
import type { DrawingTool } from './app/contracts';
import DrawingCanvas from './components/canvas/DrawingCanvas';
import GroupInspector from './components/GroupInspector';
import SelectionInspector from './components/SelectionInspector';
import RecipeEditor from './components/RecipeEditor';
import Quantities from './components/Quantities';
import UpdateDialog from './components/UpdateDialog';
import ToolIcon from './components/ToolIcon';
import WorkspacePanel from './components/WorkspacePanel';
import SheetNavigator from './components/SheetNavigator';
import SheetScaleDialog from './components/SheetScaleDialog';
import SheetNamesDialog from './components/SheetNamesDialog';
import type { Sheet } from './core/types';
import type { Application, Observation } from './app/application';
import ConstructionView from './components/ConstructionView';
import ConstructionEditor from './components/ConstructionEditor';
import ReviewPanel from './components/ReviewPanel';
import { formatScale } from './core/scale';
import Wingman from './components/Wingman';
import type {
  ModelView,
  PlanView,
  ViewportPort,
  WingmanVisual,
  WorkspaceViewSnapshot,
} from './app/wingman-types';

const tools: { id: DrawingTool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: '↖' },
  { id: 'path', label: 'Path', key: 'L', icon: '╱' },
  { id: 'area', label: 'Area', key: 'F', icon: '◇' },
  { id: 'count', label: 'Count', key: 'C', icon: '⊕' },
  { id: 'calibrate', label: 'Set scale', key: 'R', icon: '↔' },
];
const groupColors = [
  '#3b82f6',
  '#f97316',
  '#22c55e',
  '#a855f7',
  '#eab308',
  '#06b6d4',
  '#f43f5e',
  '#84cc16',
];
export default function App(props: { application?: Application }) {
  const controller = createWorkspace(untrack(() => props.application));
  const [sheetsVisible, setSheetsVisible] = createSignal(
    localStorage.getItem('bluewing.panel.sheets.pinned') !== 'false',
    {
      name: 'workspace.sheetsVisible',
    },
  );
  const [inspectorVisible, setInspectorVisible] = createSignal(
    localStorage.getItem('bluewing.panel.inspector.pinned') !== 'false',
  );
  const [inspectorPeek, setInspectorPeek] = createSignal(0);
  const [sheetDraft, setSheetDraft] = createSignal(false);
  const [scaleDialog, setScaleDialog] = createSignal<{
    sheet: Sheet;
    expected: Observation;
  } | null>(null);
  const [sheetNamesDialog, setSheetNamesDialog] = createSignal<{
    sheets: Sheet[];
    expected: Observation;
  } | null>(null);
  createEffect(sheetsVisible, (value) => {
    localStorage.setItem('bluewing.panel.sheets.pinned', String(value));
  });
  createEffect(inspectorVisible, (value) => {
    localStorage.setItem('bluewing.panel.inspector.pinned', String(value));
  });
  const [tool, setTool] = createSignal<DrawingTool>('select', {
    name: 'workspace.tool',
  });
  const [quantities, setQuantities] = createSignal(false);
  const [view, setView] = createSignal<'plan' | '3d' | 'split'>('plan');
  const [followingAgent, setFollowingAgent] = createSignal(false);
  let planViewport: ViewportPort<PlanView> | undefined;
  let modelViewport: ViewportPort<ModelView> | undefined;
  const [constructionOpen, setConstructionOpen] = createSignal(false);
  const [reviewOpen, setReviewOpen] = createSignal(false);
  const [detailDraft, setDetailDraft] = createSignal(false);
  const [error, setError] = createSignal('');
  const [projectName, setProjectName] = createSignal('Untitled project');
  const [groupName, setGroupName] = createSignal('');
  const [recipeOpen, setRecipeOpen] = createSignal(false);
  const [draft, setDraft] = createSignal(false);
  const [recipeDraft, setRecipeDraft] = createSignal(false);
  const [inspectorDraft, setInspectorDraft] = createSignal(false);
  const [selectionDraft, setSelectionDraft] = createSignal(false);
  const [updateOpen, setUpdateOpen] = createSignal(false);
  const [projectAction, setProjectAction] = createSignal<
    'create' | 'rename' | null
  >(null);
  const run = (action: () => Promise<unknown>) => {
    setError('');
    void action().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  };
  const hasDraft = createMemo(
    () =>
      detailDraft() ||
      draft() ||
      recipeDraft() ||
      inspectorDraft() ||
      selectionDraft() ||
      sheetDraft() ||
      scaleDialog() !== null ||
      sheetNamesDialog() !== null ||
      projectAction() !== null ||
      groupName().trim() !== '',
    { name: 'workspace.hasDraft' },
  );
  createEffect(
    hasDraft,
    (pending) => {
      controller.setDraftPending(pending);
    },
    { name: 'workspace.unfinishedEdits' },
  );
  const chooseTool = (id: DrawingTool) => {
    if (id === 'calibrate') {
      const sheet =
        controller.project()?.sheets[controller.activeSheetId() ?? ''];
      if (sheet) setScaleDialog({ sheet, expected: controller.observe() });
      setTool('select');
      setQuantities(false);
      return;
    }
    setTool(id);
    if (id === 'select') controller.setActiveGroupId(null);
    setQuantities(false);
    if (id !== 'select') setInspectorPeek((value) => value + 1);
  };
  function captureView(): WorkspaceViewSnapshot | null {
    const project = controller.project();
    if (!project) return null;
    return structuredClone({
      projectId: project.id,
      mode: view(),
      plan: planViewport?.read() ?? null,
      model: view() !== 'plan' ? (modelViewport?.read() ?? null) : null,
      context: controller.captureContext(),
      quantities: quantities(),
      tool: tool(),
    });
  }
  async function applyView(next: WorkspaceViewSnapshot | WingmanVisual) {
    const project = controller.project();
    if (!project || next.projectId !== project.id)
      throw new Error('This view belongs to another project');
    if (hasDraft() || controller.busy())
      throw new Error('Finish your current edit before swapping views');
    if ('context' in next) {
      controller.restoreContext(next.context);
      setView(next.mode);
      setQuantities(next.quantities);
      setTool(next.tool);
      setFollowingAgent(false);
    } else {
      if (next.view.kind === 'plan' && !project.sheets[next.view.sheetId])
        throw new Error('The source sheet is no longer available');
      const context = controller.captureContext();
      controller.restoreContext({
        ...context,
        sheetId:
          next.view.kind === 'plan' ? next.view.sheetId : context.sheetId,
        selection: [],
        activeGroupId: null,
        drawingGroupId: null,
        visibility: { hiddenSheets: [], hiddenGroups: {} },
      });
      setView(next.view.kind);
      setQuantities(false);
      setTool('select');
      setFollowingAgent(true);
    }
    // The viewport ports read the mounted sheet and measured pane, after Solid commits.
    flush();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        resolve();
      }),
    );
    if (controller.project()?.id !== project.id) return;
    if ('context' in next) {
      if (next.plan && project.sheets[next.plan.sheetId])
        planViewport?.apply(next.plan);
      if (next.model && next.mode !== 'plan') modelViewport?.apply(next.model);
    } else if (next.view.kind === 'plan') planViewport?.apply(next.view);
    else modelViewport?.apply(next.view);
  }
  const nextGroupColor = () => {
    const groups = Object.values(controller.project()?.groups ?? {});
    return (
      groupColors.find((color) =>
        groups.every((group) => group.color !== color),
      ) ??
      groupColors[groups.length % groupColors.length] ??
      '#3b82f6'
    );
  };
  onSettled(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"]',
        )
      )
        return;
      if (
        recipeOpen() ||
        constructionOpen() ||
        reviewOpen() ||
        updateOpen() ||
        projectAction() ||
        sheetDraft() ||
        scaleDialog() ||
        sheetNamesDialog() ||
        inspectorDraft() ||
        selectionDraft()
      )
        return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        run(() => (event.shiftKey ? controller.redo() : controller.undo()));
      } else if ((event.metaKey || event.ctrlKey) && key === 'd' && !draft()) {
        event.preventDefault();
        run(() => controller.copySelection());
      } else if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !draft()
      ) {
        const match = tools.find((item) => item.key.toLowerCase() === key);
        if (match) chooseTool(match.id);
        if (key === 'q') setQuantities((current) => !current);
        if (key === 'delete' || key === 'backspace') {
          event.preventDefault();
          run(() => controller.deleteSelection());
        }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
    };
  });
  return (
    <div class="workspace">
      <header class="workspace-header">
        <strong class="brand">
          <img src="/brand/bluewing.svg" width="28" height="28" alt="" />
          Bluewing
        </strong>
        <button
          type="button"
          disabled={controller.busy() || hasDraft() || !!controller.project()}
          onClick={() => {
            setProjectName('Untitled project');
            setProjectAction('create');
          }}
        >
          New
        </button>
        <button
          type="button"
          disabled={controller.busy() || hasDraft() || !!controller.project()}
          onClick={() => {
            run(() => controller.openProject());
          }}
        >
          Open
        </button>
        <Show when={controller.project()}>
          {(project) => (
            <>
              <button
                class="project-title"
                type="button"
                title="Rename project"
                onClick={() => {
                  setProjectName(project().name);
                  setProjectAction('rename');
                }}
              >
                {project().name}
              </button>
              <button
                type="button"
                disabled={controller.busy() || hasDraft()}
                onClick={() => {
                  run(() => controller.closeProject());
                }}
              >
                Close
              </button>
            </>
          )}
        </Show>
        <span class="spacer" />
        <button
          type="button"
          class={!quantities() ? 'active' : ''}
          disabled={draft() || selectionDraft()}
          onClick={() => setQuantities(false)}
        >
          Drawing
        </button>
        <button
          type="button"
          class={quantities() ? 'active' : ''}
          disabled={draft() || selectionDraft()}
          onClick={() => setQuantities(true)}
        >
          Quantities
        </button>
        <button
          type="button"
          disabled={!controller.project()}
          onClick={() => setRecipeOpen(true)}
        >
          Assemblies
        </button>
        <button type="button" onClick={() => setUpdateOpen(true)}>
          Updates
        </button>
      </header>
      <Show when={error() || controller.error()}>
        <div class="error-banner" role="alert">
          <span>{error() || controller.error()}</span>
          <button
            type="button"
            onClick={() => {
              setError('');
              controller.dismissError();
            }}
          >
            Dismiss
          </button>
        </div>
      </Show>
      <div class="workspace-body">
        <WorkspacePanel
          id="sheet-navigator"
          label="Sheets"
          side="left"
          defaultWidth={292}
          minWidth={220}
          maxWidth={500}
          pinned={sheetsVisible()}
          onPinnedChange={setSheetsVisible}
        >
          <SheetNavigator
            controller={controller}
            disabled={
              draft() ||
              inspectorDraft() ||
              selectionDraft() ||
              controller.busy()
            }
            onError={setError}
            onDraftChange={setSheetDraft}
            onAutoName={() => {
              setSheetNamesDialog({
                sheets: Object.values(controller.project()?.sheets ?? {}).sort(
                  (a, b) => (a.order ?? a.pageIndex) - (b.order ?? b.pageIndex),
                ),
                expected: controller.observe(),
              });
            }}
            onInspect={() => {
              setTool('select');
              setInspectorPeek((value) => value + 1);
            }}
          />
        </WorkspacePanel>
        <main class="main-workspace">
          <Show
            when={controller.project()}
            fallback={
              <div class="empty-workspace">
                <img
                  class="empty-mark"
                  src="/brand/bluewing.svg"
                  width="52"
                  height="52"
                  alt=""
                />
                <h1>No project open</h1>
                <p>Your plans and takeoff will appear here.</p>
                <div class="button-row">
                  <button
                    class="primary"
                    type="button"
                    onClick={() => setProjectAction('create')}
                  >
                    Create project
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      run(() => controller.openProject());
                    }}
                  >
                    Open project
                  </button>
                </div>
              </div>
            }
          >
            <div
              class="workspace-toolbar"
              style={{
                'padding-left': sheetsVisible() ? undefined : '42px',
                'padding-right': inspectorVisible() ? undefined : '42px',
              }}
            >
              <button
                type="button"
                disabled={
                  !controller.canUndo() ||
                  controller.busy() ||
                  selectionDraft() ||
                  inspectorDraft()
                }
                onClick={() => {
                  run(() => controller.undo());
                }}
              >
                Undo
              </button>
              <button
                type="button"
                disabled={
                  !controller.canRedo() ||
                  controller.busy() ||
                  selectionDraft() ||
                  inspectorDraft()
                }
                onClick={() => {
                  run(() => controller.redo());
                }}
              >
                Redo
              </button>
              <button
                type="button"
                disabled={
                  !controller.selection().length ||
                  controller.busy() ||
                  selectionDraft() ||
                  inspectorDraft()
                }
                onClick={() => {
                  run(() => controller.copySelection());
                }}
              >
                Duplicate
              </button>
              <button
                type="button"
                disabled={
                  !controller.selection().length ||
                  controller.busy() ||
                  selectionDraft() ||
                  inspectorDraft()
                }
                onClick={() => {
                  run(() => controller.deleteSelection());
                }}
              >
                Delete
              </button>
              <span class="spacer" />
              <button
                type="button"
                disabled={hasDraft() || controller.busy()}
                onClick={() => setConstructionOpen(true)}
              >
                Construction
              </button>
              <button
                type="button"
                disabled={hasDraft() || controller.busy()}
                onClick={() => setReviewOpen(true)}
              >
                Review
              </button>
              <label class="view-select">
                View
                <select
                  aria-label="Workspace view"
                  value={view()}
                  disabled={hasDraft()}
                  onChange={(event) => {
                    setView(
                      event.currentTarget.value as 'plan' | '3d' | 'split',
                    );
                    setQuantities(false);
                  }}
                >
                  <option value="plan">Plan</option>
                  <option value="3d">3D</option>
                  <option value="split">Split</option>
                </select>
              </label>
              <span class="muted">
                {controller.selection().length} selected
              </span>
            </div>
            <Show when={quantities()}>
              <Quantities
                controller={controller}
                onError={setError}
                onShowDrawing={() => setQuantities(false)}
                navigationDisabled={inspectorDraft()}
              />
            </Show>
            <div
              class={[
                'drawing-workspace',
                view() === 'split' && 'split-workspace',
              ]}
              hidden={quantities()}
            >
              <div class="plan-pane" hidden={view() === '3d'}>
                <DrawingCanvas
                  onViewport={(port) => {
                    planViewport = port;
                  }}
                  presentationActive={followingAgent()}
                  controller={controller}
                  tool={tool()}
                  onError={setError}
                  onDraftChange={setDraft}
                  interactionDisabled={inspectorDraft() || selectionDraft()}
                />
              </div>
              <Show
                when={
                  view() !== 'plan' &&
                  !quantities() &&
                  controller.construction()
                }
              >
                {(result) => (
                  <ConstructionView
                    onViewport={(port) => {
                      modelViewport = port;
                    }}
                    presentationActive={followingAgent()}
                    result={result()}
                    levels={Object.values(
                      controller.project()?.construction?.levels ?? {},
                    ).map((level) => ({
                      id: level.id,
                      name: level.name,
                      geometryIds: [
                        ...new Set(
                          [
                            ...Object.values(
                              controller.project()?.construction?.walls ?? {},
                            ),
                            ...Object.values(
                              controller.project()?.construction?.ceilings ??
                                {},
                            ),
                          ]
                            .filter((source) => source.levelId === level.id)
                            .map((source) => source.geometryId),
                        ),
                      ],
                    }))}
                    selectedGeometryIds={controller.selection()}
                    onSelect={(id) => {
                      const geometry = controller.project()?.geometries[id];
                      if (geometry) {
                        controller.setSheetVisible(geometry.sheetId, true);
                        for (const group of Object.values(
                          controller.project()?.groups ?? {},
                        ))
                          if (group.geometryIds.includes(id))
                            controller.setGroupVisible(
                              group.id,
                              geometry.sheetId,
                              true,
                            );
                        controller.setActiveSheetId(geometry.sheetId);
                        controller.setSelection([id]);
                      }
                    }}
                  />
                )}
              </Show>
            </div>
          </Show>
          <Wingman
            controller={controller}
            captureView={captureView}
            applyView={applyView}
            navigationDisabled={
              hasDraft() ||
              controller.busy() ||
              constructionOpen() ||
              reviewOpen() ||
              recipeOpen() ||
              updateOpen()
            }
          />
        </main>
        <WorkspacePanel
          id="group-inspector"
          label="Inspector"
          side="right"
          defaultWidth={330}
          minWidth={260}
          maxWidth={550}
          pinned={inspectorVisible()}
          onPinnedChange={setInspectorVisible}
          peekRequest={inspectorPeek()}
        >
          <div class="panel-heading">
            <h2>Inspector</h2>
          </div>
          <Show when={controller.project()}>
            <Show
              when={
                tool() === 'path' || tool() === 'area' || tool() === 'count'
              }
            >
              <section class="panel-section new-work stack">
                <h3>New {tool() === 'path' ? 'path' : tool()}</h3>
                <label class="field">
                  Group for new drawing
                  <select
                    aria-label="Group for new drawing"
                    value={controller.drawingGroupId() ?? ''}
                    disabled={draft()}
                    onChange={(event) => {
                      controller.setDrawingGroupId(
                        event.currentTarget.value || null,
                      );
                    }}
                  >
                    <option value="">No group</option>
                    <For
                      each={Object.values(controller.project()?.groups ?? {})}
                    >
                      {(group) => (
                        <option value={group.id}>{group.name}</option>
                      )}
                    </For>
                  </select>
                </label>
                <p class="hint">New drawings join this group.</p>
                <button
                  type="button"
                  disabled={draft() || inspectorDraft()}
                  onClick={() => {
                    controller.setDrawingGroupId(null);
                    controller.setActiveGroupId(null);
                  }}
                >
                  Clear context
                </button>
              </section>
            </Show>
            <section class="create-group-section">
              <h3>
                {controller.selection().length
                  ? 'Group selected drawing'
                  : 'Create group'}
              </h3>
              <Show when={controller.project()}>
                <form
                  class="new-group"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(async () => {
                      const id = await controller.createGroup(
                        groupName().trim(),
                        nextGroupColor(),
                      );
                      setGroupName('');
                      controller.setActiveGroupId(id);
                    });
                  }}
                >
                  <input
                    aria-label="New group name"
                    placeholder="New group name"
                    value={groupName()}
                    onInput={(event) => setGroupName(event.currentTarget.value)}
                  />
                  <button
                    type="submit"
                    disabled={
                      !groupName().trim() ||
                      controller.busy() ||
                      draft() ||
                      inspectorDraft()
                    }
                  >
                    Add
                  </button>
                </form>
              </Show>
            </section>
          </Show>
          <Show
            when={controller.activeGroupId()}
            fallback={
              <Show
                when={tool() === 'select' && controller.selection().length > 0}
              >
                <SelectionInspector
                  controller={controller}
                  onError={setError}
                  onDraftChange={setSelectionDraft}
                  navigationDisabled={draft()}
                />
              </Show>
            }
          >
            <GroupInspector
              controller={controller}
              onError={setError}
              onDraftChange={setInspectorDraft}
              navigationDisabled={draft()}
            />
          </Show>
        </WorkspacePanel>
        <nav class="tool-rail" aria-label="Drawing tools">
          <For each={tools}>
            {(item) => (
              <button
                type="button"
                class={tool() === item.id ? 'active' : ''}
                aria-label={`${item.label} (${item.key})`}
                aria-pressed={tool() === item.id ? 'true' : 'false'}
                title={
                  item.id === 'select'
                    ? 'Select (V) · Hold B to paint select · Shift adds · Alt/Option subtracts'
                    : `${item.label} (${item.key})`
                }
                disabled={
                  draft() ||
                  selectionDraft() ||
                  inspectorDraft() ||
                  !controller.project()
                }
                onClick={() => {
                  chooseTool(item.id);
                }}
              >
                <ToolIcon tool={item.id} />
              </button>
            )}
          </For>
        </nav>
      </div>
      <footer>
        <span>
          {controller.project()
            ? controller.busy()
              ? 'Saving…'
              : hasDraft()
                ? 'Unfinished edits'
                : controller.saved()
                  ? 'Saved'
                  : 'Not saved'
            : 'No project open'}
        </span>
        <span>
          {draft()
            ? 'Enter to finish · Escape to cancel'
            : 'Wheel: zoom · Space: pan · Hold B: paint select · Alt: subtract · Q: quantities'}
        </span>
        <span>
          {controller.activeSheetId() &&
          controller.project()?.sheets[controller.activeSheetId() ?? '']
            ?.calibration
            ? `Scale: ${formatScale(controller.project()?.sheets[controller.activeSheetId() ?? '']?.calibration)}`
            : controller.activeSheetId()
              ? 'Sheet uncalibrated'
              : 'Ready'}{' '}
          · {controller.selection().length} selected
        </span>
      </footer>
      <Show when={scaleDialog()} keyed>
        {(target) => (
          <SheetScaleDialog
            sheet={target.sheet}
            expected={target.expected}
            controller={controller}
            onClose={() => setScaleDialog(null)}
            onMeasure={() => {
              setScaleDialog(null);
              setTool('calibrate');
            }}
          />
        )}
      </Show>
      <Show when={sheetNamesDialog()} keyed>
        {(target) => (
          <SheetNamesDialog
            sheets={target.sheets}
            expected={target.expected}
            controller={controller}
            onClose={() => setSheetNamesDialog(null)}
          />
        )}
      </Show>
      <Show when={projectAction()}>
        <div class="modal-backdrop">
          <section
            class="dialog compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-dialog-title"
          >
            <h2 id="project-dialog-title">
              {projectAction() === 'create'
                ? 'Create project'
                : 'Rename project'}
            </h2>
            <form
              class="stack"
              onSubmit={(event) => {
                event.preventDefault();
                run(async () => {
                  if (projectAction() === 'create')
                    await controller.createProject(projectName());
                  else await controller.renameProject(projectName());
                  setProjectAction(null);
                });
              }}
            >
              <label class="field">
                Project name
                <input
                  value={projectName()}
                  onInput={(event) => setProjectName(event.currentTarget.value)}
                />
              </label>
              <div class="button-row">
                <button
                  class="primary"
                  type="submit"
                  disabled={!projectName().trim() || controller.busy()}
                >
                  Save
                </button>
                <button
                  type="button"
                  disabled={controller.busy()}
                  onClick={() => setProjectAction(null)}
                >
                  Cancel
                </button>
              </div>
              <p role="status">{error() || controller.error()}</p>
            </form>
          </section>
        </div>
      </Show>
      <Show when={recipeOpen()}>
        <div class="modal-backdrop">
          <section
            class="dialog recipe-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Assembly editor"
          >
            <RecipeEditor
              controller={controller}
              onClose={() => {
                setRecipeOpen(false);
                setRecipeDraft(false);
              }}
              onError={setError}
              onDraftChange={setRecipeDraft}
            />
          </section>
        </div>
      </Show>
      <Show when={constructionOpen()}>
        <div class="modal-backdrop">
          <section
            class="dialog detailed-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Construction editor"
          >
            <ConstructionEditor
              controller={controller}
              onClose={() => {
                setConstructionOpen(false);
                setDetailDraft(false);
              }}
              onError={setError}
              onDraftChange={setDetailDraft}
            />
          </section>
        </div>
      </Show>
      <Show when={reviewOpen()}>
        <div class="modal-backdrop">
          <section
            class="dialog detailed-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Takeoff review"
          >
            <ReviewPanel
              controller={controller}
              onClose={() => {
                setReviewOpen(false);
                setDetailDraft(false);
              }}
              onError={setError}
              onDraftChange={setDetailDraft}
            />
          </section>
        </div>
      </Show>
      <Show when={updateOpen()}>
        <UpdateDialog
          controller={controller}
          hasDraft={hasDraft()}
          onClose={() => setUpdateOpen(false)}
        />
      </Show>
    </div>
  );
}
