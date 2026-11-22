import { type Rest, RestError } from "../rest.ts";

type Handler = unknown | ((body: unknown) => unknown);
export type Routes = Record<string, Handler>;
export type FakeCall = { method: string; path: string; body?: unknown };
export type FakeRest = Rest & { calls: FakeCall[]; routes: Routes };

/** Query parameters sort, so a route matches however the caller orders them. */
function normalize(path: string) {
  const [pathname, query] = path.split("?");
  if (!query) return pathname ?? "";
  const params = [...new URLSearchParams(query)].sort(([a], [b]) => a.localeCompare(b));
  return `${pathname}?${new URLSearchParams(params)}`;
}

function answer(handler: Handler, body: unknown) {
  return typeof handler === "function" ? (handler as (body: unknown) => unknown)(body) : structuredClone(handler);
}

/** A REST client over a route table keyed `"GET /repos/o/r/issues/1"`. An unknown route answers 404, so every call a test expects must be declared. GraphQL routes are keyed `"GRAPHQL <word in the query>"`. */
export function fakeRest(routes: Routes = {}): FakeRest {
  const calls: FakeCall[] = [];
  const keyed = () => new Map(Object.entries(routes).map(([key, handler]) => {
    const [method, path = ""] = key.split(" ");
    return [`${method} ${method === "GRAPHQL" ? path : normalize(path)}`, handler] as const;
  }));
  const handle = async (method: string, path: string, body?: unknown) => {
    calls.push(body === undefined ? { method, path } : { method, path, body });
    const handler = keyed().get(`${method} ${normalize(path)}`);
    if (handler === undefined) throw new RestError(404, { message: `No route for ${method} ${path}` });
    return answer(handler, body);
  };
  return {
    calls,
    routes,
    request: async <T>(method: string, path: string, body?: unknown) => (await handle(method, path, body)) as T,
    async *paginate<T>(path: string) {
      const page = await handle("GET", path);
      for (const item of page as T[]) yield item;
    },
    graphql: async <T>(query: string, variables: Record<string, unknown>) => {
      const key = [...keyed().keys()].find((candidate) => candidate.startsWith("GRAPHQL ") && query.includes(candidate.slice(8)));
      calls.push({ method: "GRAPHQL", path: key?.slice(8) ?? query, body: variables });
      if (!key) throw new RestError(200, [{ message: "No GraphQL route" }]);
      return answer(keyed().get(key), variables) as T;
    },
  };
}

export function writes(rest: FakeRest) {
  return rest.calls.filter((call) => call.method !== "GET");
}
