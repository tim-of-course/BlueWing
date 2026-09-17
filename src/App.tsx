import { createEffect, createSignal, For, Show, onSettled } from 'solid-js';
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
import type { Sheet } from './core/types';
import type { Observation } from './app/application';
import { formatScale } from './core/scale';

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
export default function App() {
  const controller = createWorkspace();
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
  const hasDraft = () =>
    draft() ||
    recipeDraft() ||
    inspectorDraft() ||
    selectionDraft() ||
    sheetDraft() ||
    scaleDialog() !== null ||
    projectAction() !== null ||
    groupName().trim() !== '';
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
        updateOpen() ||
        projectAction() ||
        sheetDraft() ||
        scaleDialog() ||
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
        <strong class="brand">Bluewing</strong>
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
          Recipes
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
                <div class="empty-mark">B</div>
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
            <div class="workspace-toolbar">
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
            <div class="drawing-workspace" hidden={quantities()}>
              <DrawingCanvas
                controller={controller}
                tool={tool()}
                onError={setError}
                onDraftChange={setDraft}
                interactionDisabled={inspectorDraft() || selectionDraft()}
              />
            </div>
          </Show>
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
                title={`${item.label} (${item.key})`}
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
            : 'Wheel: zoom · Space / middle-drag: pan · Q: quantities'}
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
            aria-label="Recipe editor"
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
