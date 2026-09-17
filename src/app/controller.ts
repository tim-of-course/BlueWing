import { createMemo, createSignal, onCleanup, onSettled } from 'solid-js';
import { isTauri } from '@tauri-apps/api/core';
import { calculateProject, exportQuantities } from '../core';
import type { CommandCall, Project } from '../core/types';
import { Application, type Observation } from './application';
import { choosePdf, chooseProject, writeOutput } from './files';
import { connectCli } from './cli';
import type { WorkspaceController } from './contracts';

export function createWorkspace(): WorkspaceController {
  const app = new Application(isTauri());
  const [project, setProject] = createSignal<Project | null>(null, {
    name: 'workspace.acceptedProject',
  });
  const [activeSheetId, setActiveSheetId] = createSignal<string | null>(null, {
    name: 'workspace.activeSheet',
  });
  const [selection, setSelection] = createSignal<string[]>([], {
    name: 'workspace.selection',
  });
  const [activeGroupId, setActiveGroupId] = createSignal<string | null>(null, {
    name: 'workspace.activeGroup',
  });
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
  const saved = createMemo(() => !busy() && !error(), {
    name: 'workspace.saved',
  });
  let pending = 0;
  let publishedId: string | null = null;
  onCleanup(
    app.subscribe(() => {
      const current = app.project;
      setProject(current);
      setCanUndo(app.session?.canUndo ?? false);
      setCanRedo(app.session?.canRedo ?? false);
      if (publishedId !== (current?.id ?? null)) {
        setSelection([]);
        setActiveGroupId(null);
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
    native: app.native,
    project,
    quantities,
    activeSheetId,
    setActiveSheetId(id) {
      setActiveSheetId(id);
      setSelection([]);
    },
    selection,
    setSelection,
    activeGroupId,
    setActiveGroupId,
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
      const file = await choosePdf(app.native);
      if (file) {
        const sheets = await run(() => app.importBytes(file, expected));
        setActiveSheetId(sheets[0]?.id ?? null);
      }
    },
    undo: () => command('history.undo'),
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
      const groupId = activeGroupId();
      const group = groupId ? requireProject().groups[groupId] : undefined;
      if (group)
        commands.push({
          name: 'group.members',
          payload: { id: group.id, geometryIds: [...group.geometryIds, id] },
        });
      await batch(commands, expected);
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
    saveRecipe: (recipe, expected) => command('recipe.put', recipe, expected),
    deleteRecipe: (id) => command('recipe.delete', { id }),
    renderSheet: (sheet, maxDimension) => app.pdf.render(sheet, maxDimension),
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
