/** GitHub's callback rule: same scheme, host and port as the registered callback, and a path equal to its path or under it. */
export function callbackMatches(registered: string, given: string) {
  if (given.includes('#')) return false;
  let callback: URL;
  let redirect: URL;
  try {
    callback = new URL(registered);
    redirect = new URL(given);
  } catch {
    return false;
  }
  if (redirect.username || redirect.password) return false;
  if (redirect.origin !== callback.origin) return false;
  const base = callback.pathname.endsWith('/')
    ? callback.pathname
    : `${callback.pathname}/`;
  return (
    redirect.pathname === callback.pathname ||
    redirect.pathname.startsWith(base)
  );
}
