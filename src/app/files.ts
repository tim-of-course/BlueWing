import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { encodeBase64 } from '../platform/base64';
import { nativeRange } from '../platform/native-bytes';
import type { Asset, AssetRange } from '../platform/storage-model';
import type { NativeInvoke } from '../platform/storage';
export type ImportedFile = Omit<Asset, 'id'>;
export type ImportedFileReader = {
  name: string;
  read: () => Promise<ImportedFile>;
};

export function pdfPathReaders(paths: string[]): ImportedFileReader[] {
  return paths
    .filter((path) => /\.pdf$/i.test(path))
    .map((path) => ({
      name: path.split(/[\\/]/).pop() ?? path,
      read: () => readNativeFile(path),
    }));
}

export function pdfFileReaders(files: File[]): ImportedFileReader[] {
  return files
    .filter(
      (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',
    )
    .map((file) => ({
      name: file.name,
      read: async () => ({
        name: file.name,
        data: new Uint8Array(await file.arrayBuffer()),
      }),
    }));
}
export async function readNativeFile(
  path: string,
  call: NativeInvoke = invoke,
): Promise<ImportedFile> {
  const file = await call<{ token: string; name: string; length: number }>(
    'file_snapshot_open',
    {
      path,
    },
  );
  return {
    name: file.name,
    data: new Uint8Array(),
    nativeSource: { token: file.token, length: file.length },
  };
}
export function nativeFileSource(
  source: NonNullable<ImportedFile['nativeSource']>,
  call: NativeInvoke = invoke,
): AssetRange {
  return nativeRange(source.length, (offset, length) =>
    call('file_snapshot_read', { token: source.token, offset, length }),
  );
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
export async function choosePdf(
  native: boolean,
): Promise<ImportedFileReader[]> {
  if (native) {
    const path = await open({
      title: 'Import PDF plans',
      multiple: true,
      directory: false,
      filters: [{ name: 'PDF plans', extensions: ['pdf'] }],
    });
    return pdfPathReaders(path ?? []);
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,application/pdf';
    input.multiple = true;
    input.style.display = 'none';
    document.body.append(input);
    input.addEventListener(
      'cancel',
      () => {
        input.remove();
        resolve([]);
      },
      { once: true },
    );
    input.addEventListener(
      'change',
      () => {
        const files = Array.from(input.files ?? []);
        input.remove();
        resolve(pdfFileReaders(files));
      },
      { once: true },
    );
    input.click();
  });
}
/** Handoff files are viewed in memory and never staged as project assets. */
export async function chooseHandoff(
  native: boolean,
): Promise<{ name: string; html: string } | null> {
  if (native) {
    const path = await open({
      title: 'Open handoff document',
      multiple: false,
      directory: false,
      filters: [{ name: 'HTML document', extensions: ['html', 'htm'] }],
    });
    if (!path) return null;
    const file = await readNativeFile(path);
    try {
      const source = file.nativeSource;
      if (!source) throw new Error('HTML file snapshot is unavailable');
      const bytes = await nativeFileSource(source).read(0, source.length);
      return { name: file.name, html: new TextDecoder().decode(bytes) };
    } finally {
      await releaseNativeFile(file);
    }
  }
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm,text/html';
    input.hidden = true;
    document.body.append(input);
    const finish = () => {
      const selected = input.files?.[0] ?? null;
      input.remove();
      resolve(selected);
    };
    input.addEventListener('cancel', finish, { once: true });
    input.addEventListener('change', finish, { once: true });
    input.click();
  });
  return file ? { name: file.name, html: await file.text() } : null;
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
