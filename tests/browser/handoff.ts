import { expect, type Page } from '@playwright/test';

export async function openHandoff(page: Page, html: string) {
  const choosing = page.waitForEvent('filechooser');
  await page
    .getByRole('button', { name: 'Open handoff document', exact: true })
    .click();
  await (
    await choosing
  ).setFiles({
    name: 'job-handoff.html',
    mimeType: 'text/html',
    buffer: Buffer.from(html),
  });
  await expect(
    page.getByRole('dialog', { name: 'job-handoff.html' }),
  ).toBeVisible();
}

export async function handoffWorkflow(page: Page) {
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    return canvas.toDataURL('image/png');
  });
  const network: string[] = [];
  await page.route('https://handoff.invalid/**', (route) => {
    network.push(route.request().url());
    return route.abort();
  });
  await openHandoff(
    page,
    `<!doctype html><html><head>
    <script type="application/json" id="bluewing-handoff">{"draft":true}</script>
    <style>body { color: rgb(12, 34, 56); }</style></head><body>
    <h1>Standalone handoff</h1><a href="#evidence">Evidence</a>
    <button onclick="document.querySelector('details').open = true">Expand evidence</button>
    <details id="evidence"><summary>Source evidence</summary><p>Ceiling height: 10 ft</p>
    <img alt="Embedded source" src="${image}"></details>
    <img alt="External source" src="https://handoff.invalid/external.png">
    <p id="isolation"></p><script>
      let isolated = false;
      try { parent.document.body.dataset.handoffEscape = 'unsafe'; } catch { isolated = true; }
      document.querySelector('#isolation').textContent = isolated && !window.__TAURI_INTERNALS__ ? 'Isolated' : 'Unsafe';
      fetch('https://handoff.invalid/probe').catch(() => {});
    </script></body></html>`,
  );
  const dialog = page.getByRole('dialog', { name: 'job-handoff.html' });
  await expect(dialog.getByRole('status')).toHaveText('Draft');
  await expect(dialog.locator('iframe')).toHaveAttribute(
    'sandbox',
    'allow-scripts',
  );
  const frame = page.frameLocator('iframe[title="Handoff document"]');
  await expect(frame.getByText('Isolated', { exact: true })).toBeVisible();
  await expect(frame.locator('body')).toHaveCSS('color', 'rgb(12, 34, 56)');
  await frame.getByRole('button', { name: 'Expand evidence' }).click();
  await expect(frame.getByText('Ceiling height: 10 ft')).toBeVisible();
  await frame.getByRole('link', { name: 'Evidence', exact: true }).click();
  await expect(frame.locator('details')).toHaveAttribute('open', '');
  await expect
    .poll(() =>
      frame
        .getByAltText('Embedded source')
        .evaluate((img) => (img as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  expect(network).toEqual([]);
  expect(
    await page.locator('body').getAttribute('data-handoff-escape'),
  ).toBeNull();
  await dialog.getByRole('button', { name: 'Close handoff document' }).click();
  await expect(dialog).toBeHidden();
  for (const [metadata, status] of [
    ['{"draft":false}', 'Complete'],
    ['{"draft":"true"}', 'Status not supplied'],
    ['{broken', 'Status not supplied'],
  ] as const) {
    await openHandoff(
      page,
      `<script type="application/json" id="bluewing-handoff">${metadata}</script><h1>Still readable</h1>`,
    );
    await expect(dialog.getByRole('status')).toHaveText(status);
    await expect(
      frame.getByRole('heading', { name: 'Still readable' }),
    ).toBeVisible();
    await dialog
      .getByRole('button', { name: 'Close handoff document' })
      .click();
  }
  await openHandoff(page, '<h1>No metadata</h1>');
  await expect(dialog.getByRole('status')).toHaveText('Status not supplied');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

export async function storedProject(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('bluewing-development');
      opening.onsuccess = () => {
        resolve(opening.result);
      };
      opening.onerror = () => {
        reject(opening.error ?? new Error('Database unavailable'));
      };
    });
    try {
      return await Promise.all(
        ['projects', 'records'].map(
          (name) =>
            new Promise<unknown>((resolve, reject) => {
              const request = database
                .transaction(name)
                .objectStore(name)
                .getAll();
              request.onsuccess = () => {
                resolve(request.result);
              };
              request.onerror = () => {
                reject(request.error ?? new Error('Read failed'));
              };
            }),
        ),
      );
    } finally {
      database.close();
    }
  });
}
