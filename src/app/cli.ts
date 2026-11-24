import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Application, ApplicationRequest } from './application';
import { wireMessage, type Message, type MessageWait } from './messaging';
import { messageGuidance, type CliConnection } from './cli-guide';
import { registry } from './registry';
import { ProjectConflictError } from '../core/session';
import type { FinishPerformanceSpan } from '../performance/recorder';

interface CliRequest {
  id: string;
  args: string[];
  input?: string;
}
export function parseCli(args: string[], input?: string): ApplicationRequest {
  if (args.length > 2 || (input !== undefined && args.length > 1)) {
    throw new Error(
      'Use bluewing <command> <JSON request>, or bluewing <command> --stdin',
    );
  }
  const argument = args[0];
  const name =
    !argument || argument === '--help' || argument === 'help'
      ? 'help'
      : argument;
  const json = (input ?? args[1] ?? '{}').replace(/^\uFEFF/, '');
  const source =
    name === 'help' && input === undefined && args[1] && !json.startsWith('{')
      ? JSON.stringify({ payload: { command: args[1] } })
      : json;
  const body: unknown = JSON.parse(source);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Request must be a JSON object');
  const fields = body as Record<string, unknown>;
  for (const key of Object.keys(fields))
    if (
      ![
        'payload',
        'projectId',
        'takeoffId',
        'expectedRevision',
        'messagesAfter',
      ].includes(key)
    )
      throw new Error(
        `Unknown request field ${key}. Put command parameters in payload.`,
      );
  if (fields.takeoffId !== undefined && typeof fields.takeoffId !== 'string')
    throw new Error('takeoffId must be a string');
  if (fields.projectId !== undefined && typeof fields.projectId !== 'string')
    throw new Error('projectId must be a string');
  if (
    fields.messagesAfter !== undefined &&
    (typeof fields.messagesAfter !== 'number' ||
      !Number.isSafeInteger(fields.messagesAfter) ||
      fields.messagesAfter < 0)
  )
    throw new Error('messagesAfter must be a nonnegative integer');
  if (
    fields.expectedRevision !== undefined &&
    (typeof fields.expectedRevision !== 'number' ||
      !Number.isInteger(fields.expectedRevision))
  )
    throw new Error('expectedRevision must be an integer');
  return {
    name,
    payload: fields.payload ?? {},
    origin: 'cli',
    ...(typeof fields.takeoffId === 'string'
      ? { takeoffId: fields.takeoffId }
      : {}),
    ...(typeof fields.messagesAfter === 'number'
      ? { messagesAfter: fields.messagesAfter }
      : {}),
    ...(typeof fields.projectId === 'string'
      ? { projectId: fields.projectId }
      : {}),
    ...(typeof fields.expectedRevision === 'number'
      ? { expectedRevision: fields.expectedRevision }
      : {}),
  };
}
export async function connectCli(
  application: Application,
): Promise<() => void> {
  const unlisten = await listen<CliRequest>('bluewing:cli-request', (event) => {
    void (async () => {
      const { response, exitCode } = await dispatchCli(
        application,
        event.payload.args,
        event.payload.input,
      );
      try {
        await invoke('cli_respond', {
          id: event.payload.id,
          response,
          exitCode,
        });
      } catch (error) {
        console.error('CLI response failed', error);
      } finally {
        if (exitCode === 0 && event.payload.args[0] === 'web.activate')
          window.location.reload();
      }
    })().catch((error: unknown) => {
      console.error('CLI response failed', error);
    });
  });
  try {
    const connection = await invoke<Partial<CliConnection>>('bridge_ready');
    if (connection.cliPath && connection.dataDir)
      application.setCliConnection({
        cliPath: connection.cliPath,
        shell:
          connection.shell ??
          (connection.cliPath.endsWith('.exe') ? 'powershell' : 'posix'),
        dataDir: connection.dataDir,
      });
  } catch (error) {
    try {
      await Promise.resolve().then(unlisten);
    } catch (cleanupError) {
      console.error('CLI listener cleanup failed', cleanupError);
    }
    throw error;
  }
  return unlisten;
}

export async function dispatchCli(
  application: Pick<Application, 'dispatch' | 'messaging' | 'project'> &
    Partial<Pick<Application, 'performance' | 'recordCliContact'>>,
  args: string[],
  input?: string,
) {
  application.recordCliContact?.();
  let request: ApplicationRequest | undefined;
  let finish: FinishPerformanceSpan | undefined;
  let success = false;
  let connectHistory: { projectId: string | null; lastId: number } | undefined;
  const delivery = (
    snapshot?: { projectId: string | null; messages: Message[] },
    openedProjectId?: string,
  ) => {
    const bound = request?.projectId;
    const { projectId, messages: rows } =
      snapshot && (bound === undefined || bound === snapshot.projectId)
        ? {
            projectId: snapshot.projectId,
            messages: snapshot.messages.map(wireMessage),
          }
        : application.messaging.delivery(
            openedProjectId && bound !== undefined && bound !== openedProjectId
              ? 0
              : (request?.messagesAfter ?? 0),
            openedProjectId ?? bound,
          );
    const historyEnd =
      connectHistory?.projectId === projectId
        ? connectHistory.lastId
        : Infinity;
    const messages = connectHistory
      ? rows.filter((row) => row.id > historyEnd)
      : rows;
    return {
      messagesProjectId: projectId,
      ...(connectHistory
        ? { messageHistory: rows.filter((row) => row.id <= historyEnd) }
        : {}),
      messages,
      ...(messages.some((message) => message.sender === 'user')
        ? { messageGuidance }
        : {}),
    };
  };
  try {
    request = parseCli(args, input);
    const name = request.name;
    if (name === 'connect') {
      connectHistory = {
        projectId: application.messaging.status().projectId,
        lastId: application.messaging.lastMessageId,
      };
    }
    const definition = registry.find((entry) => entry.name === name);
    if (definition && !definition.name.startsWith('performance.'))
      // Includes queue wait and response formatting, before the native roundtrip.
      finish = application.performance?.span('cli.command', {
        purpose: definition.name,
      });
    if (request.messagesAfter !== undefined)
      application.messaging.checkCursor(
        request.messagesAfter,
        request.projectId,
      );
    const result = await application.dispatch(request);
    let snapshot;
    if (name === 'messages.send')
      result.data = { id: (result.data as Message).id };
    if (name === 'messages.read') {
      snapshot = {
        projectId: result.projectId,
        messages: result.data as Message[],
      };
      result.data = null;
    }
    if (name === 'messages.wait') {
      const { messages, ...wait } = result.data as MessageWait;
      snapshot = { projectId: wait.projectId, messages };
      result.data = wait;
    }
    const reply = {
      exitCode: 0,
      response: {
        ok: true,
        ...result,
        ...delivery(
          snapshot,
          request.name === 'project.open'
            ? (result.projectId ?? undefined)
            : undefined,
        ),
      },
    };
    success = true;
    return reply;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code =
      error instanceof Error && 'code' in error
        ? String(error.code)
        : 'COMMAND_FAILED';
    return {
      exitCode: code === 'PROJECT_CONFLICT' ? 3 : 1,
      response: {
        ok: false,
        error: { code, message },
        projectId:
          error instanceof ProjectConflictError
            ? error.projectId
            : (application.project?.id ?? null),
        revision:
          error instanceof ProjectConflictError
            ? error.revision
            : (application.project?.revision ?? null),
        ...(request ? delivery() : {}),
      },
    };
  } finally {
    finish?.({ success });
  }
}
