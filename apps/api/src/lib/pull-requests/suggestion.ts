/** The replacement text of the first ```suggestion block in a comment, or null when it has none. An empty block suggests deleting the lines. */
export function extractSuggestion(body: string): string | null {
  const match = /^```suggestion[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/m.exec(body);
  if (!match) return null;
  return match[1].replace(/\r?\n$/, '');
}

/** Replaces lines `start` to `end`, 1-based and inclusive, keeping the file's own line endings and its final newline. */
export function applySuggestion(
  content: string,
  start: number,
  end: number,
  replacement: string,
): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(eol);
  lines.splice(
    start - 1,
    end - start + 1,
    ...(replacement === '' ? [] : replacement.split(/\r?\n/)),
  );
  return lines.join(eol);
}
