/** Splits `org:acme user:alice rest of query` into the owner it names and the text left to match. `org:` and `user:` both name the owner in `/owner/repo`; the last one given wins. */
export function ownerQualifier(query: string) {
  let owner: string | null = null;
  const rest = query
    .split(/\s+/)
    .filter((token) => {
      const match = /^(?:org|user):(\S+)$/i.exec(token);
      if (match) owner = match[1];
      return !match;
    })
    .join(' ')
    .trim();
  return { owner, rest };
}
