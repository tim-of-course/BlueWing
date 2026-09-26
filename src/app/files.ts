import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { encodeBase64 } from '../platform/base64';
import { readNativeChunks } from '../platform/native-bytes';
import type { Asset } from '../platform/storage-model';
export type ImportedFile = Omit<Asset, 'id'>;
export async function readNativeFile(path: string): Promise<ImportedFile> {
  const file = await invoke<{ token: string; name: string; length: number }>(
    'file_snapshot_open',
    {
      path,
    },
  );
  try {
    const data = await readNativeChunks(file.length, (offset, length) =>
      invoke('file_snapshot_read', { token: file.token, offset, length }),
    );
    return {
      name: file.name,
      data,
      nativeSource: { token: file.token, length: file.length },
    };
  } catch (error) {
    await releaseNativeFile({ nativeSource: file });
    throw error;
  }
}
export async function releaseNativeFile(
  file: Pick<ImportedFile, 'nativeSource'>,
): Promise<void> {
  if (file.nativeSource) {
    // Cleanup cannot turn an already committed save into a reported failure.
    // Closing the native database also releases any remaining temporary files.
    await invoke('file_snapshot_release', {
      token: file.nativeSource.token,
    }).catch(() => undefined);
  }
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
export async function choosePdf(native: boolean): Promise<ImportedFile | null> {
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
