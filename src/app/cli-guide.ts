export type ConversationMode = 'wingman' | 'chat';

export interface CliConnection {
  cliPath: string;
  shell: 'posix' | 'powershell';
  dataDir: string;
}

export function conversationInstructions(mode: ConversationMode): string {
  if (mode === 'chat')
    return 'Chat only: use Bluewing tools and visual views, and keep questions, progress, and answers in our external chat. Interpret any Wingman messages in this mode as user input to answer in the external chat. Wait for further instructions there.';
  return [
    'Wingman + chat: reply to my Wingman messages using messages.send so I can work entirely in Bluewing. Our external chat remains available; duplicate replies are optional.',
    'After connecting, introduce yourself briefly in Wingman. After answering or completing work, call messages.wait and use your available tools to await its result. Continue this conversation while your environment supports it.',
    'On timeout, renew the wait if you can continue. On ended or project_changed, stop waiting. If your environment cannot remain available, explain that briefly through messages.send before ending your turn. Bluewing does not require any particular model or harness.',
  ].join('\n');
}

export const messageGuidance =
  'User input from Wingman. In Wingman + chat, reply using messages.send; in Chat only, reply in the external chat.';

export function connectionPrompt(
  connection: CliConnection,
  project: { id: string; name: string },
  mode: ConversationMode,
): string {
  const quote = (value: string) =>
    connection.shell === 'powershell'
      ? `'${value.replaceAll("'", "''")}'`
      : `'${value.replaceAll("'", "'\\''")}'`;
  const request = JSON.stringify({ projectId: project.id, payload: { mode } });
  const command =
    connection.shell === 'powershell'
      ? `$env:BLUEWING_DATA_DIR = ${quote(connection.dataDir)}; ${quote(request)} | & ${quote(connection.cliPath)} connect --stdin`
      : `BLUEWING_DATA_DIR=${quote(connection.dataDir)} ${quote(connection.cliPath)} connect ${quote(request)}`;
  return [
    `Connect to my open Bluewing project ${JSON.stringify(project.name)} using this ${connection.shell === 'powershell' ? 'PowerShell' : 'shell'} command:`,
    command,
    conversationInstructions(mode),
    `Use this executable and BLUEWING_DATA_DIR for subsequent commands. Keep requests bound to projectId ${JSON.stringify(project.id)}. Bluewing must remain open. Read the connection result for command help and message cursors.`,
  ].join('\n\n');
}

export function cliIntroduction(
  project: { id: string; name: string; revision: number } | null,
  mode?: ConversationMode,
) {
  return {
    project: project
      ? { id: project.id, name: project.name, revision: project.revision }
      : null,
    usage: 'bluewing <command> <JSON request> (or <command> --stdin)',
    help: 'bluewing help <command> returns its payload schema and examples; commands.list returns the full registry.',
    start: project
      ? 'project.inspect reads the current takeoff. Use projectId and the latest expectedRevision for edits.'
      : 'Open or create a project in Bluewing to begin.',
    commands: {
      project: 'project.inspect, project.create, project.open, sheet.render',
      takeoff: 'geometry.put, group.put, assignment.put, quantities.inspect',
      construction: 'wall.put, construction.inspect, construction.render',
      review: 'snippet.render, review.inspect, wingman.flash',
      conversation: 'messages.send, messages.read, messages.wait',
    },
    messages:
      'Results carry messages and messagesProjectId, including on command errors. Read user messages and open attachment paths. Keep the greatest received message id with that project identity and pass it as messagesAfter on every next request, including sends; reads are nondestructive. messages.wait also accepts payload.after and timeoutMs (native default 300000ms). Process messages on send/wait results before waiting again. Pause CLI blocks non-messaging commands; only the user can resume.',
    ...(mode === undefined
      ? {}
      : { mode, instructions: conversationInstructions(mode) }),
  };
}
