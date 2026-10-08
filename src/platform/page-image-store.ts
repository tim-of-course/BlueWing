import { invoke } from '@tauri-apps/api/core';
import type { PageImageStore } from '../pdf/page-images';

async function digest(key: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Derived images never enter the project database or travel alongside its file. */
export function pageImageStore(native: boolean): PageImageStore | undefined {
  if (native)
    return {
      async read(key) {
        const data = new Uint8Array(
          await invoke<ArrayBuffer | number[]>('page_cache_read', {
            key: await digest(key),
          }),
        );
        return data.length ? data : null;
      },
      async write(key, bytes) {
        await invoke('page_cache_write', bytes, {
          headers: { 'x-bluewing-page-cache-key': await digest(key) },
        });
      },
      async exists(key) {
        return invoke<boolean>('page_cache_exists', { key: await digest(key) });
      },
    };
  if (typeof caches === 'undefined') return undefined;
  const cache = () => caches.open('bluewing-page-images-v1');
  const url = async (key: string) =>
    new URL(`/__bluewing_page_images/${await digest(key)}`, location.origin)
      .href;
  return {
    async read(key) {
      const response = await (await cache()).match(await url(key));
      return response ? new Uint8Array(await response.arrayBuffer()) : null;
    },
    async write(key, bytes) {
      await (
        await cache()
      ).put(
        await url(key),
        new Response(bytes.slice().buffer, {
          headers: { 'Content-Type': 'image/png' },
        }),
      );
    },
    async exists(key) {
      return !!(await (await cache()).match(await url(key)));
    },
  };
}
