import { invoke } from '@tauri-apps/api/core';
import type { Message, MessagingStorage } from '../app/messaging';

import type { WingmanActivity } from '../app/wingman-types';

function browserRecord<T>(
  storeName: 'conversations' | 'activity',
  projectId: string,
  messages?: T[],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('bluewing-wingman', 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('conversations');
      open.result.createObjectStore('activity');
    };
    open.onerror = () => {
      reject(open.error ?? new Error('Could not open conversation storage'));
    };
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(
        storeName,
        messages ? 'readwrite' : 'readonly',
      );
      const store = transaction.objectStore(storeName);
      const request = messages
        ? store.put(messages, projectId)
        : store.get(projectId);
      transaction.oncomplete = () => {
        db.close();
        resolve(
          messages ??
            (request.result === undefined ? [] : (request.result as T[])),
        );
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error ?? new Error('Conversation save failed'));
      };
    };
  });
}

export function messagingStorage(native: boolean): MessagingStorage {
  const key = async (projectId: string, record: 'messages' | 'activity') => {
    const hash = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(projectId),
    );
    return `wingman-${record}-${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}.json`;
  };
  return {
    async read(projectId) {
      let messages: Message[];
      if (native) {
        const data = await invoke<string | null>('app_data_read', {
          key: await key(projectId, 'messages'),
        });
        messages = data === null ? [] : (JSON.parse(data) as Message[]);
      } else
        messages = await browserRecord<Message>('conversations', projectId);
      if (!Array.isArray(messages)) throw new Error('Invalid message list');
      let lastId = 0;
      for (const message of messages) {
        if (
          !Number.isSafeInteger(message.id) ||
          message.id <= lastId ||
          !['user', 'agent'].includes(message.sender) ||
          typeof message.text !== 'string' ||
          typeof message.createdAt !== 'string' ||
          !Array.isArray(message.attachments)
        )
          throw new Error('Invalid Wingman message');
        lastId = message.id;
        for (const attachment of message.attachments) {
          if (
            typeof attachment.id !== 'string' ||
            typeof attachment.name !== 'string' ||
            typeof attachment.dataUrl !== 'string' ||
            !Number.isFinite(attachment.width) ||
            !Number.isFinite(attachment.height) ||
            (attachment.path !== undefined &&
              typeof attachment.path !== 'string')
          )
            throw new Error('Invalid Wingman attachment');
          if (native && attachment.path && attachment.dataUrl.endsWith(',')) {
            try {
              const file = await invoke<{ data: string }>('read_file', {
                path: attachment.path,
              });
              attachment.dataUrl += file.data;
              delete attachment.unavailable;
            } catch {
              attachment.unavailable = true;
            }
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
          key: await key(projectId, 'messages'),
          data: JSON.stringify(stored),
        });
      } else await browserRecord('conversations', projectId, messages);
    },
    async readActivity(projectId) {
      if (!native) return browserRecord<WingmanActivity>('activity', projectId);
      const data = await invoke<string | null>('app_data_read', {
        key: await key(projectId, 'activity'),
      });
      return data === null ? [] : (JSON.parse(data) as WingmanActivity[]);
    },
    async writeActivity(projectId, entries) {
      if (native)
        await invoke('app_data_write', {
          key: await key(projectId, 'activity'),
          data: JSON.stringify(entries),
        });
      else await browserRecord('activity', projectId, entries);
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
