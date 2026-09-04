The decision that actually matters: namespace split

/:username/:repo/info/refs is a greedy root-level route. Registered alongside /repositories, it competes with every current and future REST path, and Nest resolves that by registration order in AppModule.imports — a footgun you'd be re-debugging for months.

Split the namespaces instead, the way GitHub does (api.github.com vs github.com/user/repo.git). You're already half-way there since Better Auth sits at /api/auth:

app.setGlobalPrefix('api', { exclude: [{ path: ':username/:repo/(.*)', method: RequestMethod.ALL }] });

REST lives under /api/*, the root namespace belongs to the Git transport. This is worth doing before the route table grows — it means changing NEXT_PUBLIC_API_URL usage in fetch-client.ts and regenerating openapi.json.

Layout

I'd put this at src/git/, not src/resources/git/. Your resources/ folder means "REST resource, appears in OpenAPI, has DTOs." Git HTTP is a wire protocol — binary streams, pkt-line framing, no JSON, excluded from Swagger. Filing it under resources/ invites people to treat it like one.

src/git/
  git.module.ts
  git-http.controller.ts        # the 3 routes, nothing else
  git-http.service.ts           # resolve repo → authorize → delegate
  git.errors.ts                 # extends your DomainError
  git.constants.ts              # service names, content types
  guards/info/refs?service=git-upload-pack is anonymous for public repos; and a 401 must carry WWW-Authenticate: Basic realm="Ghost" or the client fails instead of prompting for credentials.

Gzip is optional but common. Git sends Content-Encoding: gzip on POST bodies at its discretion. That's a middleware because it has to wrap the stream before the controller reads it.

.git suffix. git clone http://host/user/repo.git and .../repo both need to work — normalize in a small param pipe rather than in every handler.

One thing to flag: repository lookup here is by owner + slug, and your getRepositoryBySlug currently returns void (it only throws or doesn't). The transport needs the actual row to resolve the storage path, so that method wants a real return value before you build on it — related to the inverted collision check I mentioned earlier.

Want me to scaffold the module and guard, or write up the info/refs pkt-line advertisement specifically?

✻ Churned for 1m 7s · done 2:09 PM

❯ ➜ git push  -u origin main
  fatal: repository 'http://localhost:3001/phantomknight287/ghost.git/' not found

  what

  Read 1 file, ran 1 shell command
Interrupted · What should Claude do instead?

❯ now read

  ➜ git push  -u origin main
  fatal: Could not read from remote repository.

  Please make sure you have the correct access rights
  and the repository exists.

  i get this but OptionalAuth means no auth is needed so idk tell me

  Searched for 1 pattern

Found it. Let me confirm with a real request before explaining.

  Ran 2 shell commands

Confirmed — 35 bytes, and the refs advertisement is entirely absent. The body is only the service header and flush packet.

  Ran 2 shell commands

Now the real test — an actual push:

  Pushed to main, ran 2 shell commands
bodyParser: false is already set in main.ts — you're safe today, and this is the reason to keep it that way. If you ever re-enable it for the REST side, scope it per-route, or express.json() will consume the packfile stream before your handler sees it.

Auth diverges from the rest of the app. Git CLI sends HTTP Basic, not your session cookie, so git-auth.guard.ts can't reuse the Better Auth session guard. Three rules it encodes: git-receive-pack always requires auth; info/refs?service=git-upload-pack is anonymous for public repos; and a 401 must carry WWW-Authenticate: Basic realm="Ghost" or the client fails instead of prompting for credentials.

Gzip is optional but common. Git sends Content-Encoding: gzip on POST bodies at its discretion. That's a middleware because it has to wrap the stream before the controller reads it.

.git suffix. git clone http://host/user/repo.git and .../repo both need to work — normalize in a small param pipe rather than in every handler.

One thing to flag: repository lookup here is by owner + slug, and your getRepositoryBySlug currently returns void (it only throws or doesn't). The transport needs the actual row to resolve the storage path, so that method wants a real return value before you build on it — related to the inverted collision check I mentioned earlier.

Want me to scaffold the module and guard, or write up the info/refs pkt-line advertisement specifically?
