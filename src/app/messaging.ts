import {
  validateAnnotationShape,
  type AnnotationShape,
} from '../core/annotations';
import type {
  WingmanVisual,
  ViewFrame,
  WingmanActivity,
} from './wingman-types';
import { boundActivity } from './wingman-activity';

export interface Attachment {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  path?: string;
  unavailable?: true;
}
export interface ReplyView {
  viewId: string;
  caption?: string;
  annotations?: AnnotationShape[];
}
export interface MessageView extends WingmanVisual {
  frame: ViewFrame;
  annotations: AnnotationShape[];
  image?: Attachment;
}
export interface Message {
  id: number;
  sender: 'user' | 'agent';
  text: string;
  createdAt: string;
  attachments: Attachment[];
  views?: MessageView[];
}
function wireImage({ id, name, width, height, path, unavailable }: Attachment) {
  return {
    id,
    name,
    width,
    height,
    ...(path === undefined ? {} : { path }),
    ...(unavailable ? { unavailable } : {}),
  };
}
export function wireMessage(message: Message) {
  return {
    id: message.id,
    sender: message.sender,
    text: message.text,
    createdAt: message.createdAt,
    attachments: message.attachments.map(wireImage),
    ...(message.views
      ? {
          views: message.views.map(({ image, ...view }) => ({
            ...structuredClone(view),
            ...(image ? { image: wireImage(image) } : {}),
          })),
        }
      : {}),
  };
}
type MessagingChange = 'bind' | 'message' | 'status' | 'activity';
export interface MessagingStorage {
  read(projectId: string): Promise<Message[]>;
  write(projectId: string, messages: Message[]): Promise<void>;
  readActivity(projectId: string): Promise<WingmanActivity[]>;
  writeActivity(projectId: string, entries: WingmanActivity[]): Promise<void>;
  exportAttachment(attachment: Attachment): Promise<Attachment>;
}
export interface MessageWait {
  status: 'messages' | 'timeout' | 'resumed' | 'ended' | 'project_changed';
  projectId: string | null;
  waitToken: string;
  messages: Message[];
}
export class Messaging {
  private projectId: string | null = null;
  private messages: Message[] = [];
  private history: { entries: WingmanActivity[]; replyIds: number[] } = {
    entries: [],
    replyIds: [],
  };
  private activityError: string | null = null;
  get activity(): readonly WingmanActivity[] {
    return this.history.entries;
  }
  startActivity(entry: WingmanActivity) {
    const projectId = this.projectId;
    if (!projectId) return;
    const history = this.history;
    const previous = history.entries.at(-1);
    if (previous && previous.afterMessageId >= (history.replyIds.at(-1) ?? 0))
      entry.turnStartedAt = previous.turnStartedAt ?? previous.startedAt;
    history.entries = boundActivity(
      [...history.entries, entry],
      history.replyIds,
    );
    this.publish('activity');
    return (changes: Partial<WingmanActivity>) =>
      this.schedule(async () => {
        // Closing a project can finish after it has unbound its transcript.
        const bound = this.projectId === projectId;
        const destination = bound ? this.history : history;
        const previous = destination.entries;
        const completed = { ...entry, ...changes };
        let updated = previous.map((item) =>
          item.id === entry.id ? completed : item,
        );
        if (
          destination !== history &&
          !updated.some((item) => item.id === entry.id)
        ) {
          updated = [...updated, completed].sort(
            (a, b) =>
              a.afterMessageId - b.afterMessageId || a.startedAt - b.startedAt,
          );
        }
        const entries = boundActivity(updated, destination.replyIds);
        destination.entries = entries;
        try {
          await this.storage.writeActivity(
            projectId,
            entries.filter((item) => item.outcome !== 'working'),
          );
          if (bound) this.activityError = null;
        } catch (error) {
          if (bound)
            this.activityError = `Could not save Wingman activity: ${String(error)}`;
        }
        if (bound) this.publish('activity');
      });
  }
  private loadError: string | null = null;
  private paused = false;
  private resumes = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(change: MessagingChange) => void>();
  private conversationToken: string = crypto.randomUUID();
  private waiters = new Set<symbol>();
  private get waitToken() {
    return `${this.conversationToken}.${String(this.resumes)}`;
  }
  constructor(private storage: MessagingStorage) {}
  status() {
    return {
      projectId: this.projectId,
      paused: this.paused,
      waiting: this.waiters.size > 0,
      loadError: this.loadError,
      activityError: this.activityError,
    };
  }
  snapshot(after = 0) {
    return {
      ...this.status(),
      messages: structuredClone(
        this.messages.filter((message) => message.id > after),
      ),
    };
  }
  /** CLI delivery creates isolated metadata without copying screenshot contents. */
  delivery(after = 0, projectId?: string) {
    if (projectId !== undefined && projectId !== this.projectId)
      return { projectId, messages: [] };
    return {
      projectId: this.projectId,
      messages: this.messages
        .filter((message) => message.id > after)
        .map(wireMessage),
    };
  }
  checkCursor(after: number, projectId?: string) {
    if (
      !this.projectId ||
      (projectId !== undefined && projectId !== this.projectId)
    )
      return;
    const lastId = this.lastMessageId;
    if (!this.loadError && after > lastId)
      throw new Error(
        `messagesAfter is ahead of the last message ID (${String(lastId)}) for this project.`,
      );
  }
  get lastMessageId(): number {
    return this.messages.at(-1)?.id ?? 0;
  }
  subscribe(fn: (change: MessagingChange) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private publish(change: MessagingChange = 'status') {
    this.listeners.forEach((fn) => {
      fn(change);
    });
  }
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => undefined);
    return result;
  }
  bind(projectId: string | null): Promise<void> {
    return this.schedule(async () => {
      let messages: Message[] = [];
      let loadError: string | null = null;
      try {
        if (projectId !== null) messages = await this.storage.read(projectId);
      } catch (error) {
        loadError = `Could not load Wingman conversation: ${error instanceof Error ? error.message : String(error)}`;
      }
      this.history = {
        entries: [],
        replyIds: messages
          .filter((message) => message.sender === 'agent')
          .map((message) => message.id),
      };
      this.activityError = null;
      try {
        if (projectId)
          this.history.entries = await this.storage.readActivity(projectId);
      } catch (error) {
        this.activityError = `Could not load Wingman activity: ${String(error)}`;
      }
      this.loadError = loadError;
      this.projectId = projectId;
      this.messages = messages;
      this.conversationToken = crypto.randomUUID();
      this.waiters.clear();
      this.publish('bind');
    });
  }
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) this.resumes++;
    this.publish();
  }
  stopWaiting(): void {
    this.conversationToken = crypto.randomUUID();
    this.waiters.clear();
    this.publish();
  }
  /** A ticket stays invalid after any intervening pause, even after resume. */
  cliTicket(): () => void {
    const resumes = this.resumes;
    const paused = this.paused;
    return () => {
      if (paused || this.paused || resumes !== this.resumes)
        throw Object.assign(
          new Error(
            'Wingman is paused. Say so once in Wingman using messages.send, then call messages.wait for resume.',
          ),
          { code: 'WINGMAN_PAUSED' },
        );
    };
  }
  scheduleCli<T>(
    enqueue: (operation: () => Promise<T>) => Promise<T>,
    operation: () => Promise<T>,
  ): Promise<T> {
    const ticket = this.cliTicket();
    return new Promise<T>((resolve, reject) => {
      try {
        ticket();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const unsubscribe = this.subscribe(() => {
        try {
          ticket();
        } catch (error) {
          unsubscribe();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      void enqueue(() => {
        unsubscribe();
        ticket();
        return operation();
      }).then(resolve, reject);
    });
  }
  resolveViews(requests: ReplyView[]): MessageView[] {
    return requests.map(({ viewId, caption, annotations = [] }) => {
      const visual = this.activity.find((entry) => entry.id === viewId)?.visual;
      if (!visual?.frame || visual.projectId !== this.projectId)
        throw new Error(`Unknown rendered view: ${viewId}`);
      for (const shape of annotations) {
        if (
          shape.kind === 'freehand' ||
          shape.points.some(
            ({ x, y }) =>
              ![x, y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1),
          )
        )
          throw new Error(
            'Reply annotations require normalized coordinates from 0 to 1 and an agent-supported shape',
          );
        validateAnnotationShape(shape);
      }
      return {
        ...visual,
        frame: visual.frame,
        ...(caption === undefined ? {} : { caption }),
        annotations,
      };
    });
  }
  send(
    text: string,
    attachments: Attachment[],
    sender: 'user' | 'agent',
    views: MessageView[] = [],
  ): Promise<Message> {
    const projectId = this.projectId;
    const copies = structuredClone(attachments);
    const savedViews = structuredClone(views);
    return this.schedule(async () => {
      if (!projectId || projectId !== this.projectId)
        throw new Error('Open a project before sending a message');
      if (this.loadError) throw new Error(this.loadError);
      if (savedViews.some((view) => view.projectId !== projectId))
        throw new Error('View belongs to another project');
      if (!text.trim() && copies.length === 0 && !savedViews.length)
        throw new Error('A message needs text or an attachment');
      if (
        copies.length + savedViews.length > 8 ||
        [
          ...copies,
          ...savedViews.flatMap((view) => (view.image ? [view.image] : [])),
        ].reduce((size, attachment) => size + attachment.dataUrl.length, 0) >
          32 * 1024 * 1024
      )
        throw new Error(
          'A message supports up to 8 images and 32 MiB of encoded image data',
        );
      const exported = await Promise.all(
        copies.map((a) => this.storage.exportAttachment(a)),
      );
      for (const view of savedViews)
        if (view.image)
          view.image = await this.storage.exportAttachment(view.image);
      const message: Message = {
        id: (this.messages.at(-1)?.id ?? 0) + 1,
        sender,
        text,
        createdAt: new Date().toISOString(),
        attachments: exported,
        ...(savedViews.length ? { views: savedViews } : {}),
      };
      const messages = [...this.messages, message];
      await this.storage.write(projectId, messages);
      this.messages = messages;
      if (sender === 'agent') this.history.replyIds.push(message.id);
      this.publish('message');
      return structuredClone(message);
    });
  }
  async read(after = 0, waitMs = 0): Promise<Message[]> {
    if (this.loadError) throw new Error(this.loadError);
    const projectId = this.projectId;
    const available = () => this.messages.some((message) => message.id > after);
    const read = () =>
      structuredClone(this.messages.filter((message) => message.id > after));
    if (available() || !waitMs || !projectId) return read();
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      };
      const unsubscribe = this.subscribe(() => {
        if (this.projectId !== projectId || available()) finish();
      });
      const timer = setTimeout(finish, Math.min(25000, Math.max(0, waitMs)));
    });
    return this.projectId === projectId ? read() : [];
  }
  async wait(
    after = 0,
    timeoutMs = 25000,
    waitToken = this.waitToken,
  ): Promise<MessageWait> {
    if (this.loadError) throw new Error(this.loadError);
    const projectId = this.projectId;
    if (!projectId)
      throw new Error('Open a project before waiting for messages');
    const read = () => this.messages.filter((message) => message.id > after);
    const status = (): MessageWait['status'] => {
      if (projectId !== this.projectId) return 'project_changed';
      if (!waitToken.startsWith(this.conversationToken + '.')) return 'ended';
      if (waitToken !== this.waitToken) return 'resumed';
      return read().some((message) => message.sender === 'user')
        ? 'messages'
        : 'timeout';
    };
    if (status() === 'timeout' && timeoutMs > 0) {
      const waiter = Symbol();
      this.waiters.add(waiter);
      try {
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            unsubscribe();
            resolve();
          };
          const unsubscribe = this.subscribe(() => {
            if (status() !== 'timeout') finish();
          });
          const timer = setTimeout(finish, Math.min(25000, timeoutMs));
          this.publish();
        });
      } finally {
        this.waiters.delete(waiter);
        this.publish();
      }
    }
    const outcome = status();
    const messages =
      outcome === 'project_changed' ? [] : structuredClone(read());
    return {
      status: outcome,
      projectId,
      waitToken: outcome === 'resumed' ? this.waitToken : waitToken,
      messages,
    };
  }
}
