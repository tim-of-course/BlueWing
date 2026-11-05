import { Application } from '../../src/app/application';
import { dispatchCli } from '../../src/app/cli';
import { sheetTextPdf } from './pdf-fixtures';

async function run() {
  const app = new Application(false);
  const path = `text-${crypto.randomUUID()}`;
  await app.dispatch({
    name: 'project.create',
    payload: { path, name: 'Text plans' },
  });
  try {
    const sheets = await app.importBytes(
      { name: 'Text plans.pdf', data: sheetTextPdf() },
      app.observe(),
    );
    const firstSheet = sheets[0];
    if (!firstSheet) throw new Error('Missing fixture sheet');
    const projectNames = () => {
      if (!app.project) throw new Error('Fixture project closed');
      return Object.values(app.project.sheets).map((sheet) => sheet.name);
    };
    const call = (name: string, payload = {}, mutation = false) =>
      dispatchCli(
        app,
        [name],
        JSON.stringify({
          payload,
          projectId: app.project?.id,
          ...(mutation ? app.observe() : {}),
        }),
      );
    const before = app.observe();
    const help = await call('help', { command: 'sheet.text.prefetch' });
    const started = await call('sheet.text.prefetch');
    const immediate = await call('sheet.text', { limit: 4 });
    for (
      let i = 0;
      i < 500 &&
      app.textPrefetch.status(sheets).queued +
        app.textPrefetch.status(sheets).reading;
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const result = await call('sheet.text', { limit: 4 });
    const status = app.textPrefetch.status(sheets);
    const repeated = await call('sheet.text', { offset: 1, limit: 1 });
    const invalid = await call('sheet.text', { limit: 21 });
    const unknown = await call('sheet.text', { sheetIds: ['__proto__'] });
    const duplicate = await call('sheet.text.prefetch', {
      sheetIds: [firstSheet.id, firstSheet.id],
    });
    const oldNames = sheets.map((sheet) => sheet.name);
    const renamed = await call(
      'sheet.renameMany',
      {
        sheets: sheets.slice(0, 2).map((sheet, index) => ({
          id: sheet.id,
          name: index
            ? 'S201 · STRUCTURAL PLAN'
            : 'A101 · NORTH WING FLOOR PLAN',
        })),
      },
      true,
    );
    const names = projectNames();
    const stale = await dispatchCli(
      app,
      ['sheet.renameMany'],
      JSON.stringify({
        ...before,
        payload: { sheets: [{ id: firstSheet.id, name: 'Stale' }] },
      }),
    );
    await call('history.undo', {}, true);
    const undone = projectNames();
    const cacheAfterRename = app.textPrefetch.status(sheets);
    await call('project.close', {}, true);
    const cleared = app.textPrefetch.status(sheets);
    await app.dispatch({ name: 'project.open', payload: { path } });
    const reopened = app.textPrefetch.status(sheets);
    await call('sheet.text.prefetch');
    const cancelled = await call('sheet.text.cancel');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const afterCancel = app.textPrefetch.status(sheets);
    return {
      before,
      immediate,
      help,
      started,
      result,
      status,
      repeated,
      invalid,
      unknown,
      duplicate,
      renamed,
      stale,
      oldNames,
      names,
      undone,
      cacheAfterRename,
      cleared,
      reopened,
      cancelled,
      afterCancel,
    };
  } finally {
    if (app.project)
      await app.dispatch({ name: 'project.close', ...app.observe() });
  }
}
declare global {
  interface Window {
    sheetTextWorkflow: typeof run;
  }
}
window.sheetTextWorkflow = run;
