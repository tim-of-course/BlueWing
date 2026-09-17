import { createEffect, createSignal, For, Show, onSettled } from 'solid-js';
import { createWorkspace } from './app/controller';
import type { DrawingTool } from './app/contracts';
import DrawingCanvas from './components/canvas/DrawingCanvas';
import GroupInspector from './components/GroupInspector';
import RecipeEditor from './components/RecipeEditor';
import Quantities from './components/Quantities';
import UpdateDialog from './components/UpdateDialog';
import ToolIcon from './components/ToolIcon';

const tools: { id: DrawingTool; label: string; key: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: 'V', icon: '↖' },
  { id: 'path', label: 'Path', key: 'L', icon: '╱' },
  { id: 'area', label: 'Area', key: 'F', icon: '◇' },
  { id: 'count', label: 'Count', key: 'C', icon: '⊕' },
  { id: 'calibrate', label: 'Calibrate', key: 'R', icon: '↔' },
];
export default function App() {
  const controller = createWorkspace();
  const [sheetsVisible, setSheetsVisible] = createSignal(true, {
    name: 'workspace.sheetsVisible',
  });
  const [inspectorVisible, setInspectorVisible] = createSignal(true);
  const [leftWidth, setLeftWidth] = createSignal(292);
  const [rightWidth, setRightWidth] = createSignal(330);
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
    projectAction() !== null ||
    groupName().trim() !== '';
  createEffect(
    hasDraft,
    (pending) => {
      controller.setDraftPending(pending);
    },
    { name: 'workspace.unfinishedEdits' },
  );
  onSettled(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"]',
        )
      )
        return;
      if (recipeOpen() || updateOpen() || projectAction()) return;
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        run(() => (event.shiftKey ? controller.redo() : controller.undo()));
      } else if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !draft()
      ) {
        const match = tools.find((item) => item.key.toLowerCase() === key);
        if (match) setTool(match.id);
        if (key === 'q') setQuantities((current) => !current);
        if (key === 'delete') run(() => controller.deleteSelection());
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
          aria-controls="sheet-navigator"
          aria-expanded={sheetsVisible() ? 'true' : 'false'}
          onClick={() => setSheetsVisible((value) => !value)}
        >
          Sheets
        </button>
        <button
          type="button"
          disabled={controller.busy() || hasDraft()}
          onClick={() => {
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
          disabled={draft()}
          onClick={() => setQuantities(false)}
        >
          Drawing
        </button>
        <button
          type="button"
          class={quantities() ? 'active' : ''}
          disabled={draft()}
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
        <button
          type="button"
          aria-expanded={inspectorVisible() ? 'true' : 'false'}
          onClick={() => setInspectorVisible((value) => !value)}
        >
          Inspector
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
        <aside
          id="sheet-navigator"
          class="navigator"
          aria-label="Sheets"
          hidden={!sheetsVisible()}
          style={{ width: `${String(leftWidth())}px` }}
        >
          <div class="panel-heading">
            <h2>Sheets</h2>
            <button
              type="button"
              disabled={!controller.project() || controller.busy() || draft()}
              onClick={() => {
                run(() => controller.importPdf());
              }}
            >
              Import PDF
            </button>
          </div>
          <div class="sheet-list">
            <For
              each={Object.values(controller.project()?.sheets ?? {})}
              fallback={<p class="muted">No sheets loaded</p>}
            >
              {(sheet) => (
                <button
                  class={[
                    'sheet-row',
                    controller.activeSheetId() === sheet.id ? 'active' : '',
                  ]}
                  type="button"
                  disabled={draft()}
                  onClick={() => {
                    controller.setActiveSheetId(sheet.id);
                    controller.setSelection([]);
                  }}
                >
                  <span class="sheet-icon">▤</span>
                  <span>
                    {sheet.name}
                    <small>
                      {Math.round(sheet.width)} × {Math.round(sheet.height)} ·{' '}
                      {sheet.calibration ? 'Calibrated' : 'Set scale'}
                    </small>
                  </span>
                </button>
              )}
            </For>
          </div>
          <div class="panel-heading">
            <h2>Groups</h2>
            <button
              type="button"
              disabled={draft() || inspectorDraft()}
              onClick={() => {
                controller.setActiveGroupId(null);
              }}
            >
              Clear context
            </button>
          </div>
          <p class="hint">New drawing joins the selected group.</p>
          <For each={Object.values(controller.project()?.groups ?? {})}>
            {(group) => (
              <button
                type="button"
                disabled={draft() || inspectorDraft()}
                class={[
                  'group-row',
                  controller.activeGroupId() === group.id ? 'active' : '',
                ]}
                onClick={() => {
                  controller.setActiveGroupId(group.id);
                }}
              >
                <span
                  class="color-dot"
                  style={{ background: group.color ?? '#3b82f6' }}
                />
                <span>{group.name}</span>
                <small>{group.geometryIds.length}</small>
              </button>
            )}
          </For>
          <Show when={controller.project()}>
            <form
              class="new-group"
              onSubmit={(event) => {
                event.preventDefault();
                run(async () => {
                  const id = await controller.createGroup(
                    groupName().trim(),
                    '#3b82f6',
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
          <label class="panel-resize">
            Panel width
            <input
              aria-label="Sheets panel width"
              type="range"
              min="220"
              max="500"
              value={leftWidth()}
              onInput={(event) =>
                setLeftWidth(event.currentTarget.valueAsNumber)
              }
            />
          </label>
        </aside>
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
                disabled={!controller.canUndo() || controller.busy()}
                onClick={() => {
                  run(() => controller.undo());
                }}
              >
                Undo
              </button>
              <button
                type="button"
                disabled={!controller.canRedo() || controller.busy()}
                onClick={() => {
                  run(() => controller.redo());
                }}
              >
                Redo
              </button>
              <button
                type="button"
                disabled={!controller.selection().length || controller.busy()}
                onClick={() => {
                  run(() => controller.copySelection());
                }}
              >
                Copy
              </button>
              <button
                type="button"
                disabled={!controller.selection().length || controller.busy()}
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
            <Show
              when={!quantities()}
              fallback={
                <Quantities
                  controller={controller}
                  onError={setError}
                  onShowDrawing={() => setQuantities(false)}
                  navigationDisabled={inspectorDraft()}
                />
              }
            >
              <DrawingCanvas
                controller={controller}
                tool={tool()}
                onError={setError}
                onDraftChange={setDraft}
              />
            </Show>
          </Show>
        </main>
        <aside
          class="inspector"
          aria-label="Inspector"
          hidden={!inspectorVisible()}
          style={{ width: `${String(rightWidth())}px` }}
        >
          <div class="panel-heading">
            <h2>Inspector</h2>
          </div>
          <GroupInspector
            controller={controller}
            onError={setError}
            onDraftChange={setInspectorDraft}
            navigationDisabled={draft()}
          />
          <label class="panel-resize">
            Panel width
            <input
              aria-label="Inspector panel width"
              type="range"
              min="260"
              max="550"
              value={rightWidth()}
              onInput={(event) =>
                setRightWidth(event.currentTarget.valueAsNumber)
              }
            />
          </label>
        </aside>
        <nav class="tool-rail" aria-label="Drawing tools">
          <For each={tools}>
            {(item) => (
              <button
                type="button"
                class={tool() === item.id ? 'active' : ''}
                aria-label={`${item.label} (${item.key})`}
                aria-pressed={tool() === item.id ? 'true' : 'false'}
                title={`${item.label} (${item.key})`}
                disabled={draft() || !controller.project()}
                onClick={() => {
                  setTool(item.id);
                  setQuantities(false);
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
            : 'Shift-click to select multiple · Q switches workspace'}
        </span>
        <span>{controller.native ? 'Desktop' : 'Browser workspace'}</span>
      </footer>
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
