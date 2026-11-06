import { connectionPrompt, type CliConnection } from './cli-guide';

export const pageNamingInstructions = [
  'Name the plan pages from their printed sheet number and page title. This is the AI Page Naming workflow, replacing heuristic auto-naming.',
  'Read sheet.naming.read in small batches using nextOffset; keep a compact id/name result list rather than repeating raw snippets in progress messages. Only bottom-right title-block snippets are returned. While queued/reading remain, work on available snippets and check progress; do not repeatedly restart completed extraction.',
  'Use the printed code and page title, for example A101 · FLOOR PLAN. Distinguish the sheet title from project names, addresses, revisions, and detail titles. Keep original names when evidence is uncertain.',
  'For no-title-block-text, extraction errors, truncated or ambiguous snippets, inspect only the returned region with sheet.render (sheetId, bounds: region, mode: plan, maxDimension: 1600, and an output path). This is a visual/OCR task for your capabilities; Bluewing does not run OCR. Never request all page images or full-page text by default.',
  'Use projectId and revision from your latest sheet.naming.read response to call sheet.naming.apply with projectId, expectedRevision and payload.sheets: [{id,name}]. It saves up to 500 names as one undoable edit. On a revision conflict, reread the affected snippets/current names before retrying. Do not request the full project just for revision metadata, or overwrite newer names blindly.',
  'Report the renamed count and any unresolved pages. No user review dialog is required. Reads and preparation do not save project changes.',
].join('\n');

export function pageNamingTask(
  connection: CliConnection | null,
  project: { id: string; name: string },
) {
  return [
    connection
      ? connectionPrompt(connection, project, 'chat')
      : `Use the Bluewing desktop CLI connection for project ${JSON.stringify(project.id)}.`,
    'Task: Name this project’s plan pages from their printed sheet numbers and titles. Start with sheet.naming.start, which returns the specific workflow and prepares compact title-block snippets. Complete the workflow and apply the names; ask me only about genuinely ambiguous pages.',
  ].join('\n\n');
}
