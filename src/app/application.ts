import { takeoffProject, mainId, requireTakeoff } from '../core/takeoffs';
import { calculateSnapshot } from '../core/calculation-state';
import { invoke } from '@tauri-apps/api/core';
import {
  createProject,
  ProjectSession,
  ProjectConflictError,
  validatePayload,
} from '../core';
import { copyAssembly } from '../core/assemblies';
import { estiMakerTakeoff } from '../core/quantity-presentation';
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
import type { AssetRange } from '../platform/storage-model';
import { resolveConstruction } from '../core/applied-assemblies';
import {
  buildConstructionScene,
  constructionSceneInput,
  defaultCamera,
  fitCamera,
  viewPresets,
  type DisplayMode,
  type Point3,
  type ViewPreset,
} from '../three/scene';
import { activateWebUpdate, installWebUpdate } from '../platform/updates';
import { PdfDocuments } from '../pdf/documents';
import { TextPrefetch } from '../pdf/text-prefetch';
import { pageNamingInstructions } from './page-naming';
import { PageImages, PAGE_RENDERER_VERSION } from '../pdf/page-images';
import { pageImageStore } from '../platform/page-image-store';
import {
  readNativeFile,
  releaseNativeFile,
  nativeFileSource,
  writeOutput,
} from './files';
import type { ImportedFile } from './files';
import { applicationCommands, registry } from './registry';
import { renderImage, type RenderOptions } from './render';
import { Messaging, type Attachment } from './messaging';
import {
  cliIntroduction,
  type CliConnection,
  type ConversationMode,
} from './cli-guide';
import { messagingStorage } from '../platform/messaging-storage';
import type { WingmanPresentation } from './wingman-types';
import type { PlanSnippet } from '../core/review';
import type { acquireConstructionSnapshot } from '../three/renderer';
import { PerformanceRecorder } from '../performance/recorder';

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
  takeoff?: Pick<Project['takeoffs'][string], 'id' | 'name' | 'kind'>;
  data: unknown;
  projectId: string | null;
  revision: number | null;
}

export class Application {
  readonly performance = new PerformanceRecorder();
  readonly messaging: Messaging;
  cliConnection: CliConnection | null = null;
  presentation?: WingmanPresentation | undefined;
  readonly storage;
  readonly pdf;
  readonly textPrefetch;
  readonly pageImages;
  readonly libraryStore;
  library: AssemblyLibrary | null = null;
  session: ProjectSession | null = null;
  draftPending = false;
  activeTakeoffId: string | null = null;
  selectTakeoff(id: string): void {
    if (!this.session) throw new Error('Open a project first');
    if (this.draftPending)
      throw new Error(
        'Finish or cancel the current input before switching takeoffs',
      );
    requireTakeoff(this.session.project, id);
    this.activeTakeoffId = id;
    this.disposeConstructionRenderer();
    this.publish();
  }
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private constructionRenderer: ReturnType<
    typeof acquireConstructionSnapshot
  > | null = null;
  private constructionRendererEpoch = 0;

  constructor(readonly native: boolean) {
    this.messaging = new Messaging(messagingStorage(native));
    this.storage = createStorage(native);
    this.libraryStore = new AssemblyLibraryStore(libraryStorage(native));
    this.pdf = new PdfDocuments(
      (id) =>
        this.storage instanceof NativeStorage
          ? this.storage.openAsset(id)
          : this.storage.readAsset(id),
      this.performance,
    );
    this.textPrefetch = new TextPrefetch((sheet, signal) =>
      this.pdf.text(sheet, signal),
    );
    this.pageImages = new PageImages(
      (sheet, dimension, signal, paused, priority) =>
        this.pdf.raster(sheet, dimension, signal, paused, priority),
      pageImageStore(native),
      undefined,
      undefined,
      this.performance,
    );
  }
  get project(): Project | null {
    const project = this.session?.project;
    if (!project) return null;
    const id = this.activeTakeoffId ?? mainId(project);
    return takeoffProject(project, project.takeoffs[id] ? id : mainId(project));
  }
  private projectFor(id?: string): Project | null {
    const project = this.session?.project;
    return project && id ? takeoffProject(project, id) : this.project;
  }
  calculate() {
    if (!this.session) throw new Error('Open or create a project first');
    const project = this.project;
    if (!project) throw new Error('Open a project first');
    return this.session.calculationFor(project.takeoffId ?? mainId(project));
  }
  observe(): Observation {
    const observation = this.session?.observation;
    if (!observation) throw new Error('Open or create a project first');
    return observation;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  setCliConnection(connection: CliConnection): void {
    this.cliConnection = connection;
    this.publish();
  }
  disposeConstructionRenderer(): void {
    this.constructionRendererEpoch++;
    this.constructionRenderer?.dispose();
    this.constructionRenderer = null;
  }
  private publish() {
    this.listeners.forEach((listener) => {
      listener();
    });
  }
  private attach(project: Project) {
    this.textPrefetch.clear();
    this.activeTakeoffId = mainId(project);
    this.session = new ProjectSession(project, this.storage);
    this.session.subscribe((accepted) => {
      if (!this.activeTakeoffId || !accepted.takeoffs[this.activeTakeoffId]) {
        this.activeTakeoffId = mainId(accepted);
        this.disposeConstructionRenderer();
      }
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
    const observation = this.observe();
    if (
      request.projectId !== observation.projectId ||
      request.expectedRevision !== observation.expectedRevision
    )
      throw new ProjectConflictError(
        observation.projectId,
        observation.expectedRevision,
      );
  }
  dispatch(submitted: ApplicationRequest): Promise<ApplicationResult> {
    const request = structuredClone(submitted);
    if (request.name.startsWith('performance.')) {
      // A recording can stop/export while a long render or import is still queued.
      const run = () => this.dispatchPerformance(request);
      return request.origin === 'cli'
        ? this.messaging.scheduleCli((operation) => operation(), run)
        : run();
    }
    if (
      request.name === 'messages.read' ||
      request.name === 'messages.send' ||
      request.name === 'messages.wait'
    )
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
        throw new Error(`Unknown command ${request.name}. Use bluewing help.`);
      validatePayload(definition.schema, request.payload ?? {});
      const isApplication = applicationCommands.some(
        (entry) => entry.name === request.name,
      );
      if (
        definition.mutates &&
        this.session &&
        !request.name.startsWith('library.')
      )
        this.check(request);
      const scoped =
        !/^(project\.|takeoff\.(list|create|rename|delete)$|sheet\.(put|delete|naming\.)|library\.|messages\.|performance\.|wingman\.|help$|connect$|commands\.list$|history\.|web\.)/.test(
          request.name,
        ) ||
        (request.name === 'sheet.put' &&
          typeof request.payload === 'object' &&
          request.payload !== null &&
          'calibration' in request.payload);
      if (scoped && request.origin === 'cli' && !request.takeoffId)
        throw new Error('Explicit takeoffId is required for takeoff commands');
      if (scoped && this.session) {
        if (
          request.projectId !== undefined &&
          request.projectId !== this.session.observation.projectId
        )
          throw new Error('The requested project is no longer open');
        request.takeoffId ??=
          this.activeTakeoffId ?? mainId(this.session.project);
        requireTakeoff(this.session.project, request.takeoffId);
      }

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
              takeoffId:
                'required for takeoff reads, edits, batch, preview and renders; use takeoff.list',
              projectId: 'required for active project mutations',
              expectedRevision: 'required for active project mutations',
            },
            coordinates:
              'Rotated PDF viewport at scale 1; top-left origin, x right, y down.',
            imageLimit: 4096,
            modelImageLimit: 8192,
          },
        };
      else if (!isApplication) {
        if (!this.session) throw new Error('Open or create a project first');
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
              quantityChanges: result.quantityChanges,
            }
          : result.data;
      } else
        switch (request.name) {
          case 'sheet.naming.start':
          case 'sheet.naming.read':
          case 'sheet.naming.cancel': {
            const project = this.projectFor(request.takeoffId);
            if (!project) throw new Error('Open or create a project first');
            if (
              request.projectId !== undefined &&
              request.projectId !== project.id
            )
              throw new Error('The requested project is no longer open');
            const ids = payload.sheetIds as string[] | undefined;
            if (ids && new Set(ids).size !== ids.length)
              throw new Error('Duplicate sheet IDs');
            const sheets = ids
              ? ids.map((id) => {
                  const sheet = project.sheets[id];
                  if (!sheet || !Object.hasOwn(project.sheets, id))
                    throw new Error(`Unknown sheet ${id}`);
                  return sheet;
                })
              : Object.values(project.sheets).sort(
                  (a, b) => (a.order ?? a.pageIndex) - (b.order ?? b.pageIndex),
                );
            if (request.name === 'sheet.naming.cancel') {
              this.textPrefetch.cancel();
              data = this.textPrefetch.status(sheets);
            } else if (request.name === 'sheet.naming.start') {
              if (sheets.length > 2000)
                throw new Error('Prefetch at most 2000 sheetIds at a time');
              data = {
                workflow: 'page-naming',
                instructions: pageNamingInstructions,
                ...this.textPrefetch.prefetch(sheets),
                next: {
                  command: 'sheet.naming.read',
                  payload: { offset: 0, limit: 5 },
                },
              };
            } else {
              const offset = (payload.offset as number | undefined) ?? 0;
              const limit = (payload.limit as number | undefined) ?? 5;
              if (
                !Number.isSafeInteger(offset) ||
                !Number.isSafeInteger(limit) ||
                limit > 20
              )
                throw new Error(
                  'offset must be an integer and limit must be an integer from 1 to 20',
                );
              const end = Math.min(sheets.length, offset + limit);
              data = {
                ...this.textPrefetch.status(sheets),
                offset,
                nextOffset: end < sheets.length ? end : null,
                sheets: sheets
                  .slice(offset, end)
                  .map((sheet) => this.textPrefetch.get(sheet)),
              };
            }
            break;
          }
          case 'help': {
            const command = payload.command as string | undefined;
            if (command) {
              const found = registry.find((entry) => entry.name === command);
              if (!found)
                throw new Error(
                  `Unknown command ${command}. Use bluewing help.`,
                );
              data = found;
            } else data = cliIntroduction(this.projectFor(request.takeoffId));
            break;
          }
          case 'connect':
            if (
              request.projectId !== undefined &&
              request.projectId !== this.session?.observation.projectId
            )
              throw new Error(
                'Connection project does not match the open project. Copy a new prompt from Wingman.',
              );
            data = cliIntroduction(
              this.projectFor(request.takeoffId),
              (payload.mode as ConversationMode | undefined) ?? 'chat',
            );
            break;
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
            if (!(this.storage instanceof NativeStorage) || !this.session)
              throw new Error('File backups require an open desktop project');
            data = {
              path: await this.storage.backup(
                payload.path as string | undefined,
              ),
            };
            break;
          case 'quantities.exportEstiMaker': {
            const project = this.projectFor(request.takeoffId);
            if (!project) throw new Error('Open or create a project first');
            if (
              request.projectId !== undefined &&
              request.projectId !== project.id
            )
              throw new Error('The requested project is no longer open');
            const path = payload.path as string | undefined;
            if (
              (request.origin === 'cli' && !path?.trim()) ||
              (path !== undefined && !path.trim())
            )
              throw new Error(
                'Supply an explicit output path for the EstiMaker export',
              );
            const calculation = this.session?.calculationFor(
              project.takeoffId ?? mainId(project),
            );
            if (!calculation) throw new Error('Open a project first');
            const takeoff = estiMakerTakeoff(project, calculation);
            const text = JSON.stringify(takeoff, null, 2);
            data = {
              path: await writeOutput(
                this.native,
                `${project.name}-${project.takeoffId ?? 'main'}.estimaker.json`,
                new TextEncoder().encode(text),
                path,
              ),
              text,
            };
            break;
          }
          case 'snippet.render': {
            const project = this.projectFor(request.takeoffId);
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
              `${snippet.name}-${project.takeoffId ?? 'main'}.png`,
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
            const project = this.projectFor(request.takeoffId);
            if (!project) throw new Error('Open a project first');
            if (
              payload.view !== undefined &&
              (payload.azimuth !== undefined || payload.elevation !== undefined)
            )
              throw new Error(
                'Use a named view or explicit azimuth/elevation, not both',
              );
            if (payload.zoom !== undefined && (payload.zoom as number) > 10000)
              throw new Error('3D zoom must be between 0.01 and 10000');
            if (
              payload.elevation !== undefined &&
              (payload.elevation as number) > Math.PI / 2
            )
              throw new Error(
                '3D elevation must be between -π/2 and π/2 radians',
              );
            const width = (payload.width as number | undefined) ?? 1600;
            const height = (payload.height as number | undefined) ?? 1000;
            if (width > 8192 || height > 8192)
              throw new Error(
                '3D image width and height must not exceed 8192 pixels',
              );
            if (
              payload.levelId !== undefined &&
              !project.construction?.levels[payload.levelId as string]
            )
              throw new Error('Level not found');
            const result =
              this.session?.calculationFor(project.takeoffId ?? mainId(project))
                .model ?? calculateSnapshot(project).model;
            const resolved = resolveConstruction(project);
            const scene = buildConstructionScene(
              constructionSceneInput(result),
              {
                ...(payload.levelId === undefined
                  ? {}
                  : {
                      levelGeometryIds: [
                        ...Object.values(resolved.walls),
                        ...Object.values(resolved.ceilings),
                        ...Object.values(resolved.materials ?? {}),
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
            const camera = {
              ...fitCamera(scene, {
                ...defaultCamera,
                ...(payload.view === undefined
                  ? {}
                  : viewPresets[payload.view as ViewPreset]),
                ...(payload.azimuth === undefined
                  ? {}
                  : { yaw: payload.azimuth as number }),
                ...(payload.elevation === undefined
                  ? {}
                  : { pitch: payload.elevation as number }),
              }),
              ...(payload.zoom === undefined
                ? {}
                : { zoom: payload.zoom as number }),
              ...(payload.target === undefined
                ? {}
                : { target: payload.target as Point3 }),
              ...(payload.span === undefined
                ? {}
                : { span: payload.span as number }),
            };
            const displayMode =
              (payload.displayMode as DisplayMode | undefined) ?? 'solid';
            if (!this.constructionRenderer) {
              const epoch = this.constructionRendererEpoch;
              const { acquireConstructionSnapshot } =
                await import('../three/renderer');
              if (epoch !== this.constructionRendererEpoch)
                throw new Error(
                  '3D export was cancelled because the viewer closed',
                );
              this.constructionRenderer = acquireConstructionSnapshot();
            }
            const canvas = document.createElement('canvas');
            this.constructionRenderer.render(canvas, scene, {
              width,
              height,
              pixelRatio: 1,
              camera,
              displayMode,
            });
            const labelContext = canvas.getContext('2d');
            if (labelContext) {
              labelContext.fillStyle = '#ffffff';
              labelContext.fillRect(0, canvas.height - 26, canvas.width, 26);
              labelContext.fillStyle = '#111111';
              labelContext.font = '14px sans-serif';
              labelContext.fillText(
                `${project.takeoffs[project.takeoffId ?? mainId(project)]?.name ?? ''} · ${project.takeoffId ?? 'main'} · deductions red`,
                8,
                canvas.height - 8,
                canvas.width - 16,
              );
            }
            const blob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((value) => {
                if (value) resolve(value);
                else reject(new Error('PNG encoding failed'));
              }, 'image/png');
            });
            const path = await writeOutput(
              this.native,
              `construction-${project.takeoffId ?? 'main'}.png`,
              new Uint8Array(await blob.arrayBuffer()),
              payload.path as string,
            );
            data = {
              path,
              width: canvas.width,
              height: canvas.height,
              revision: project.revision,
              camera,
              projectId: project.id,
              takeoffId: project.takeoffId,
              takeoffName:
                project.takeoffs[project.takeoffId ?? mainId(project)]?.name,
              takeoffKind:
                project.takeoffs[project.takeoffId ?? mainId(project)]?.kind,
              contributionDirections: Object.fromEntries(
                Object.values(project.assignments).map((a) => [
                  a.id,
                  a.direction ?? 'add',
                ]),
              ),
              displayMode,
              complete: result.complete,
              diagnostics: result.diagnostics,
              displayedObjects:
                scene.members.length +
                (displayMode === 'framing' ? 0 : scene.surfaces.length),
              omittedObjects: scene.omitted,
            };
            if (request.origin === 'cli')
              this.presentation?.publish({
                projectId: project.id,
                revision: project.revision,
                view: {
                  kind: '3d',
                  camera,
                  displayMode,
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
            if (this.projectFor(request.takeoffId)?.recipes[id])
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
          case 'project.close': {
            if (this.draftPending)
              throw new Error(
                'Finish or cancel the current drawing or editor draft before closing the project',
              );
            // Capture workers before UI teardown aborts its renders, then detach
            // immediately so queued previews cannot reopen PDFs during cleanup.
            this.pageImages.clear();
            this.textPrefetch.clear();
            const clearing = this.pdf.clear();
            this.session = null;
            this.disposeConstructionRenderer();
            this.publish();
            await clearing;
            await this.storage.close();
            await this.messaging.bind(null);
            data = { closed: true };
            break;
          }
          case 'project.import': {
            this.check(request);
            if (!this.native)
              throw new Error('Use the PDF file picker in browser development');
            const file = await readNativeFile(payload.path as string);
            data = await this.importNow(file, request);
            break;
          }
          case 'sheet.render': {
            const project = this.projectFor(request.takeoffId);
            if (!project) throw new Error('Open a project first');
            const rendered = await renderImage(
              project,
              this.pdf,
              payload as unknown as RenderOptions,
            );
            const path = await writeOutput(
              this.native,
              `sheet-${project.takeoffId ?? 'main'}.png`,
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
      const observation = this.session?.observation;
      const contextTakeoff =
        scoped && request.takeoffId
          ? this.session?.project.takeoffs[request.takeoffId]
          : undefined;
      return {
        data,
        ...(contextTakeoff
          ? {
              takeoff: {
                id: contextTakeoff.id,
                name: contextTakeoff.name,
                kind: contextTakeoff.kind,
              },
            }
          : {}),
        projectId: observation?.projectId ?? null,
        revision: observation?.expectedRevision ?? null,
      };
    });
  }

  private async dispatchPerformance(
    request: ApplicationRequest,
  ): Promise<ApplicationResult> {
    const definition = applicationCommands.find(
      (entry) => entry.name === request.name,
    );
    if (!definition) throw new Error(`Unknown command ${request.name}`);
    validatePayload(definition.schema, request.payload ?? {});
    const payload = (request.payload ?? {}) as Record<string, unknown>;
    let data: unknown;
    switch (request.name) {
      case 'performance.start':
        this.performance.attachBrowser();
        data = this.performance.start({
          native: this.native,
          development: import.meta.env.DEV,
          hardwareConcurrency: navigator.hardwareConcurrency,
          sheetCount: Object.keys(this.project?.sheets ?? {}).length,
          rendererVersion: PAGE_RENDERER_VERSION,
        });
        break;
      case 'performance.status':
        data = {
          ...this.performance.status(),
          preparation: this.pageImages.status(),
        };
        break;
      case 'performance.stop':
        data = this.performance.stop();
        break;
      case 'performance.export':
        data = {
          path: await writeOutput(
            this.native,
            'bluewing-performance.json',
            new TextEncoder().encode(
              JSON.stringify(this.performance.report(), null, 2),
            ),
            payload.path as string | undefined,
          ),
        };
        break;
      default:
        throw new Error(`Unknown performance command ${request.name}`);
    }
    return {
      data,
      projectId: this.project?.id ?? null,
      revision: this.project?.revision ?? null,
    };
  }

  private async dispatchMessage(
    request: ApplicationRequest,
  ): Promise<ApplicationResult> {
    const definition = registry.find((entry) => entry.name === request.name);
    if (!definition) throw new Error('Unknown messaging command');
    validatePayload(definition.schema, request.payload ?? {});
    if (
      request.projectId !== undefined &&
      request.projectId !== this.session?.observation.projectId
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
    if (
      payload.timeoutMs !== undefined &&
      !Number.isSafeInteger(payload.timeoutMs)
    )
      throw new Error('timeoutMs must be a nonnegative integer');
    if (request.name === 'messages.wait') {
      const revision = this.session?.observation.expectedRevision ?? null;
      const data = await this.messaging.wait(
        (payload.after as number | undefined) ?? request.messagesAfter ?? 0,
        (payload.timeoutMs as number | undefined) ?? 25000,
        payload.waitToken as string | undefined,
      );
      return { data, projectId: data.projectId, revision };
    }
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
    const observation = this.session?.observation;
    return {
      data,
      projectId: observation?.projectId ?? null,
      revision: observation?.expectedRevision ?? null,
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
    const finish = this.performance.span('project.pdf.import', {
      bytes: file.nativeSource?.length ?? file.data.byteLength,
    });
    try {
      this.check(request);
      const session = this.session;
      if (!session) throw new Error('Open a project first');
      this.storage.stageAsset({ id, ...file });
      let source: Uint8Array | AssetRange = file.data;
      let saved = false;
      if (file.nativeSource && this.storage instanceof NativeStorage) {
        const snapshot = nativeFileSource(file.nativeSource);
        const storage = this.storage;
        let stored: Promise<AssetRange> | undefined;
        source = {
          length: snapshot.length,
          read: (offset, length) =>
            saved
              ? (stored ??= storage.openAsset(id)).then((asset) =>
                  asset.read(offset, length),
                )
              : snapshot.read(offset, length),
          close: async () => {
            if (stored) await (await stored).close?.();
          },
        };
      }
      const sheets = await this.pdf.import(id, file.name, source);
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
      // Import has finished all snapshot reads. Keep its parsed document; any
      // later missing ranges come from the identical committed asset. Publish
      // happens only after dispatch saves, so viewers cannot read it too early.
      saved = true;
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
      finish();
    }
  }
}
