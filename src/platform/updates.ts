import { invoke, isTauri } from '@tauri-apps/api/core';
import { encodeBase64 } from './base64';
import type { NativeInvoke } from './storage';

export interface WebManifest {
  version: string;
  bridgeVersion: number;
  files: { path: string; url?: string; sha256: string; size?: number }[];
}
interface CacheInfo {
  bridgeVersion: number;
  activeVersion: string;
  cachedVersions: string[];
}

function manifest(value: unknown): WebManifest {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid web manifest');
  const candidate = value as Partial<WebManifest>;
  if (
    typeof candidate.version !== 'string' ||
    !/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(candidate.version) ||
    !Number.isInteger(candidate.bridgeVersion) ||
    !Array.isArray(candidate.files)
  )
    throw new Error('Invalid web manifest');
  const paths = new Set<string>();
  for (const entry of candidate.files as unknown[]) {
    if (!entry || typeof entry !== 'object')
      throw new Error('Invalid web bundle file');
    const file = entry as Partial<WebManifest['files'][number]>;
    if (
      typeof file.path !== 'string' ||
      file.path
        .split('/')
        .some((part) => !part || part === '.' || part === '..') ||
      /[\\:?#%]/.test(file.path) ||
      paths.has(file.path) ||
      typeof file.sha256 !== 'string' ||
      !/^[a-fA-F0-9]{64}$/.test(file.sha256) ||
      (file.url !== undefined && typeof file.url !== 'string') ||
      (file.size !== undefined &&
        (!Number.isSafeInteger(file.size) || file.size < 0))
    )
      throw new Error('Invalid web bundle file');
    paths.add(file.path);
  }
  if (!paths.has('index.html'))
    throw new Error('Web bundle must include index.html');
  return candidate as WebManifest;
}

/** Downloads the whole manifest before making any native cache change. */
export async function stageWebUpdate(
  manifestUrl: string,
  call: NativeInvoke,
  fetchFile: typeof fetch = fetch,
): Promise<string> {
  const info = await call<CacheInfo>('cache_info');
  const response = await fetchFile(manifestUrl);
  if (!response.ok)
    throw new Error(`Manifest download failed: ${String(response.status)}`);
  const release = manifest(await response.json());
  if (release.bridgeVersion !== info.bridgeVersion)
    throw new Error(
      'This web release requires a different native bridge version',
    );
  const base = response.url || manifestUrl;
  const files: { path: string; data: string }[] = [];
  for (const file of release.files) {
    const downloaded = await fetchFile(new URL(file.url ?? file.path, base));
    if (!downloaded.ok)
      throw new Error(
        `Download failed for ${file.path}: ${String(downloaded.status)}`,
      );
    const bytes = await downloaded.arrayBuffer();
    if (file.size !== undefined && bytes.byteLength !== file.size)
      throw new Error(`Size mismatch for ${file.path}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hash = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    if (hash !== file.sha256.toLowerCase())
      throw new Error(`SHA-256 mismatch for ${file.path}`);
    files.push({ path: file.path, data: encodeBase64(new Uint8Array(bytes)) });
  }
  await call('cache_stage', { version: release.version, files });
  return release.version;
}
export async function installWebUpdate(manifestUrl: string): Promise<string> {
  if (!isTauri()) throw new Error('Web updates require the native application');
  return stageWebUpdate(manifestUrl, invoke);
}
/** Native bridge rejects activation while a project database is open. */
export async function activateWebUpdate(version: string): Promise<void> {
  if (!isTauri()) throw new Error('Web updates require the native application');
  await invoke('cache_activate', { version });
}
