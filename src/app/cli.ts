import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Application, ApplicationRequest } from './application';

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
  const name = args[0];
  if (!name || name === '--help' || name === 'help')
    return { name: 'commands.list' };
  const source = input ?? args[1] ?? '{}';
  const body: unknown = JSON.parse(source);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Request must be a JSON object');
  const fields = body as Record<string, unknown>;
  for (const key of Object.keys(fields))
    if (!['payload', 'projectId', 'expectedRevision'].includes(key))
      throw new Error(
        `Unknown request field ${key}. Put command parameters in payload.`,
      );
  if (fields.projectId !== undefined && typeof fields.projectId !== 'string')
    throw new Error('projectId must be a string');
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
      let response: unknown;
      let exitCode = 0;
      try {
        response = {
          ok: true,
          ...(await application.dispatch(
            parseCli(event.payload.args, event.payload.input),
          )),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof Error && 'code' in error
            ? String(error.code)
            : 'COMMAND_FAILED';
        response = {
          ok: false,
          error: { code, message },
          projectId: application.project?.id ?? null,
          revision: application.project?.revision ?? null,
        };
        exitCode = code === 'PROJECT_CONFLICT' ? 3 : 1;
      }
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
