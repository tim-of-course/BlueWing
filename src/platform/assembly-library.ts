import { invoke } from '@tauri-apps/api/core';
import {
  createLibrary,
  starterAssemblies,
  validateLibrary,
} from '../core/assemblies';
import { validateAssembly } from '../core/commands';
import type { Assembly, AssemblyLibrary } from '../core/types';

export interface LibraryStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}
export function libraryStorage(native: boolean): LibraryStorage {
  return native
    ? {
        read: () =>
          invoke<string | null>('app_data_read', { key: 'assemblies-v2.json' }),
        write: (data) =>
          invoke('app_data_write', { key: 'assemblies-v2.json', data }),
      }
    : {
        read: () =>
          Promise.resolve(localStorage.getItem('bluewing.assemblies.v2')),
        write: (data) => {
          localStorage.setItem('bluewing.assemblies.v2', data);
          return Promise.resolve();
        },
      };
}
/** The application serializes these operations along with desktop commands. */
export class AssemblyLibraryStore {
  constructor(private readonly storage: LibraryStorage) {}
  async read(): Promise<AssemblyLibrary> {
    const text = await this.storage.read();
    const library: unknown = text === null ? createLibrary() : JSON.parse(text);
    validateLibrary(library);
    return library;
  }
  async save(
    expectedRevision: number,
    assembly: Assembly | string,
  ): Promise<AssemblyLibrary> {
    const library = await this.read();
    if (library.revision !== expectedRevision)
      throw new Error(
        'Assembly library changed. Refresh the library and retry.',
      );
    if (typeof assembly === 'string') {
      if (!Object.hasOwn(library.assemblies, assembly))
        throw new Error('Library assembly not found');
      Reflect.deleteProperty(library.assemblies, assembly);
    } else {
      validateAssembly(assembly);
      library.assemblies[assembly.id] = structuredClone(assembly);
    }
    library.revision++;
    await this.storage.write(JSON.stringify(library));
    return library;
  }
  async addStarters(expectedRevision: number): Promise<AssemblyLibrary> {
    const library = await this.read();
    if (library.revision !== expectedRevision)
      throw new Error(
        'Assembly library changed. Refresh the library and retry.',
      );
    const missing = Object.values(starterAssemblies()).filter(
      (assembly) => !Object.hasOwn(library.assemblies, assembly.id),
    );
    if (!missing.length) return library;
    for (const assembly of missing) library.assemblies[assembly.id] = assembly;
    library.revision++;
    await this.storage.write(JSON.stringify(library));
    return library;
  }
}
