export interface Attachment {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  path?: string;
}
export interface Message {
  id: number;
  sender: 'user' | 'agent';
  text: string;
  createdAt: string;
  attachments: Attachment[];
}
export function wireMessage(message: Message) {
  return {
    id: message.id,
    sender: message.sender,
    text: message.text,
    createdAt: message.createdAt,
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      width: attachment.width,
      height: attachment.height,
      ...(attachment.path === undefined ? {} : { path: attachment.path }),
    })),
  };
}
type MessagingChange = 'bind' | 'message' | 'status';
export interface MessagingStorage {
  read(projectId: string): Promise<Message[]>;
  write(projectId: string, messages: Message[]): Promise<void>;
  exportAttachment(attachment: Attachment): Promise<Attachment>;
}
export interface MessageWait {
  status: 'messages' | 'timeout' | 'ended' | 'project_changed';
  projectId: string | null;
  waitToken: string;
  after: number;
  messages: Message[];
}
export class Messaging {
  private projectId: string | null = null;
  private messages: Message[] = [];
  private paused = false;
  private epoch = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(change: MessagingChange) => void>();
  private waitToken: string = crypto.randomUUID();
  private waiters = new Set<symbol>();
  constructor(private storage: MessagingStorage) {}
  status() {
    return {
      projectId: this.projectId,
      paused: this.paused,
      waiting: this.waiters.size > 0,
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
    if (projectId !== undefined && projectId !== this.projectId) after = 0;
    return {
      projectId: this.projectId,
      messages: this.messages
        .filter((message) => message.id > after)
        .map(wireMessage),
    };
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
      const messages =
        projectId === null ? [] : await this.storage.read(projectId);
      this.projectId = projectId;
      this.messages = messages;
      this.waitToken = crypto.randomUUID();
      this.waiters.clear();
      this.publish('bind');
    });
  }
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) this.epoch++;
    this.publish();
  }
  stopWaiting(): void {
    this.waitToken = crypto.randomUUID();
    this.waiters.clear();
    this.publish();
  }
  /** A ticket stays invalid after any intervening pause, even after resume. */
  cliTicket(): () => void {
    const epoch = this.epoch;
    const paused = this.paused;
    return () => {
      if (paused || this.paused || epoch !== this.epoch)
        throw Object.assign(
          new Error('Wingman is paused; submit a new command after resume.'),
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
  send(
    text: string,
    attachments: Attachment[],
    sender: 'user' | 'agent',
  ): Promise<Message> {
    const projectId = this.projectId;
    const copies = structuredClone(attachments);
    return this.schedule(async () => {
      if (!projectId || projectId !== this.projectId)
        throw new Error('Open a project before sending a message');
      if (!text.trim() && copies.length === 0)
        throw new Error('A message needs text or an attachment');
      if (
        copies.length > 8 ||
        copies.reduce(
          (size, attachment) => size + attachment.dataUrl.length,
          0,
        ) >
          32 * 1024 * 1024
      )
        throw new Error(
          'A message supports up to 8 images and 32 MiB of encoded image data',
        );
      const exported = await Promise.all(
        copies.map((a) => this.storage.exportAttachment(a)),
      );
      const message: Message = {
        id: (this.messages.at(-1)?.id ?? 0) + 1,
        sender,
        text,
        createdAt: new Date().toISOString(),
        attachments: exported,
      };
      const messages = [...this.messages, message];
      await this.storage.write(projectId, messages);
      this.messages = messages;
      this.publish('message');
      return structuredClone(message);
    });
  }
  async read(after = 0, waitMs = 0): Promise<Message[]> {
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
    const projectId = this.projectId;
    if (!projectId)
      throw new Error('Open a project before waiting for messages');
    const read = () => this.messages.filter((message) => message.id > after);
    const status = (): MessageWait['status'] => {
      if (projectId !== this.projectId) return 'project_changed';
      if (waitToken !== this.waitToken) return 'ended';
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
      waitToken,
      after: messages.at(-1)?.id ?? after,
      messages,
    };
  }
}
