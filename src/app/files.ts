import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { decodeBase64, encodeBase64 } from '../platform/base64';
export async function readNativeFile(
  path: string,
): Promise<{ name: string; data: Uint8Array }> {
  const file = await invoke<{ name: string; data: string }>('read_file', {
    path,
  });
  return { name: file.name, data: decodeBase64(file.data) };
}
export async function chooseProject(
  create: boolean,
  name = 'Estimate',
): Promise<string | null> {
  const filters = [{ name: 'Bluewing project', extensions: ['bluewing'] }];
  if (create)
    return save({
      title: 'Create project',
      defaultPath: `${name}.bluewing`,
      filters,
    });
  return open({
    title: 'Open project',
    multiple: false,
    directory: false,
    filters,
  });
}
export async function choosePdf(
  native: boolean,
): Promise<{ name: string; data: Uint8Array } | null> {
  if (native) {
    const path = await open({
      title: 'Import PDF plans',
      multiple: false,
      directory: false,
      filters: [{ name: 'PDF plans', extensions: ['pdf'] }],
    });
    return path ? readNativeFile(path) : null;
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,application/pdf';
    input.style.display = 'none';
    document.body.append(input);
    input.addEventListener(
      'cancel',
      () => {
        input.remove();
        resolve(null);
      },
      { once: true },
    );
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) {
          resolve(null);
          return;
        }
        void file.arrayBuffer().then((data) => {
          resolve({ name: file.name, data: new Uint8Array(data) });
        }, reject);
      },
      { once: true },
    );
    input.click();
  });
}
export async function writeOutput(
  native: boolean,
  name: string,
  data: Uint8Array,
  path?: string,
): Promise<string | null> {
  if (native) {
    const destination =
      path ?? (await save({ title: 'Export', defaultPath: name }));
    if (!destination) return null;
    await invoke('write_file', { path: destination, data: encodeBase64(data) });
    return destination;
  }
  const blob = new Blob([data.slice().buffer]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
  return name;
}
