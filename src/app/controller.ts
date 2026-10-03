import { createMemo, createSignal, onCleanup, onSettled } from 'solid-js';
import { isTauri } from '@tauri-apps/api/core';
import { calculateProject, exportQuantities, exportPieces } from '../core';
import type { AssemblyLibrary, CommandCall, Project } from '../core/types';
import { Application, type Observation } from './application';
import { choosePdf, chooseProject, writeOutput } from './files';
import { connectCli } from './cli';
import { exportConstruction } from '../core/detailed-commands';
import { renderImage } from './render';
import { encodeBase64 } from '../platform/base64';
import type { WorkspaceController } from './contracts';
import {
  readVisibility,
  visibleDrawingIds,
  type DrawingVisibility,
} from './visibility';

export function createWorkspace(
  app = new Application(isTauri()),
): WorkspaceController {
  const [cliConnection, setCliConnection] = createSignal(app.cliConnection);
  const [library, setLibrary] = createSignal<AssemblyLibrary | null>(null);
  const [project, setProject] = createSignal<Project | null>(null, {
    name: 'workspace.acceptedProject',
  });
  const [activeSheetId, setActiveSheetId] = createSignal<string | null>(null, {
    name: 'workspace.activeSheet',
  });
  const [selectedIds, setSelection] = createSignal<string[]>([], {
    name: 'workspace.selection',
  });
  const [activeGroupId, setActiveGroupId] = createSignal<string | null>(null, {
    name: 'workspace.activeGroup',
  });
  const [drawingGroupId, setDrawingGroupId] = createSignal<string | null>(
    null,
    { name: 'workspace.drawingGroup' },
  );
  const [visibility, setVisibility] = createSignal<DrawingVisibility>(
    { hiddenSheets: [], hiddenGroups: {} },
    { name: 'workspace.drawingVisibility' },
  );
  const visibleGeometryIds = createMemo(
    () => visibleDrawingIds(project(), visibility()),
    { name: 'workspace.visibleDrawing' },
  );
  const selection = createMemo(
    () => selectedIds().filter((id) => visibleGeometryIds().has(id)),
    {
      name: 'workspace.visibleSelection',
      equals: (previous, next) =>
        previous.length === next.length &&
        previous.every((id, index) => id === next[index]),
    },
  );
  function changeVisibility(next: DrawingVisibility) {
    setVisibility(next);
    // A hidden selection must not reappear selected when its group is shown.
    const visible = visibleDrawingIds(app.project, next);
    setSelection((ids) => ids.filter((id) => visible.has(id)));
    if (app.project) {
      try {
        localStorage.setItem(
          `bluewing.visibility.${app.project.id}`,
          JSON.stringify(next),
        );
      } catch {
        // Visibility still works when saving a device preference is unavailable.
      }
    }
  }
  function setSheetVisible(sheetId: string, visible: boolean) {
    const previous = visibility();
    if (previous.hiddenSheets.includes(sheetId) === !visible) return;
    changeVisibility({
      ...previous,
      hiddenSheets: visible
        ? previous.hiddenSheets.filter((id) => id !== sheetId)
        : [...previous.hiddenSheets, sheetId],
    });
  }
  function setGroupVisible(groupId: string, sheetId: string, visible: boolean) {
    const previous = visibility();
    const hidden = previous.hiddenGroups[sheetId] ?? [];
    if (hidden.includes(groupId) === !visible) return;
    changeVisibility({
      ...previous,
      hiddenGroups: {
        ...previous.hiddenGroups,
        [sheetId]: visible
          ? hidden.filter((id) => id !== groupId)
          : [...hidden, groupId],
      },
    });
  }
  const [busy, setBusy] = createSignal(false, { name: 'workspace.saving' });
  const [error, setError] = createSignal<string | null>(null, {
    name: 'workspace.error',
  });
  const [canUndo, setCanUndo] = createSignal(false, {
    name: 'workspace.canUndo',
  });
  const [canRedo, setCanRedo] = createSignal(false, {
    name: 'workspace.canRedo',
  });
  const quantities = createMemo(
    () => {
      const current = project();
      return current ? calculateProject(current) : null;
    },
    { name: 'workspace.quantities' },
  );
  const construction = createMemo(() => quantities()?.model ?? null, {
    name: 'workspace.construction',
  });
  const saved = createMemo(() => !busy() && !error(), {
    name: 'workspace.saved',
  });
  let pending = 0;
  let publishedId: string | null = null;
  onCleanup(
    app.subscribe(() => {
      const current = app.project;
      setProject(current);
      setCliConnection(app.cliConnection);
      setLibrary(app.library);
      setCanUndo(app.session?.canUndo ?? false);
      setCanRedo(app.session?.canRedo ?? false);
      if (publishedId !== (current?.id ?? null)) {
        setVisibility(readVisibility(current?.id ?? null));
        setSelection([]);
        setActiveGroupId(null);
        setDrawingGroupId(null);
        setActiveSheetId(Object.keys(current?.sheets ?? {})[0] ?? null);
        publishedId = current?.id ?? null;
      } else {
        setSelection((ids) => ids.filter((id) => current?.geometries[id]));
        setActiveSheetId((id) =>
          id && current?.sheets[id]
            ? id
            : (Object.keys(current?.sheets ?? {})[0] ?? null),
        );
        setActiveGroupId((id) => (id && current?.groups[id] ? id : null));
        setDrawingGroupId((id) => (id && current?.groups[id] ? id : null));
      }
    }),
  );
  onSettled(() => {
    if (!app.native) return;
    let disposed = false;
    let disconnect: (() => void) | undefined;
    void connectCli(app)
      .then((cleanup) => {
        if (disposed) cleanup();
        else disconnect = cleanup;
      })
      .catch((reason: unknown) => setError(String(reason)));
    return () => {
      disposed = true;
      disconnect?.();
    };
  });

  async function run<T>(operation: () => Promise<T>): Promise<T> {
    pending += 1;
    setBusy(true);
    setError(null);
    try {
      return await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    } finally {
      pending -= 1;
      setBusy(pending > 0);
    }
  }
  async function command(
    name: string,
    payload?: unknown,
    expected?: Observation,
  ): Promise<void> {
    const observation = expected ?? (app.project ? app.observe() : {});
    await run(() =>
      app.dispatch({
        name,
        payload: payload ?? {},
        ...observation,
        origin: 'ui',
      }),
    );
  }
  function requireProject(): Project {
    const current = app.project;
    if (!current) throw new Error('Open or create a project first');
    return current;
  }
  function batch(commands: CommandCall[], expected?: Observation) {
    return command('batch', { commands }, expected);
  }
  return {
    messaging: app.messaging,
    cliConnection,
    setPresentation(presentation) {
      app.presentation = presentation;
    },
    captureContext() {
      return structuredClone({
        sheetId: activeSheetId(),
        selection: selection(),
        activeGroupId: activeGroupId(),
        drawingGroupId: drawingGroupId(),
        visibility: visibility(),
      });
    },
    restoreContext(context) {
      const current = app.project;
      changeVisibility(context.visibility);
      setActiveSheetId(
        context.sheetId && current?.sheets[context.sheetId]
          ? context.sheetId
          : (Object.keys(current?.sheets ?? {})[0] ?? null),
      );
      setSelection(context.selection.filter((id) => current?.geometries[id]));
      setActiveGroupId(
        context.activeGroupId && current?.groups[context.activeGroupId]
          ? context.activeGroupId
          : null,
      );
      setDrawingGroupId(
        context.drawingGroupId && current?.groups[context.drawingGroupId]
          ? context.drawingGroupId
          : null,
      );
    },
    construction,
    execute(call, expected) {
      return run(
        async () =>
          (
            await app.dispatch({
              ...call,
              ...(expected ?? (app.project ? app.observe() : {})),
              origin: 'ui',
            })
          ).data,
      );
    },
    async renderSnippet(id) {
      const current = requireProject();
      const snippet =
        typeof id === 'string' ? current.review?.snippets[id] : id;
      if (!snippet) throw new Error('Snippet not found');
      const image = await renderImage(current, app.pdf, {
        ...snippet,
        highlightIds: snippet.geometryIds,
        label: `${current.sheets[snippet.sheetId]?.name ?? ''} · ${snippet.name}`,
        maxDimension: 1400,
      });
      return `data:image/png;base64,${encodeBase64(image.bytes)}`;
    },
    async exportSnippet(id) {
      await run(async () => {
        const current = requireProject();
        const snippet = current.review?.snippets[id];
        if (!snippet) throw new Error('Snippet not found');
        const image = await renderImage(current, app.pdf, {
          ...snippet,
          highlightIds: snippet.geometryIds,
          label: `${current.sheets[snippet.sheetId]?.name ?? ''} · ${snippet.name}`,
        });
        await writeOutput(app.native, `${snippet.name}.png`, image.bytes);
      });
    },
    async exportConstruction(format, schedule) {
      await run(() =>
        writeOutput(
          app.native,
          `${requireProject().name}-${schedule}.${format}`,
          new TextEncoder().encode(
            exportConstruction(requireProject(), format, schedule),
          ),
        ),
      );
    },
    native: app.native,
    library,
    refreshLibrary: () => command('library.inspect'),
    addLibraryStarters: (expectedLibraryRevision) =>
      command('library.addStarters', { expectedLibraryRevision }),
    saveLibraryAssembly: (assembly, expectedLibraryRevision) =>
      command('library.put', { assembly, expectedLibraryRevision }),
    deleteLibraryAssembly: (id, expectedLibraryRevision) =>
      command('library.delete', { id, expectedLibraryRevision }),
    async importAssembly(libraryId) {
      const id = crypto.randomUUID();
      await command('assembly.import', { libraryId, id });
      return id;
    },
    saveAssignment: (assignment, expected) =>
      command('assignment.put', assignment, expected),
    async exportPieces() {
      const project = requireProject();
      await run(() =>
        writeOutput(
          app.native,
          `${project.name}-pieces.csv`,
          new TextEncoder().encode(exportPieces(project, 'csv')),
        ),
      );
    },
    project,
    quantities,
    activeSheetId,
    setActiveSheetId(id) {
      setActiveSheetId(id);
      setSelection([]);
    },
    selection,
    setSelection(ids) {
      setSelection(ids.filter((id) => visibleGeometryIds().has(id)));
    },
    visibleGeometryIds,
    isSheetVisible: (sheetId) => !visibility().hiddenSheets.includes(sheetId),
    setSheetVisible,
    isGroupVisible: (groupId, sheetId) =>
      !visibility().hiddenGroups[sheetId]?.includes(groupId),
    setGroupVisible,
    showGeometry(id, groupId) {
      const geometry = app.project?.geometries[id];
      if (!geometry) return;
      const view = visibility();
      changeVisibility({
        hiddenSheets: view.hiddenSheets.filter(
          (sheetId) => sheetId !== geometry.sheetId,
        ),
        hiddenGroups: {
          ...view.hiddenGroups,
          [geometry.sheetId]: (
            view.hiddenGroups[geometry.sheetId] ?? []
          ).filter((hidden) => hidden !== groupId),
        },
      });
      setActiveSheetId(geometry.sheetId);
      setActiveGroupId(groupId);
      setSelection([id]);
    },
    activeGroupId,
    setActiveGroupId,
    drawingGroupId,
    setDrawingGroupId,
    busy,
    error,
    dismissError: () => setError(null),
    saved,
    canUndo,
    canRedo,
    observe: () => app.observe(),
    setDraftPending(pending) {
      app.draftPending = pending;
    },
    async createProject(name) {
      const path = app.native
        ? await chooseProject(true, name)
        : `browser:${crypto.randomUUID()}`;
      if (path) await command('project.create', { name, path });
    },
    async openProject() {
      const path = app.native
        ? await chooseProject(false)
        : localStorage.getItem('bluewing.lastProject');
      if (!path && !app.native)
        throw new Error('No saved browser project. Create a project first.');
      if (path) await command('project.open', { path });
    },
    closeProject: () => command('project.close'),
    renameProject: (name) => command('project.rename', { name }),
    async importPdf() {
      const expected = app.observe();
      await run(async () => {
        const file = await choosePdf(app.native);
        if (file) {
          const sheets = await app.importBytes(file, expected);
          setActiveSheetId(sheets[0]?.id ?? null);
        }
      });
    },
    undo: () => command('history.undo'),
    renameSheet: (id, name, expected) =>
      command('sheet.put', { ...requireProject().sheets[id], name }, expected),
    suggestSheetName: (sheet) => app.pdf.suggestName(sheet),
    async renameSheets(names, expected) {
      const current = requireProject();
      const commands = names.map(({ id, name }) => {
        const sheet = current.sheets[id];
        if (!sheet) throw new Error('Sheet no longer exists');
        return { name: 'sheet.put', payload: { ...sheet, name: name.trim() } };
      });
      if (commands.length) await batch(commands, expected);
    },
    async duplicateSheet(id) {
      const current = requireProject();
      const source = current.sheets[id];
      if (!source) throw new Error('Sheet no longer exists');
      await command('sheet.put', {
        ...source,
        id: crypto.randomUUID(),
        name: `${source.name} copy`,
        order:
          Math.max(
            -1,
            ...Object.values(current.sheets).map(
              (sheet) => sheet.order ?? sheet.pageIndex,
            ),
          ) + 1,
      });
    },
    deleteSheet: (id) => command('sheet.delete', { id }),
    reorderSheets: (ids) =>
      batch(
        ids.map((id, order) => ({
          name: 'sheet.put',
          payload: { ...requireProject().sheets[id], order },
        })),
      ),
    redo: () => command('history.redo'),
    async addGeometry(kind, points, name, expected) {
      const sheetId = activeSheetId();
      if (!sheetId) throw new Error('Choose a sheet first');
      const id = crypto.randomUUID();
      const commands: CommandCall[] = [
        {
          name: 'geometry.put',
          payload: {
            id,
            sheetId,
            kind,
            points,
            name:
              name ??
              `${kind === 'path' ? 'Path' : kind === 'area' ? 'Area' : 'Count'} ${String(Object.keys(requireProject().geometries).length + 1)}`,
          },
        },
      ];
      const groupId = drawingGroupId();
      const group = groupId ? requireProject().groups[groupId] : undefined;
      if (group)
        commands.push({
          name: 'group.members',
          payload: { id: group.id, geometryIds: [...group.geometryIds, id] },
        });
      await batch(commands, expected);
      const view = visibility();
      if (
        view.hiddenSheets.includes(sheetId) ||
        (groupId && view.hiddenGroups[sheetId]?.includes(groupId))
      )
        changeVisibility({
          hiddenSheets: view.hiddenSheets.filter(
            (hidden) => hidden !== sheetId,
          ),
          hiddenGroups: {
            ...view.hiddenGroups,
            [sheetId]: (view.hiddenGroups[sheetId] ?? []).filter(
              (hidden) => hidden !== groupId,
            ),
          },
        });
      setSelection([id]);
      return id;
    },
    async updateGeometry(id, patch, expected) {
      const geometry = requireProject().geometries[id];
      if (!geometry) throw new Error('Geometry no longer exists');
      await command('geometry.put', { ...geometry, ...patch }, expected);
    },
    async deleteSelection() {
      await batch(
        selection().map((id) => ({ name: 'geometry.delete', payload: { id } })),
      );
      setSelection([]);
    },
    async copySelection() {
      const ids: string[] = [];
      await batch(
        selection().map((id) => {
          const copyId = crypto.randomUUID();
          ids.push(copyId);
          return {
            name: 'geometry.copy',
            payload: { id, newId: copyId, dx: 12, dy: 12 },
          };
        }),
      );
      setSelection(ids);
    },
    moveSelection: (dx, dy, expected) =>
      command('geometry.move', { ids: selection(), dx, dy }, expected),
    setScale: (id, scale, expected) =>
      command(
        'sheet.scale',
        { id, paper: scale.paper, real: scale.real },
        expected,
      ),
    calibrate: (id, start, end, value, unit, expected) =>
      command(
        'sheet.calibrate',
        { id, start, end, distance: { value, unit } },
        expected,
      ),
    async createGroup(name, color) {
      const id = crypto.randomUUID();
      await command('group.put', { id, name, color, geometryIds: selection() });
      setActiveGroupId(id);
      setDrawingGroupId(id);
      return id;
    },
    async updateGroup(id, patch, expected) {
      const group = requireProject().groups[id];
      if (!group) throw new Error('Group no longer exists');
      await command('group.put', { ...group, ...patch }, expected);
    },
    deleteGroup: (id) => command('group.delete', { id }),
    async duplicateGroup(id) {
      const copyId = crypto.randomUUID();
      await command('group.copy', { id, newId: copyId });
      setActiveGroupId(copyId);
      return copyId;
    },
    setMembership: (id, geometryIds) =>
      command('group.members', { id, geometryIds }),
    async assignRecipe(groupId, recipeId) {
      const id = crypto.randomUUID();
      await command('assignment.put', {
        id,
        groupId,
        recipeId,
        inputs: {},
        allowances: {},
      });
      return id;
    },
    async updateAssignment(id, inputs, allowances, expected) {
      const assignment = requireProject().assignments[id];
      if (!assignment) throw new Error('Assignment no longer exists');
      await command(
        'assignment.put',
        { ...assignment, inputs, allowances },
        expected,
      );
    },
    deleteAssignment: (id) => command('assignment.delete', { id }),
    saveRecipe: (recipe, expected) => command('assembly.put', recipe, expected),
    deleteRecipe: (id) => command('assembly.delete', { id }),
    renderSheet: (sheet, maxDimension) => app.pdf.render(sheet, maxDimension),
    renderRegion: (sheet, bounds, maxDimension) =>
      app.pdf.renderRegion(sheet, bounds, maxDimension),
    async exportQuantities(format) {
      const current = requireProject();
      const content = exportQuantities(current, format);
      await run(() =>
        writeOutput(
          app.native,
          `${current.name}.${format}`,
          new TextEncoder().encode(content),
        ),
      );
    },
    async installWebUpdate(manifestUrl) {
      const result = await run(() =>
        app.dispatch({ name: 'web.stage', payload: { manifestUrl } }),
      );
      return (result.data as { version: string }).version;
    },
    async activateWebUpdate(version) {
      await command('web.activate', { version });
      window.location.reload();
    },
  };
}
