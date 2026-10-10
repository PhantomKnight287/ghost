# Code standards

Rules for every file in this repository. They are not style preferences; a change that breaks one of them is a change that gets sent back.

## 1. DRY and SOLID

Write a thing once. Two call sites doing the same keyset pagination, the same binary-content sniff, the same permission check means one function and two callers.

Duplication that is about to diverge is not duplication — do not merge two things that happen to look alike today.

Each unit does one thing: a service owns a domain, a module wires it, a controller maps HTTP to it, a DTO describes the wire. A service that spawns `git` and also decides HTTP status codes is two things.

Depend on the narrow thing. A function that needs a git directory takes a git directory, not the repository row it could be read from.

## 2. No reshaping functions

`toCommitDTO`, `toCommentDTO`, `toSummaryOf` and every other `to<format>` helper is banned. A function that takes a record and hands back the same record under different field names is work that should never have existed.

Either the function that produces the data produces the exact fields the caller needs, or it produces nothing and the caller builds the object where it is returned.

```ts
// No: the row is fetched, then renamed.
function toCommitSummary(commit: PathCommit): CommitSummaryDTO {
  return { sha: commit.commitSha, message: commit.subject, committedAt: commit.committedAt.toISOString() };
}

// Yes: the query selects the fields the response is made of.
const [commit] = await this.db
  .select({ sha: schema.commit.sha, message: schema.commit.subject, committedAt: schema.commit.committedAt })
  .from(schema.commit);
```

The same goes for a local builder that assembles a value out of a page's state for another component to consume, such as `repositoriesHref` or `hrefFor` building pagination links. The component that renders the value takes the parts and builds it once, so every page stops writing its own copy.

```tsx
// No: each page builds its own pagination links.
const repositoriesHref = (next?: string) => `/${username}?${new URLSearchParams({ tab: "repositories", ...(next && { cursor: next }) })}`;
<CursorPagination firstHref={repositoriesHref()} nextHref={data.nextCursor ? repositoriesHref(data.nextCursor) : null} isFirstPage={!cursor} />

// Yes: the pagination takes the parts.
<CursorPagination pathname={`/${username}`} params={{ tab: "repositories" }} cursor={cursor} nextCursor={data.nextCursor} />
```

Value conversion is not reshaping: parsing a string into a `Date`, turning a service name into a binary name, formatting a colour for an `<input>`. Those stay.

## 3. Strings are never concatenated for layout

No `'...' + '...'` to keep a line short. This applies to OpenAPI `description`, error messages, log lines, everything.

```ts
// No.
description:
  'Commits signed with it read as verified once the key carries an ' +
  'address this account has verified.',

// Yes.
description: 'Commits signed with it read as verified once the key carries an address this account has verified.',
```

Concatenation is for building a string out of parts that vary — interpolation is preferred there anyway.

## 4. Comments earn their place

A comment explains why, never what. If the code says what it does and the reason is obvious, write no comment.

Ban: paragraph essays above a function, restating the signature, narrating each step, explaining the language, apologising for a decision, or telling a story about the alternative that was rejected — that belongs in `docs/`, as a numbered decision.

Keep: a non-obvious constraint, an invariant a reader cannot see from the code, a reason a surprising line is correct.

```ts
// No.
/**
 * Directories first, then files, each group alphabetical.
 *
 * Submodules are grouped with directories: they are directory-shaped to a
 * reader, whatever git calls them.
 *
 * Partitioning in one pass and sorting the two groups separately beats one
 * comparator that has to check the type on every comparison, but neither is
 * close to being worth optimizing.
 */

// Yes.
/** Directories first, then files, each alphabetical. Submodules sort as directories. */
```

## 5. No wrapped comments or strings

One comment is one line, however long. One string literal is one line, however long. Editors wrap; source does not need to.

```ts
// No.
// The stored expiry doubles as the "last sent" stamp: a token issued less
// than a minute ago still has all but a minute of its life left.

// Yes.
// The stored expiry doubles as the "last sent" stamp: a token issued less than a minute ago still has all but a minute of its life left.
```

Multi-line block comments are allowed only when the lines are genuinely separate items, such as `@param` tags or an example.

## 6. `services/` holds services

A file under `services/` exports an `@Injectable()` class. Nothing else belongs there.

Pure functions, types, error classes, codecs and test fakes live under `lib/`, mirroring the same folder names. `lib/git/tree/list-tree.ts` is a function; `services/git/branches/branches.service.ts` is a service that may call it.

The same applies elsewhere: a folder is named for what it holds, and a file that does not fit the name moves rather than stretching it.

## 7. Production quality is the default

Every branch is reachable and reached in tests, or the branch does not exist. Errors carry a cause the caller can act on. Nothing is left `any`. Nothing ships commented out. Trust boundaries validate, and the check lives where the boundary is, not at each call site.

No speculative abstraction: an interface with one implementation, a factory for one product, or a configuration value that never varies is deleted on sight.

## 8. One file holds one component family

A `.tsx` file exports components that belong together, or a single component. `components/ui/avatar.tsx` holds `Avatar`, `AvatarImage`, `AvatarFallback` and the rest of the avatar family: none of them means anything without the others, so they share a file.

A page is not a family. `ProfileReadme`, `PeopleList`, `PinnedRepositories` and `OrganizationTeamList` in `app/[username]/page.tsx` are unrelated to each other and to the page, so each moves to its own file.

Where the file goes depends on who uses it:

- Used by one route only: next to it, in the same folder as the `page.tsx` that renders it.
- Used by more than one route: under `components/`, in the folder named for its domain.

```tsx
// No: app/[username]/page.tsx
export default async function ProfilePage() { ... }
function PeopleList() { ... }
function PinnedRepositories() { ... }

// Yes: only this route renders them.
// app/[username]/page.tsx
// app/[username]/people-list.tsx
// app/[username]/pinned-repositories.tsx

// Yes: rendered by more than one route.
// components/auth/user/user-avatar.tsx
```

## 9. Look before you write a component

Before adding a component, search `components/` and the route folders for one that already does the job. If it exists, use it; if it almost fits, extend it with a prop rather than writing a sibling that differs by one class name.

Two components that render the same list of avatars and links are a violation of rule 1, however far apart they live.

## 10. Every suspended boundary has a loading state

Anything that waits for data shows a skeleton while it waits. A route segment that fetches gets a `loading.tsx`. An async server component rendered inside a page gets a `<Suspense>` with a skeleton fallback, and the skeleton lives in the same file as the component it stands in for, the way `RepositoryReadme` and `RepositoryReadmeSkeleton` do.

`<Suspense fallback={null}>` is not a loading state: the layout jumps when the content arrives. The skeleton takes the shape and size of what it replaces.

```tsx
// No.
<Suspense fallback={null}>
  <OrganizationTeamList slug={username} />
</Suspense>

// Yes.
<Suspense fallback={<OrganizationTeamListSkeleton />}>
  <OrganizationTeamList slug={username} />
</Suspense>
```


## 11. Changes to Infra or env variables must be propagated to `docker` and `apps/*/Dockerfile`

If a new item to the workspace is added, the apps/*/Dockerfile needs to update else the build fails. and self hosting setup(in /docker) and docs in (apps/docker) needs to be updated too.


## Philosophy

This codebase will outlive you. Every shortcut becomes someone else's burden. Every hack compounds into technical debt that slows the whole team down.

You are not just writing code. You are shaping the future of this project. The patterns you establish will be copied. The corners you cut will be cut again.

Fight entropy. Leave the codebase better than you found it.
