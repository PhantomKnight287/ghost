const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;

export class RestError extends Error {
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

const isSecondaryRateLimit = (status: number, body: unknown) =>
  status === 403 && /secondary rate limit/i.test((body as { message?: string } | null)?.message ?? "");

const nextLink = (link: string | null) => link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];

export function createRest({
  baseUrl,
  graphqlUrl,
  token,
  fetch = globalThis.fetch,
  sleep = (ms) => Bun.sleep(ms),
}: {
  baseUrl: string;
  graphqlUrl: string;
  token: () => Promise<string>;
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
}): Rest {
  const send = async (method: string, url: string, body?: unknown) => {
    for (let attempt = 1; ; attempt++) {
      const headers: Record<string, string> = {
        authorization: `Bearer ${await token()}`,
        accept: "application/vnd.github+json",
      };
      if (body !== undefined) headers["content-type"] = "application/json";
      const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      const data: unknown = text ? JSON.parse(text) : undefined;
      if (response.ok) return { data, link: response.headers.get("link") };

      const retryable = response.status >= 500 || response.status === 429 || isSecondaryRateLimit(response.status, data);
      if (!retryable || attempt === MAX_ATTEMPTS) throw new RestError(response.status, data ?? null);
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : BASE_DELAY_MS * 2 ** (attempt - 1));
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
      const { data } = await send("POST", graphqlUrl, { query, variables });
      const result = data as { data: T; errors?: unknown[] };
      if (result.errors?.length) throw new RestError(200, result.errors);
      return result.data;
    },
  };
}
