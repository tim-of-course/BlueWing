import { calculateProject } from '../core/calculations';
import { quantityChanges } from '../core/construction-calculations';
import { invoke } from '@tauri-apps/api/core';
import {
  createProject,
  ProjectSession,
  ProjectConflictError,
  validatePayload,
} from '../core';
import { copyAssembly } from '../core/assemblies';
import {
  AssemblyLibraryStore,
  libraryStorage,
} from '../platform/assembly-library';
import type {
  Assembly,
  AssemblyLibrary,
  CommandCall,
  Project,
  Sheet,
} from '../core/types';
import { createStorage } from '../platform/storage';
import { NativeStorage } from '../platform/storage';
import { emptyConstruction, generateConstruction } from '../core/construction';
import {
  buildConstructionScene,
  constructionSceneInput,
  defaultCamera,
  renderConstruction,
} from '../three/scene';
import { activateWebUpdate, installWebUpdate } from '../platform/updates';
import { PdfDocuments } from '../pdf/documents';
import { readNativeFile, releaseNativeFile, writeOutput } from './files';
import type { ImportedFile } from './files';
import { applicationCommands, registry } from './registry';
import { renderImage, type RenderOptions } from './render';
import { Messaging, type Attachment } from './messaging';
import { messagingStorage } from '../platform/messaging-storage';
import type { WingmanPresentation } from './wingman-types';
import type { PlanSnippet } from '../core/review';

export interface Observation {
  projectId: string;
  expectedRevision: number;
}
export interface ApplicationRequest extends CommandCall {
  projectId?: string;
  expectedRevision?: number;
  origin?: string;
  messagesAfter?: number;
}
export interface ApplicationResult {
  data: unknown;
  projectId: string | null;
  revision: number | null;
}

export class Application {
  readonly messaging: Messaging;
  presentation?: WingmanPresentation | undefined;
  readonly storage;
  readonly pdf;
  readonly libraryStore;
  library: AssemblyLibrary | null = null;
  session: ProjectSession | null = null;
  draftPending = false;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(readonly native: boolean) {
    this.messaging = new Messaging(messagingStorage(native));
    this.storage = createStorage(native);
    this.libraryStore = new AssemblyLibraryStore(libraryStorage(native));
    this.pdf = new PdfDocuments((id) => this.storage.readAsset(id));
  }
  get project(): Project | null {
    return this.session?.project ?? null;
  }
  observe(): Observation {
    const project = this.project;
    if (!project) throw new Error('Open or create a project first');
    return { projectId: project.id, expectedRevision: project.revision };
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private publish() {
    this.listeners.forEach((listener) => {
      listener();
    });
  }
  private attach(project: Project) {
    this.session = new ProjectSession(project, this.storage);
    this.session.subscribe(() => {
      this.publish();
    });
    this.publish();
  }
  private schedule<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => undefined);
    return pending;
  }
  private check(request: ApplicationRequest) {
    const project = this.project;
    if (!project) throw new Error('Open or create a project first');
    if (
      request.projectId !== project.id ||
      request.expectedRevision !== project.revision
    )
      throw new ProjectConflictError(project.id, project.revision);
  }
  dispatch(submitted: ApplicationRequest): Promise<ApplicationResult> {
    const request = structuredClone(submitted);
    if (request.name === 'messages.read' || request.name === 'messages.send')
      return this.dispatchMessage(request);
    const enqueue = (operation: () => Promise<ApplicationResult>) =>
      this.schedule(operation);
    const schedule =
      request.origin === 'cli'
        ? (operation: () => Promise<ApplicationResult>) =>
            this.messaging.scheduleCli(enqueue, operation)
        : enqueue;
    return schedule(async () => {
      const definition = registry.find((entry) => entry.name === request.name);
      if (!definition)
        throw new Error(`Unknown command ${request.name}. Use commands.list.`);
      validatePayload(definition.schema, request.payload ?? {});
      const isApplication = applicationCommands.some(
        (entry) => entry.name === request.name,
      );
      if (
        definition.mutates &&
        this.project &&
        !request.name.startsWith('library.')
      )
        this.check(request);
      let data: unknown;
      const payload = (request.payload ?? {}) as Record<string, unknown>;
      if (request.name === 'commands.list')
        data = {
          commands: registry,
          protocol: {
            invocation: 'bluewing <command> <JSON request>',
            request: {
              payload: {},
              messagesAfter:
                'optional nonnegative message cursor; reads are nondestructive',
              projectId: 'required for active project mutations',
              expectedRevision: 'required for active project mutations',
            },
            coordinates:
              'Rotated PDF viewport at scale 1; top-left origin, x right, y down.',
            imageLimit: 4096,
          },
        };
      else if (!isApplication) {
        if (!this.session) throw new Error('Open or create a project first');
        const beforePreview =
          request.name === 'preview'
            ? calculateProject(this.session.project)
            : null;
        const result = await this.session.dispatch({
          ...request,
          ...this.observe(),
          ...(request.projectId === undefined
            ? {}
            : { projectId: request.projectId }),
          ...(request.expectedRevision === undefined
            ? {}
            : { expectedRevision: request.expectedRevision }),
        });
        data = result.preview
          ? {
              preview: true,
              project: result.project,
              data: result.data,
              quantityChanges: quantityChanges(
                beforePreview ?? calculateProject(this.session.project),
                calculateProject(result.project),
              ),
            }
          : result.data;
      } else
        switch (request.name) {
          case 'wingman.inspect':
            data = this.presentation?.inspect() ?? null;
            break;
          case 'wingman.flash':
            if (!this.presentation)
              throw new Error('Wingman presentation unavailable');
            this.presentation.flash();
            data = { flashed: true };
            break;
          case 'wingman.annotate':
            if (!this.presentation)
              throw new Error('Wingman presentation unavailable');
            this.presentation.annotate(
              payload.annotations as PlanSnippet['annotations'],
              payload.highlightIds as string[] | undefined,
            );
            data = { annotated: true };
            break;
          case 'project.backup':
            if (!(this.storage instanceof NativeStorage) || !this.project)
              throw new Error('File backups require an open desktop project');
            data = {
              path: await this.storage.backup(
                payload.path as string | undefined,
              ),
            };
            break;
          case 'snippet.render': {
            const project = this.project;
            const snippet = project?.review?.snippets[payload.id as string];
            if (!project || !snippet) throw new Error('Snippet not found');
            const image = await renderImage(project, this.pdf, {
              ...snippet,
              highlightIds: snippet.geometryIds,
              maxDimension:
                (payload.maxDimension as number | undefined) ?? 2048,
              label: `${project.sheets[snippet.sheetId]?.name ?? ''} · ${snippet.name}`,
            });
            const path = await writeOutput(
              this.native,
              `${snippet.name}.png`,
              image.bytes,
              payload.path as string,
            );
            data = { path, snippetId: snippet.id, ...image.metadata };
            if (request.origin === 'cli')
              this.presentation?.publish({
                projectId: project.id,
                revision: project.revision,
                view: {
                  kind: 'plan',
                  sheetId: snippet.sheetId,
                  bounds: snippet.bounds,
                  highlightIds: snippet.geometryIds,
                  annotations: snippet.annotations,
                },
                ...(payload.caption === undefined
                  ? {}
                  : { caption: payload.caption as string }),
              });
            break;
          }
          case 'construction.render': {
            const project = this.project;
            if (!project) throw new Error('Open a project first');
            if (
              payload.levelId !== undefined &&
              !project.construction?.levels[payload.levelId as string]
            )
              throw new Error('Level not found');
            const result = generateConstruction(
              project,
              project.construction ?? emptyConstruction(),
            );
            const scene = buildConstructionScene(
              constructionSceneInput(result),
              {
                ...(payload.levelId === undefined
                  ? {}
                  : {
                      levelGeometryIds: [
                        ...Object.values(project.construction?.walls ?? {}),
                        ...Object.values(project.construction?.ceilings ?? {}),
                      ]
                        .filter((source) => source.levelId === payload.levelId)
                        .map((source) => source.geometryId),
                    }),
                ...(payload.geometryIds === undefined
                  ? {}
                  : { geometryIds: payload.geometryIds as string[] }),
                ...(payload.materialId === undefined
                  ? {}
                  : { materialId: payload.materialId as string }),
                ...(payload.role === undefined
                  ? {}
                  : { role: payload.role as string }),
              },
            );
            const canvas = document.createElement('canvas');
            renderConstruction(canvas, scene, {
              width: Math.min(
                4096,
                (payload.width as number | undefined) ?? 1600,
              ),
              height: Math.min(
                4096,
                (payload.height as number | undefined) ?? 1000,
              ),
              camera: {
                ...defaultCamera,
                ...(payload.azimuth === undefined
                  ? {}
                  : { yaw: payload.azimuth as number }),
                ...(payload.elevation === undefined
                  ? {}
                  : { pitch: payload.elevation as number }),
              },
            });
            const blob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((value) => {
                if (value) resolve(value);
                else reject(new Error('PNG encoding failed'));
              }, 'image/png');
            });
            const path = await writeOutput(
              this.native,
              'construction.png',
              new Uint8Array(await blob.arrayBuffer()),
              payload.path as string,
            );
            data = {
              path,
              width: canvas.width,
              height: canvas.height,
              revision: project.revision,
              complete: result.complete,
              diagnostics: result.diagnostics,
              displayedObjects: scene.count,
              omittedObjects: scene.omitted,
            };
            if (request.origin === 'cli')
              this.presentation?.publish({
                projectId: project.id,
                revision: project.revision,
                view: {
                  kind: '3d',
                  camera: {
                    ...defaultCamera,
                    yaw:
                      (payload.azimuth as number | undefined) ??
                      defaultCamera.yaw,
                    pitch:
                      (payload.elevation as number | undefined) ??
                      defaultCamera.pitch,
                  },
                  ...(payload.geometryIds === undefined
                    ? {}
                    : { geometryIds: payload.geometryIds as string[] }),
                  ...(payload.levelId === undefined
                    ? {}
                    : { levelId: payload.levelId as string }),
                  ...(payload.materialId === undefined
                    ? {}
                    : { materialId: payload.materialId as string }),
                  ...(payload.role === undefined
                    ? {}
                    : { role: payload.role as string }),
                },
                ...(payload.caption === undefined
                  ? {}
                  : { caption: payload.caption as string }),
              });
            break;
          }
          case 'library.inspect':
            this.library = await this.libraryStore.read();
            data = structuredClone(this.library);
            this.publish();
            break;
          case 'library.put':
          case 'library.delete':
            this.library = await this.libraryStore.save(
              payload.expectedLibraryRevision as number,
              request.name === 'library.put'
                ? (payload.assembly as Assembly)
                : (payload.id as string),
            );
            data = structuredClone(this.library);
            this.publish();
            break;
          case 'library.addStarters':
            this.library = await this.libraryStore.addStarters(
              payload.expectedLibraryRevision as number,
            );
            data = structuredClone(this.library);
            this.publish();
            break;
          case 'assembly.import': {
            if (!this.session) throw new Error('Open a project first');
            const library = await this.libraryStore.read();
            const original = library.assemblies[payload.libraryId as string];
            if (!original) throw new Error('Library assembly not found');
            const id = payload.id as string;
            if (this.project?.recipes[id])
              throw new Error('Project assembly id already exists');
            const assembly = copyAssembly(original, id);
            await this.session.dispatch({
              ...request,
              name: 'assembly.put',
              payload: assembly,
              ...this.observe(),
            });
            data = assembly;
            break;
          }
          case 'project.create':
          case 'project.open': {
            if (this.session)
              throw new Error('Close the current project first');
            const path = payload.path as string;
            await this.storage.open(path, request.name === 'project.create');
            try {
              const project =
                request.name === 'project.create'
                  ? createProject(payload.name as string)
                  : await this.storage.load();
              if (request.name === 'project.create')
                await this.storage.initialize(project);
              await this.messaging.bind(project.id);
              this.attach(project);
              if (!this.native)
                localStorage.setItem('bluewing.lastProject', path);
              data = project;
            } catch (error) {
              await this.storage.close();
              throw error;
            }
            break;
          }
          case 'project.close':
            if (this.draftPending)
              throw new Error(
                'Finish or cancel the current drawing or editor draft before closing the project',
              );
            await this.storage.close();
            this.session = null;
            await this.messaging.bind(null);
            await this.pdf.clear();
            this.publish();
            data = { closed: true };
            break;
          case 'project.import': {
            this.check(request);
            if (!this.native)
              throw new Error('Use the PDF file picker in browser development');
            const file = await readNativeFile(payload.path as string);
            data = await this.importNow(file, request);
            break;
          }
          case 'sheet.render': {
            const project = this.project;
            if (!project) throw new Error('Open a project first');
            const rendered = await renderImage(
              project,
              this.pdf,
              payload as unknown as RenderOptions,
            );
            const path = await writeOutput(
              this.native,
              'sheet.png',
              rendered.bytes,
              payload.path as string,
            );
            data = { path, ...rendered.metadata };
            if (request.origin === 'cli')
              this.presentation?.publish({
                projectId: project.id,
                revision: project.revision,
                view: {
                  kind: 'plan',
                  sheetId: payload.sheetId as string,
                  bounds: rendered.metadata.bounds,
                  ...(payload.mode === undefined
                    ? {}
                    : {
                        mode: payload.mode as NonNullable<
                          RenderOptions['mode']
                        >,
                      }),
                  ...(payload.highlightIds === undefined
                    ? {}
                    : { highlightIds: payload.highlightIds as string[] }),
                },
                ...(payload.caption === undefined
                  ? {}
                  : { caption: payload.caption as string }),
              });
            break;
          }
          case 'web.inspect':
            data = this.native
              ? await invoke('cache_info')
              : {
                  bridgeVersion: 0,
                  activeVersion: 'browser-development',
                  cachedVersions: [],
                };
            break;
          case 'web.stage':
            data = {
              version: await installWebUpdate(payload.manifestUrl as string),
            };
            break;
          case 'web.activate':
            if (this.draftPending)
              throw new Error(
                'Finish or cancel the current draft before activating a web update',
              );
            if (this.session)
              throw new Error(
                'Close the project before activating a web update',
              );
            await activateWebUpdate(payload.version as string);
            data = { activated: payload.version };
            break;
          default:
            throw new Error('Unknown application command');
        }
      return {
        data,
        projectId: this.project?.id ?? null,
        revision: this.project?.revision ?? null,
      };
    });
  }

  private async dispatchMessage(
    request: ApplicationRequest,
  ): Promise<ApplicationResult> {
    const definition = registry.find((entry) => entry.name === request.name);
    if (!definition) throw new Error('Unknown messaging command');
    validatePayload(definition.schema, request.payload ?? {});
    if (
      request.projectId !== undefined &&
      request.projectId !== this.project?.id
    )
      throw new Error('Message project does not match the open project');
    const payload = (request.payload ?? {}) as Record<string, unknown>;
    if (typeof payload.waitMs === 'number' && payload.waitMs > 25000)
      throw new Error('waitMs must be at most 25000');
    if (
      typeof payload.after === 'number' &&
      !Number.isSafeInteger(payload.after)
    )
      throw new Error('after must be a nonnegative integer');
    const data =
      request.name === 'messages.send'
        ? await this.messaging.send(
            (payload.text as string | undefined) ?? '',
            (payload.attachments as Attachment[] | undefined) ?? [],
            request.origin === 'cli' ? 'agent' : 'user',
          )
        : await this.messaging.read(
            (payload.after as number | undefined) ?? request.messagesAfter ?? 0,
            (payload.waitMs as number | undefined) ?? 0,
          );
    return {
      data,
      projectId: this.project?.id ?? null,
      revision: this.project?.revision ?? null,
    };
  }

  importBytes(file: ImportedFile, observation: Observation): Promise<Sheet[]> {
    return this.schedule(() =>
      this.importNow(file, {
        name: 'project.import',
        ...observation,
        origin: 'ui',
      }),
    );
  }
  private async importNow(
    file: ImportedFile,
    request: ApplicationRequest,
  ): Promise<Sheet[]> {
    const id = crypto.randomUUID();
    try {
      this.check(request);
      const session = this.session;
      if (!session) throw new Error('Open a project first');
      this.storage.stageAsset({ id, ...file });
      const sheets = await this.pdf.import(id, file.name, file.data);
      const firstOrder =
        Math.max(
          -1,
          ...Object.values(session.project.sheets).map(
            (sheet) => sheet.order ?? sheet.pageIndex,
          ),
        ) + 1;
      sheets.forEach((sheet, index) => {
        sheet.order = firstOrder + index;
      });
      await session.dispatch({
        name: 'batch',
        payload: {
          commands: sheets.map((sheet) => ({
            name: 'sheet.put',
            payload: sheet,
          })),
        },
        ...this.observe(),
        origin: request.origin ?? 'cli',
      });
      return sheets;
    } catch (error) {
      this.storage.discardStagedAssets();
      await this.pdf.release(id).catch(() => undefined);
      throw error;
    } finally {
      await releaseNativeFile(file);
    }
  }
}
