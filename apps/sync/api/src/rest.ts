import type { Side } from "./side.ts";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
/** A wait longer than this fails the request instead: the job is dropped and the next reconcile retries, rather than one job holding its sync's queue. */
const MAX_WAIT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

export class RestError extends Error {
  /** Which host answered, once a caller that knows has said so. */
  side?: Side;
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    const detail = (Array.isArray(body) ? body[0] : body) as { message?: string } | null | undefined;
    super(detail?.message ? `${status} ${detail.message}` : String(status));
  }
}

export type Rest = {
  request: <T>(method: string, path: string, body?: unknown) => Promise<T>;
  paginate: <T>(path: string) => AsyncGenerator<T>;
  graphql: <T>(query: string, variables: Record<string, unknown>) => Promise<T>;
};

const nextLink = (link: string | null) => link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];

/** Error pages from proxies in front of a host are HTML, not JSON. */
const parse = (text: string): unknown => {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 200) };
  }
};

/** How long the host asked us to wait, or null when it did not say. */
function hostWait(response: Response, now: number) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    return Number.isFinite(seconds) ? seconds * 1000 : Math.max(0, Date.parse(retryAfter) - now);
  }
  // GitHub's primary rate limit: the quota is spent until `x-ratelimit-reset` (epoch seconds).
  if (response.headers.get("x-ratelimit-remaining") === "0") return Math.max(0, Number(response.headers.get("x-ratelimit-reset")) * 1000 - now);
  return null;
}

/** The host refused before doing any work, so even a POST is safe to send again. */
const isRateLimited = (response: Response, body: unknown) =>
  response.status === 429 ||
  (response.status === 403 && (response.headers.get("x-ratelimit-remaining") === "0" || /secondary rate limit/i.test((body as { message?: string } | null)?.message ?? "")));

export function createRest({
  baseUrl,
  graphqlUrl,
  token,
  fetch = globalThis.fetch,
  sleep = (ms) => Bun.sleep(ms),
  now = Date.now,
}: {
  baseUrl: string;
  graphqlUrl: string;
  token: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Rest {
  const send = async (method: string, url: string, body?: unknown, { replayable = method !== "POST" } = {}) => {
    for (let attempt = 1; ; attempt++) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${await token()}`,
        accept: "application/vnd.github+json",
      };
      if (body !== undefined) headers["content-type"] = "application/json";
      const last = attempt === MAX_ATTEMPTS;
      const backoff = BASE_DELAY_MS * 2 ** (attempt - 1);

      let response: Response;
      try {
        response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (error) {
        // A dropped connection or a timeout may have reached the host, so only a request that can be replayed goes again.
        if (!replayable || last) throw error;
        await sleep(backoff);
        continue;
      }
      const data = parse(await response.text());
      if (response.ok) return { data, link: response.headers.get("link") };

      const rateLimited = isRateLimited(response, data);
      // A 5xx on a POST may still have created the item; sending it again could create it twice.
      if (!(rateLimited || (response.status >= 500 && replayable)) || last) throw new RestError(response.status, data ?? null);
      const wait = hostWait(response, now()) ?? backoff;
      if (wait > MAX_WAIT_MS) throw new RestError(response.status, data ?? null);
      await sleep(wait);
    }
  };

  return {
    request: async <T>(method: string, path: string, body?: unknown) => (await send(method, `${baseUrl}${path}`, body)).data as T,

    async *paginate<T>(path: string) {
      let url: string | undefined = `${baseUrl}${path}`;
      while (url) {
        const { data, link } = await send("GET", url);
        // Search and installation listings wrap the page as { total_count, <key>: [...] }.
        const items = Array.isArray(data) ? data : Object.values(data as object).find(Array.isArray);
        yield* (items ?? []) as T[];
        url = nextLink(link);
      }
    },

    graphql: async <T>(query: string, variables: Record<string, unknown>) => {
      // A query only reads, so it can be sent again; a mutation cannot.
      const { data } = await send("POST", graphqlUrl, { query, variables }, { replayable: !/^\s*mutation\b/.test(query) });
      const result = data as { data: T; errors?: unknown[] };
      if (result.errors?.length) throw new RestError(200, result.errors);
      return result.data;
    },
  };
}
