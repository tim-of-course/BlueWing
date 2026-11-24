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
import {
  annotationKinds,
  annotationName,
  type AnnotationKind,
} from './core/annotations';
import type { DrawingTool } from './app/contracts';
import TakeoffControls from './components/TakeoffControls';
import DrawingCanvas from './components/canvas/DrawingCanvas';
import GroupInspector from './components/GroupInspector';
import SelectionInspector from './components/SelectionInspector';
import RecipeEditor from './components/RecipeEditor';
import Quantities from './components/Quantities';
import UpdateDialog from './components/UpdateDialog';
import ModalForm from './components/ModalForm';
import ToolIcon from './components/ToolIcon';
import WorkspacePanel, {
  createPanelPreferences,
} from './components/WorkspacePanel';
import { fitWorkspacePanels, type PanelName } from './app/panel-layout';
import SheetNavigator from './components/SheetNavigator';
import { PdfDropTarget } from './components/PdfDropTarget';
import SheetScaleDialog from './components/SheetScaleDialog';
import SheetNamesDialog from './components/SheetNamesDialog';
import type { Sheet } from './core/types';
import type { Application, Observation } from './app/application';
import ConstructionView from './components/ConstructionView';
import ConstructionEditor from './components/ConstructionEditor';
import ReviewPanel from './components/ReviewPanel';
import NotesPanel from './components/NotesPanel';
import HandoffViewer from './components/HandoffViewer';
import { chooseHandoff } from './app/files';
import { prepareHandoff, type HandoffDocument } from './app/handoff';
import { formatScale } from './core/scale';
import { resolveConstruction } from './core/applied-assemblies';
import { constructionKind } from './app/wingman-activity';
import Wingman from './components/Wingman';
import type {
  ModelView,
  PlanView,
  ViewportPort,
  WingmanVisual,
  WorkspaceViewSnapshot,
  ActivityTarget,
} from './app/wingman-types';

const tools: { id: DrawingTool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: '↖' },
  { id: 'path', label: 'Path', key: 'L', icon: '╱' },
  { id: 'area', label: 'Area', key: 'F', icon: '◇' },
  { id: 'count', label: 'Count', key: 'C', icon: '⊕' },
  { id: 'calibrate', label: 'Set scale', key: 'R', icon: '↔' },
  { id: 'annotations', label: 'Annotations', key: 'A', icon: '✎' },
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
  const construction = createMemo(() => {
    const project = controller.project();
    return project ? resolveConstruction(project) : undefined;
  });
  const panels = {
    sheets: createPanelPreferences('sheets'),
    inspector: createPanelPreferences('inspector'),
    wingman: createPanelPreferences('wingman'),
  };
  let workspaceBody!: HTMLDivElement;
  const [workspaceWidth, setWorkspaceWidth] = createSignal(window.innerWidth);
  const [panelOrder, setPanelOrder] = createSignal<PanelName[]>([
    'inspector',
    'sheets',
    'wingman',
  ]);
  const projectOpen = createMemo(() => !!controller.project());
  const displayed = createMemo(() =>
    fitWorkspacePanels(
      workspaceWidth(),
      panelOrder()
        .filter((name) => name !== 'wingman' || projectOpen())
        .map((name) => ({
          name,
          width: panels[name].width(),
          pinned: panels[name].pinned(),
        })),
    ),
  );
  function prioritize(name: PanelName) {
    setPanelOrder((previous) =>
      previous.at(-1) === name
        ? previous
        : [...previous.filter((p) => p !== name), name],
    );
  }
  function pinPanel(name: PanelName, value: boolean) {
    if (value) prioritize(name);
    panels[name].savePin(value);
  }
  const [inspectorPeek, setInspectorPeek] = createSignal(0);
  function requestInspector() {
    prioritize('inspector');
    setInspectorPeek((value) => value + 1);
  }
  onSettled(() => {
    const observer = new ResizeObserver(() =>
      setWorkspaceWidth(workspaceBody.clientWidth),
    );
    observer.observe(workspaceBody);
    return () => {
      observer.disconnect();
    };
  });
  const [sheetDraft, setSheetDraft] = createSignal(false);
  const [alignmentDraft, setAlignmentDraft] = createSignal(false);
  const [scaleDialog, setScaleDialog] = createSignal<{
    sheet: Sheet;
    expected: Observation;
  } | null>(null);
  const [sheetNamesDialog, setSheetNamesDialog] = createSignal<{
    sheets: Sheet[];
    expected: Observation;
  } | null>(null);
  const [tool, setTool] = createSignal<DrawingTool>('select', {
    name: 'workspace.tool',
  });
  const [annotationChoice, setAnnotationChoice] = createSignal<
    AnnotationKind | 'edit'
  >('edit');
  let lastAnnotationChoice: AnnotationKind | 'edit' = 'edit';
  const [annotationMenu, setAnnotationMenu] = createSignal(false);
  const [quantities, setQuantities] = createSignal(false);
  const [view, setView] = createSignal<'plan' | '3d' | 'split'>('plan');
  const [showPlan, setShowPlan] = createSignal(true);
  const [openedMessageView, setMessageView] =
    createSignal<WingmanVisual | null>(null);
  const messageView = createMemo(() => {
    const current = openedMessageView();
    if (!current) return null;
    const project = controller.project();
    return current.projectId === project?.id &&
      current.takeoffId === project.takeoffId
      ? current
      : null;
  });
  const [followingAgent, setFollowingAgent] = createSignal(false);
  let planViewport: ViewportPort<PlanView> | undefined;
  let modelViewport: ViewportPort<ModelView> | undefined;
  const [activityTarget, setActivityTarget] =
    createSignal<ActivityTarget | null>(null);
  const [constructionOpen, setConstructionOpen] = createSignal(false);
  const [reviewOpen, setReviewOpen] = createSignal(false);
  const [handoff, setHandoff] = createSignal<HandoffDocument | null>(null, {
    name: 'workspace.handoff',
  });
  const [handoffLoading, setHandoffLoading] = createSignal(false);
  const [detailDraft, setDetailDraft] = createSignal(false);
  const [error, setError] = createSignal('');
  const [projectName, setProjectName] = createSignal('Untitled project');
  const [groupName, setGroupName] = createSignal('');
  const [recipeOpen, setRecipeOpen] = createSignal(false);
  const [draft, setDraft] = createSignal(false);
  const [recipeDraft, setRecipeDraft] = createSignal(false);
  const [inspectorDraft, setInspectorDraft] = createSignal(false);
  const [notesView, setNotesView] = createSignal(false);
  const [notesDraft, setNotesDraft] = createSignal(false);
  const [selectionDraft, setSelectionDraft] = createSignal(false);
  const [updateOpen, setUpdateOpen] = createSignal(false);
  let updateOpener: HTMLButtonElement | undefined;
  let projectOpener: HTMLButtonElement | undefined;
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
      notesDraft() ||
      detailDraft() ||
      alignmentDraft() ||
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
    setAnnotationMenu(false);
    if (id === 'annotations') setAnnotationChoice(lastAnnotationChoice);
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
    else if (view() === '3d') setView('plan');
    setQuantities(false);
    if (id !== 'select' && id !== 'annotations') requestInspector();
  };
  function captureView(): WorkspaceViewSnapshot | null {
    const project = controller.project();
    if (!project) return null;
    return structuredClone({
      projectId: project.id,
      takeoffId: project.takeoffId ?? 'main',
      mode: view(),
      plan: planViewport?.read() ?? null,
      model: view() !== 'plan' ? (modelViewport?.read() ?? null) : null,
      context: controller.captureContext(),
      quantities: quantities(),
      showPlan: showPlan(),
      tool: tool(),
    });
  }
  async function applyView(next: WorkspaceViewSnapshot | WingmanVisual) {
    const project = controller.project();
    if (!project || next.projectId !== project.id)
      throw new Error('This view belongs to another project');
    if (hasDraft() || controller.busy())
      throw new Error('Finish your current edit before swapping views');
    if (
      'view' in next &&
      next.view.kind === 'plan' &&
      !project.sheets[next.view.sheetId]
    )
      throw new Error('The source sheet is no longer available');
    if (next.takeoffId !== project.takeoffId) {
      controller.selectTakeoff(next.takeoffId);
      flush();
    }
    setMessageView('view' in next && next.annotations ? next : null);
    if ('context' in next) {
      controller.restoreContext(next.context);
      setView(next.mode);
      setQuantities(next.quantities);
      setShowPlan(next.showPlan);
      setTool(next.tool);
      setFollowingAgent(false);
    } else {
      const context = controller.captureContext();
      controller.restoreContext({
        ...context,
        sheetId:
          next.view.kind === 'plan'
            ? next.view.sheetId
            : (next.view.activeSheetId ?? context.sheetId),
        selection:
          next.view.kind === '3d' ? (next.view.selectedGeometryIds ?? []) : [],
        activeGroupId: null,
        drawingGroupId: null,
        visibility: { hiddenSheets: [], hiddenGroups: {} },
        categories: next.view.categories,
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
    if (
      controller.project()?.id !== project.id ||
      controller.project()?.takeoffId !== next.takeoffId
    )
      return;
    if ('context' in next) {
      if (next.plan && project.sheets[next.plan.sheetId])
        planViewport?.apply(next.plan);
      if (next.model && next.mode !== 'plan') modelViewport?.apply(next.model);
    } else if (next.view.kind === 'plan') planViewport?.apply(next.view);
    else modelViewport?.apply(next.view);
  }
  function openActivityTarget(target: ActivityTarget, takeoffId?: string) {
    if (hasDraft() || controller.busy()) return;
    const id = target.kind === 'takeoff' ? target.id : takeoffId;
    if (id && id !== controller.project()?.takeoffId) {
      controller.selectTakeoff(id);
      flush();
    }
    const project = controller.project();
    if (!project) return;
    setActivityTarget(target);
    if (target.kind === 'assembly') {
      setRecipeOpen(true);
      return;
    }
    if (target.kind === 'snippet') {
      setReviewOpen(true);
      return;
    }
    if (constructionKind(target.kind)) {
      setConstructionOpen(true);
      return;
    }
    setQuantities(false);
    setView('plan');
    setTool('select');
    if (target.kind === 'sheet') controller.setActiveSheetId(target.id);
    if (target.kind === 'geometry') {
      const group = Object.values(project.groups).find((g) =>
        g.geometryIds.includes(target.id),
      );
      controller.showGeometry(target.id, group?.id ?? '');
      if (!group) controller.setActiveGroupId(null);
    }
    if (target.kind === 'group') {
      const group = project.groups[target.id];
      const sheetId = group?.geometryIds
        .map((id) => project.geometries[id]?.sheetId)
        .find(Boolean);
      if (sheetId) controller.setActiveSheetId(sheetId);
      controller.setSelection(
        group?.geometryIds.filter(
          (id) =>
            project.geometries[id]?.sheetId === sheetId &&
            controller.visibleGeometryIds().has(id),
        ) ?? [],
      );
      controller.setActiveGroupId(target.id);
    }
    if (target.kind === 'geometry' || target.kind === 'group') {
      setNotesView(false);
      requestInspector();
    }
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
      if (event.defaultPrevented) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"]',
        )
      )
        return;
      if (
        recipeOpen() ||
        alignmentDraft() ||
        constructionOpen() ||
        reviewOpen() ||
        handoff() ||
        updateOpen() ||
        projectAction() ||
        sheetDraft() ||
        scaleDialog() ||
        sheetNamesDialog() ||
        inspectorDraft() ||
        notesDraft() ||
        selectionDraft()
      )
        return;
      const key = event.key.toLowerCase();
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (key === 'arrowleft' || key === 'arrowright') &&
        !hasDraft() &&
        !controller.busy()
      ) {
        event.preventDefault();
        controller.goSheetHistory(key === 'arrowleft' ? -1 : 1);
      } else if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (key === 'arrowup' || key === 'arrowdown') &&
        !hasDraft() &&
        !controller.busy() &&
        !quantities() &&
        view() !== '3d'
      ) {
        const sheets = Object.values(controller.project()?.sheets ?? {}).sort(
          (a, b) => (a.order ?? a.pageIndex) - (b.order ?? b.pageIndex),
        );
        const index = sheets.findIndex(
          (sheet) => sheet.id === controller.activeSheetId(),
        );
        const next = sheets[index + (key === 'arrowup' ? -1 : 1)];
        if (index >= 0 && next) {
          event.preventDefault();
          controller.setActiveSheetId(next.id);
          controller.setActiveGroupId(null);
        }
      } else if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        run(() => (event.shiftKey ? controller.redo() : controller.undo()));
      } else if (
        (event.metaKey || event.ctrlKey) &&
        key === 'd' &&
        tool() !== 'annotations' &&
        !draft()
      ) {
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
        if (key === 'escape') setAnnotationMenu(false);
        if (key === 'q') setQuantities((current) => !current);
        if (
          tool() !== 'annotations' &&
          (key === 'delete' || key === 'backspace')
        ) {
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
      <PdfDropTarget
        native={controller.native}
        enabled={!!controller.project() && !controller.busy() && !hasDraft()}
        unavailableMessage={
          controller.project()
            ? 'Finish your current action before importing PDFs'
            : 'Open a project to import PDFs'
        }
        onDrop={(files) => {
          run(() => controller.importPdfFiles(files));
        }}
      />
      <header
        class="workspace-header"
        inert={recipeOpen() || constructionOpen() || reviewOpen()}
      >
        <strong class="brand">
          <img src="/brand/bluewing.svg" width="28" height="28" alt="" />
          Bluewing
        </strong>
        <button
          type="button"
          disabled={controller.busy() || hasDraft() || !!controller.project()}
          onClick={(event) => {
            projectOpener = event.currentTarget;
            setProjectName('Untitled project');
            setProjectAction('create');
          }}
        >
          New
        </button>
        <button
          type="button"
          disabled={controller.busy() || hasDraft()}
          onClick={() => {
            run(() => controller.openProject());
          }}
        >
          Open
        </button>
        <button
          type="button"
          disabled={handoffLoading()}
          onClick={() => {
            setHandoffLoading(true);
            run(async () => {
              try {
                const file = await chooseHandoff(controller.native);
                if (file) setHandoff(prepareHandoff(file.name, file.html));
              } finally {
                setHandoffLoading(false);
              }
            });
          }}
        >
          {handoffLoading()
            ? 'Opening handoff document…'
            : 'Open handoff document'}
        </button>
        <Show when={controller.recentProjects().length > 0}>
          <select
            class="recent-projects"
            aria-label="Recent projects"
            value=""
            disabled={controller.busy() || hasDraft()}
            onChange={(event) => {
              const path = event.currentTarget.value;
              event.currentTarget.value = '';
              if (path) run(() => controller.openRecentProject(path));
            }}
          >
            <option value="">Recent projects</option>
            <For each={controller.recentProjects()}>
              {(item) => (
                <option value={item.path}>
                  {controller.native
                    ? `${item.name} (${item.path})`
                    : item.name}
                </option>
              )}
            </For>
          </select>
        </Show>
        <button
          type="button"
          title="Previous viewed sheet (Alt+Left)"
          aria-label="Previous viewed sheet"
          disabled={controller.busy() || hasDraft() || !controller.canGoBack()}
          onClick={() => {
            controller.goSheetHistory(-1);
          }}
        >
          ←
        </button>
        <button
          type="button"
          title="Next viewed sheet (Alt+Right)"
          aria-label="Next viewed sheet"
          disabled={
            controller.busy() || hasDraft() || !controller.canGoForward()
          }
          onClick={() => {
            controller.goSheetHistory(1);
          }}
        >
          →
        </button>
        <Show when={controller.project()}>
          {(project) => (
            <>
              <TakeoffControls
                controller={controller}
                disabled={controller.busy() || hasDraft()}
              />
              <button
                class="project-title"
                type="button"
                title="Rename project"
                onClick={(event) => {
                  projectOpener = event.currentTarget;
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
        <button
          type="button"
          onClick={(event) => {
            updateOpener = event.currentTarget;
            setUpdateOpen(true);
          }}
        >
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
      <div ref={workspaceBody} class="workspace-body">
        <WorkspacePanel
          name="sheets"
          label="Sheets"
          side="left"
          preferences={panels.sheets}
          temporarilyCollapsed={
            panels.sheets.pinned() && !displayed().has('sheets')
          }
          onPinnedChange={(value) => {
            pinPanel('sheets', value);
          }}
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
              requestInspector();
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
                    onClick={(event) => {
                      projectOpener = event.currentTarget;
                      setProjectAction('create');
                    }}
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
                'padding-left': panels.sheets.pinned() ? undefined : '42px',
                'padding-right': panels.inspector.pinned() ? undefined : '42px',
              }}
            >
              <button
                type="button"
                disabled={
                  !controller.canUndo() ||
                  notesDraft() ||
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
                  notesDraft() ||
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
                <input
                  type="checkbox"
                  aria-label="Show annotations"
                  checked={controller.annotationsVisible()}
                  disabled={draft()}
                  onChange={(e) => {
                    controller.setAnnotationsVisible(e.currentTarget.checked);
                  }}
                />
                Annotations
              </label>
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
                  active={!quantities() && view() !== '3d'}
                  onViewport={(port) => {
                    planViewport = port;
                  }}
                  presentationActive={followingAgent()}
                  messageView={messageView()}
                  controller={controller}
                  tool={tool()}
                  annotationChoice={annotationChoice()}
                  onAnnotationCreated={() => setAnnotationChoice('edit')}
                  onError={setError}
                  onDraftChange={setDraft}
                  interactionDisabled={
                    inspectorDraft() || selectionDraft() || alignmentDraft()
                  }
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
                    controller={controller}
                    alignmentController={controller}
                    alignmentDisabled={hasDraft() || controller.busy()}
                    onDraftChange={setAlignmentDraft}
                    interactionDisabled={alignmentDraft()}
                    sheet={
                      controller.project()?.sheets[
                        controller.activeSheetId() ?? ''
                      ]
                    }
                    placement={Object.values(
                      construction()?.placements ?? {},
                    ).find(
                      (placement) =>
                        placement.sheetId === controller.activeSheetId(),
                    )}
                    showPlan={showPlan()}
                    onShowPlanChange={setShowPlan}
                    onViewport={(port) => {
                      modelViewport = port;
                    }}
                    presentationActive={followingAgent()}
                    messageView={messageView()}
                    result={result()}
                    estimateOutputs={
                      controller.quantities()?.coverage.estimateOutputs ?? 0
                    }
                    levels={Object.values(
                      controller.project()?.construction?.levels ?? {},
                    ).map((level) => ({
                      id: level.id,
                      name: level.name,
                      elevation: level.elevation,
                      sheetIds: [
                        ...new Set(
                          [
                            ...Object.values(construction()?.walls ?? {}),
                            ...Object.values(construction()?.ceilings ?? {}),
                            ...Object.values(construction()?.materials ?? {}),
                          ]
                            .filter((source) => source.levelId === level.id)
                            .map(
                              (source) =>
                                controller.project()?.geometries[
                                  source.geometryId
                                ]?.sheetId,
                            )
                            .filter((id): id is string => !!id),
                        ),
                      ],
                      geometryIds: [
                        ...new Set(
                          [
                            ...Object.values(construction()?.walls ?? {}),
                            ...Object.values(construction()?.ceilings ?? {}),
                            ...Object.values(construction()?.materials ?? {}),
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
        </main>
        <WorkspacePanel
          name="inspector"
          label="Inspector"
          side="right"
          preferences={panels.inspector}
          temporarilyCollapsed={
            panels.inspector.pinned() && !displayed().has('inspector')
          }
          onPinnedChange={(value) => {
            pinPanel('inspector', value);
          }}
          peekRequest={inspectorPeek()}
        >
          <div class="panel-heading">
            <h2>{notesView() ? 'Notes' : 'Inspector'}</h2>
            <button
              type="button"
              onClick={() => setNotesView((value) => !value)}
            >
              {notesView() ? 'Inspector' : 'Notes'}
            </button>
          </div>
          <div hidden={!notesView()}>
            <NotesPanel
              controller={controller}
              onDraftChange={setNotesDraft}
              onError={setError}
            />
          </div>
          <div hidden={notesView()}>
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
                      onInput={(event) =>
                        setGroupName(event.currentTarget.value)
                      }
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
                  when={
                    tool() === 'select' && controller.selection().length > 0
                  }
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
          </div>
        </WorkspacePanel>
        <nav
          class="tool-rail"
          aria-label="Drawing tools"
          onFocusOut={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              setAnnotationMenu(false);
          }}
        >
          <For each={tools}>
            {(item) => (
              <button
                type="button"
                class={tool() === item.id ? 'active' : ''}
                aria-label={`${item.label} (${item.key})`}
                aria-expanded={
                  item.id === 'annotations'
                    ? annotationMenu()
                      ? 'true'
                      : 'false'
                    : undefined
                }
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
                  const open = !annotationMenu();
                  chooseTool(item.id);
                  if (item.id === 'annotations') setAnnotationMenu(open);
                }}
              >
                <ToolIcon tool={item.id} />
              </button>
            )}
          </For>
          <Show when={annotationMenu() && tool() === 'annotations'}>
            <div
              class="annotation-choices"
              role="group"
              aria-label="Annotation tools"
            >
              <For each={['edit', ...annotationKinds] as const}>
                {(choice) => (
                  <button
                    type="button"
                    aria-pressed={
                      annotationChoice() === choice ? 'true' : 'false'
                    }
                    onClick={() => {
                      lastAnnotationChoice = choice;
                      setAnnotationChoice(choice);
                      setAnnotationMenu(false);
                    }}
                  >
                    {annotationName(choice)}
                  </button>
                )}
              </For>
            </div>
          </Show>
        </nav>
        <Show when={recipeOpen()}>
          <div class="modal-backdrop">
            <section
              class="dialog recipe-dialog"
              role="dialog"
              aria-modal="false"
              aria-label="Assembly editor"
            >
              <RecipeEditor
                initialId={
                  activityTarget()?.kind === 'assembly'
                    ? activityTarget()?.id
                    : undefined
                }
                controller={controller}
                onClose={() => {
                  setActivityTarget(null);
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
              aria-modal="false"
              aria-label="Construction editor"
            >
              <ConstructionEditor
                initialTarget={activityTarget()}
                controller={controller}
                onClose={() => {
                  setActivityTarget(null);
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
              aria-modal="false"
              aria-label="Takeoff review"
            >
              <ReviewPanel
                initialSnippetId={
                  activityTarget()?.kind === 'snippet'
                    ? activityTarget()?.id
                    : undefined
                }
                controller={controller}
                onShowPlan={() => {
                  if (quantities() || view() === '3d') setView('plan');
                  setQuantities(false);
                }}
                onClose={() => {
                  setActivityTarget(null);
                  setReviewOpen(false);
                  setDetailDraft(false);
                }}
                onError={setError}
                onDraftChange={setDetailDraft}
              />
            </section>
          </div>
        </Show>
        <Wingman
          preferences={panels.wingman}
          temporarilyCollapsed={
            panels.wingman.pinned() && !displayed().has('wingman')
          }
          onPinnedChange={(value) => {
            pinPanel('wingman', value);
          }}
          onReveal={() => {
            prioritize('wingman');
          }}
          controller={controller}
          openTarget={openActivityTarget}
          captureView={captureView}
          viewMode={view()}
          canAttachView={
            !quantities() &&
            !hasDraft() &&
            (view() !== 'plan' || !!controller.activeSheetId())
          }
          applyView={applyView}
          navigationDisabled={
            hasDraft() ||
            controller.busy() ||
            constructionOpen() ||
            reviewOpen() ||
            !!handoff() ||
            recipeOpen() ||
            updateOpen()
          }
        />
      </div>
      <footer>
        <button
          type="button"
          title="Record a performance report while you use Bluewing, then save it to help investigate slowdowns."
          onClick={() => {
            run(() =>
              controller.performanceRecording()
                ? controller.savePerformanceRecording()
                : controller.startPerformanceRecording(),
            );
          }}
        >
          {controller.performanceRecording()
            ? 'Save performance recording'
            : 'Record performance'}
        </button>
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
        <Show when={controller.preparationStatus().total > 0}>
          <span class="page-preparation">
            <span>
              Prepared {controller.preparationStatus().completed} of{' '}
              {controller.preparationStatus().total} pages
              {controller.preparationStatus().failed > 0 &&
                ` · ${String(controller.preparationStatus().failed)} failed`}
              {controller.preparationStatus().paused
                ? ' · Paused'
                : controller.preparationStatus().running
                  ? ' · Preparing'
                  : ''}
            </span>
            <Show
              when={
                controller.preparationStatus().completed +
                  controller.preparationStatus().failed <
                  controller.preparationStatus().total ||
                controller.preparationStatus().running
              }
            >
              <button
                type="button"
                onClick={() => {
                  controller.setPreparationPaused(
                    !controller.preparationStatus().paused,
                  );
                }}
              >
                {controller.preparationStatus().paused
                  ? 'Resume preparation'
                  : 'Pause preparation'}
              </button>
            </Show>
          </span>
        </Show>
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
              if (view() === '3d') setView('plan');
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
        <ModalForm
          labelledBy="project-dialog-title"
          opener={projectOpener}
          busy={controller.busy()}
          onClose={() => setProjectAction(null)}
        >
          <h2 id="project-dialog-title">
            {projectAction() === 'create' ? 'Create project' : 'Rename project'}
          </h2>
          <form
            class="stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (controller.busy() || !projectName().trim()) return;
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
        </ModalForm>
      </Show>

      <Show when={updateOpen()}>
        <UpdateDialog
          opener={updateOpener}
          controller={controller}
          hasDraft={hasDraft()}
          onClose={() => setUpdateOpen(false)}
        />
      </Show>
      <Show when={handoff()}>
        {(document) => (
          <HandoffViewer
            document={document()}
            onClose={() => setHandoff(null)}
          />
        )}
      </Show>
    </div>
  );
}
