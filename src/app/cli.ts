import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Application, ApplicationRequest } from './application';
import type { Message } from './messaging';

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
      ? 'commands.list'
      : argument;
  const source = input ?? args[1] ?? '{}';
  const body: unknown = JSON.parse(source);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Request must be a JSON object');
  const fields = body as Record<string, unknown>;
  for (const key of Object.keys(fields))
    if (
      !['payload', 'projectId', 'expectedRevision', 'messagesAfter'].includes(
        key,
      )
    )
      throw new Error(
        `Unknown request field ${key}. Put command parameters in payload.`,
      );
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
      await invoke('cli_respond', { id: event.payload.id, response, exitCode });
      if (exitCode === 0 && event.payload.args[0] === 'web.activate')
        window.location.reload();
    })().catch((error: unknown) => {
      console.error('CLI response failed', error);
    });
  });
  await invoke('bridge_ready');
  return unlisten;
}

function wireMessage(message: Message) {
  return {
    ...message,
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      width: attachment.width,
      height: attachment.height,
      ...(attachment.path === undefined ? {} : { path: attachment.path }),
    })),
  };
}

export async function dispatchCli(
  application: Pick<Application, 'dispatch' | 'messaging' | 'project'>,
  args: string[],
  input?: string,
) {
  let request: ApplicationRequest | undefined;
  const delivery = () => {
    const snapshot = application.messaging.snapshot();
    const after =
      request?.projectId !== undefined &&
      request.projectId !== snapshot.projectId
        ? 0
        : (request?.messagesAfter ?? 0);
    return {
      messagesProjectId: snapshot.projectId,
      messages: snapshot.messages
        .filter((message) => message.id > after)
        .map(wireMessage),
    };
  };
  try {
    request = parseCli(args, input);
    const result = await application.dispatch(request);
    if (request.name === 'messages.send')
      result.data = wireMessage(result.data as Message);
    if (request.name === 'messages.read')
      result.data = (result.data as Message[]).map(wireMessage);
    return {
      exitCode: 0,
      response: {
        ok: true,
        ...result,
        ...delivery(),
      },
    };
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
        projectId: application.project?.id ?? null,
        revision: application.project?.revision ?? null,
        ...(request ? delivery() : {}),
      },
    };
  }
}
