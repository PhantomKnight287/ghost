/** Answers `fetch` by URL pathname for tests: a Response is sent as it is, a number as an empty answer with that status, anything else as JSON. An unlisted path gets 404. Returns the function that puts the real `fetch` back. */
export function fakeApi(routes: Record<string, unknown>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const answer = routes[url.pathname];
    if (answer === undefined) return new Response(null, { status: 404 });
    if (typeof answer === "number")
      return new Response(null, { status: answer });
    if (answer instanceof Response) return answer;
    return Response.json(answer);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
