/** Literal, case-insensitive matches in original UTF-16 offsets for textarea selection. */
export function noteMatches(
  markdown: string,
  query: string,
): { start: number; end: number; line: number }[] {
  if (query.length === 0) throw new Error('Search query cannot be empty');
  const needle = query.toLowerCase();
  const matches: { start: number; end: number; line: number }[] = [];
  let line = 1;
  for (let start = 0; start < markdown.length; start++) {
    if (markdown.slice(start, start + query.length).toLowerCase() === needle) {
      matches.push({ start, end: start + query.length, line });
    }
    if (markdown[start] === '\n') line++;
  }
  return matches;
}

export function searchNotes(markdown: string, query: string) {
  const matches = noteMatches(markdown, query);
  const lines = markdown.split(/\r?\n/);
  return {
    lines: [...new Set(matches.map((match) => match.line))].map((line) => ({
      line,
      text: lines[line - 1] ?? '',
    })),
    totalMatches: matches.length,
  };
}
