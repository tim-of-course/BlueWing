export type ConversationMode = 'wingman' | 'chat';

export interface CliConnection {
  cliPath: string;
  shell: 'posix' | 'powershell';
  dataDir: string;
}

export function conversationInstructions(mode: ConversationMode): string {
  const shared = [
    'Read messageHistory for context, act only on clearly open requests, and ask if unsure.',
    'Use one agent per conversation. After an uncertain send, read with messages.read before sending again.',
  ].join('\n');
  if (mode === 'chat')
    return `Chat only: use Bluewing tools and visual views, and keep questions, progress, and answers in our external chat. Answer new Wingman messages there and wait for further instructions there.\n${shared}`;
  return [
    'Wingman + chat: reply to my Wingman messages using messages.send so I can work entirely in Bluewing. Our external chat remains available; duplicate replies are optional.',
    shared,
    'After connecting, introduce yourself briefly in Wingman. After answering or completing work, call messages.wait and use your available tools to await its result. Continue this conversation while your environment supports it.',
    'On timeout, renew the wait if you can continue. On resumed, continue work. On ended or project_changed, stop waiting. If your environment cannot remain available, explain that briefly through messages.send before ending your turn.',
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
      ? `'${value.replace(/['\u2018\u2019\u201a\u201b]/g, "'$&")}'`
      : `'${value.replaceAll("'", "'\\''")}'`;
  const request = JSON.stringify({ projectId: project.id, payload: { mode } });
  const command =
    connection.shell === 'powershell'
      ? `$OutputEncoding = [System.Text.UTF8Encoding]::new($false); $env:BLUEWING_DATA_DIR = ${quote(connection.dataDir)}; ${quote(request)} | & ${quote(connection.cliPath)} connect --stdin`
      : `BLUEWING_DATA_DIR=${quote(connection.dataDir)} ${quote(connection.cliPath)} connect ${quote(request)}`;
  return [
    `Connect to my open Bluewing project ${JSON.stringify(project.name)} using this ${connection.shell === 'powershell' ? 'PowerShell' : 'shell'} command:`,
    command,
    ...(connection.shell === 'powershell'
      ? [
          'Reuse $OutputEncoding in each new shell and send JSON via --stdin, piping Get-Content -Raw -Encoding UTF8 -LiteralPath request.json for text with quotes or non-ASCII characters.',
        ]
      : []),
    conversationInstructions(mode),
    `Keep Bluewing open. Reuse this executable and BLUEWING_DATA_DIR with projectId ${JSON.stringify(project.id)}. Use takeoff.list then takeoff.select to set CLI context (initially Main, independent of the UI). Envelope takeoffId overrides one request. Check the echoed takeoff and read connect for help and cursor rules.`,
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
    help: 'commands.list indexes commands. bluewing help <command> gives its schema and examples. Wrap only the example payload in the request envelope: {"payload":{...}}. Substitute IDs from your project.',
    start: project
      ? 'Use takeoff.list and takeoff.select for CLI context (starts on Main, independent of UI). Envelope takeoffId overrides one request. For project edits include projectId and the latest expectedRevision.'
      : 'Open or create a project in Bluewing to begin.',
    skill:
      'Before any takeoff or estimating work, run estimating.skill and follow it. It holds our scopes, takeoff standards, and handoff document.',
    workflows: {
      estimating: { title: 'Estimating skill', start: 'estimating.skill' },
      pageNaming: { title: 'AI Page Naming', start: 'sheet.naming.start' },
    },
    commands: {
      project:
        'project.inspect, project.create, project.open, sheet.render, sheet.scale, sheet.calibrate',
      sheetNaming:
        'sheet.naming.start, sheet.naming.read, sheet.naming.apply, sheet.naming.cancel',
      takeoff:
        'takeoff.list, takeoff.select, takeoff.create, takeoff.rename, takeoff.delete, takeoff.inspect, takeoff.copyItems, geometry.put, group.put, assignment.put, quantities.inspect, quantities.exportEstiMaker',
      assemblies: 'library.inspect, assembly.import, assembly.put',
      construction:
        'wall.put, wall.fromAssembly, opening.put, ceiling.fromAssembly, construction.inspect, construction.render',
      changes: 'preview, batch, history.undo',
      review: 'snippet.render, review.inspect, wingman.flash',
      notes: 'notes.read, notes.search, notes.write',
      conversation: 'messages.send, messages.read, messages.wait',
    },
    messages:
      'Read top-level messages on every result, including sends and errors. Open attachment paths as needed. Process messageHistory on connect, then unseen messages in ID order. Pass the highest processed ID from either list for messagesProjectId as envelope messagesAfter on every request. Reads are nondestructive. messages.wait accepts timeoutMs (native default 300000). Only the user can resume paused CLI work.',
    ...(mode === undefined
      ? {}
      : { mode, instructions: conversationInstructions(mode) }),
  };
}
