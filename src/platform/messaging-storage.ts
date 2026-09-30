import { invoke } from '@tauri-apps/api/core';
import type { Message, MessagingStorage } from '../app/messaging';

function browserMessages(
  projectId: string,
  messages?: Message[],
): Promise<Message[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('bluewing-messages', 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('conversations');
    };
    open.onerror = () => {
      reject(open.error ?? new Error('Could not open conversation storage'));
    };
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(
        'conversations',
        messages ? 'readwrite' : 'readonly',
      );
      const store = transaction.objectStore('conversations');
      const request = messages
        ? store.put(messages, projectId)
        : store.get(projectId);
      transaction.oncomplete = () => {
        db.close();
        resolve(messages ?? (request.result as Message[] | undefined) ?? []);
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error ?? new Error('Conversation save failed'));
      };
    };
  });
}

export function messagingStorage(native: boolean): MessagingStorage {
  const key = async (projectId: string) => {
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(projectId),
    );
    return `messages-${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}.json`;
  };
  return {
    async read(projectId) {
      if (!native) return browserMessages(projectId);
      const data = await invoke<string | null>('app_data_read', {
        key: await key(projectId),
      });
      const messages = data ? (JSON.parse(data) as Message[]) : [];
      for (const message of messages) {
        for (const attachment of message.attachments) {
          if (attachment.path && attachment.dataUrl.endsWith(',')) {
            const file = await invoke<{ data: string }>('read_file', {
              path: attachment.path,
            });
            attachment.dataUrl += file.data;
          }
        }
      }
      return messages;
    },
    async write(projectId, messages) {
      if (native) {
        const stored = messages.map((message) => ({
          ...message,
          attachments: message.attachments.map((attachment) => ({
            ...attachment,
            dataUrl: attachment.path
              ? attachment.dataUrl.slice(0, attachment.dataUrl.indexOf(',') + 1)
              : attachment.dataUrl,
          })),
        }));
        await invoke('app_data_write', {
          key: await key(projectId),
          data: JSON.stringify(stored),
        });
      } else await browserMessages(projectId, messages);
    },
    async exportAttachment(attachment) {
      const image =
        /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
          attachment.dataUrl,
        );
      if (!image)
        throw new Error('Attachment must be a base64 PNG, JPEG, or WebP image');
      if (!native) return attachment;
      const path = await invoke<string>('app_data_export', {
        key: `attachment-${crypto.randomUUID()}.${image[1] ?? 'png'}`,
        data: image[2],
      });
      return { ...attachment, path };
    },
  };
}
