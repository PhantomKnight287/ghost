# Pull Request Commit View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening a commit from a pull request's Commits tab shows that commit's diff inside the pull request, with the review threads left on that commit.

**Architecture:** A new web route, `pull/[number]/commits/[sha]`, under the existing pull request layout. It reads the commit from the head repository as the Commits tab already does. Threads whose `commitSha` is this commit are drawn on the diff where their line exists in it. The others are listed above the diff. Placement is a pure function over the commit's patch text. Web only: no API change.

**Tech Stack:** Next.js app router (server components), `@pierre/diffs` through `FileDiffs`, `bun test` for pure functions in `apps/web`.

**Spec:** Ghost issue #81, https://web.ghost.procrastinator.fyi/ghost/ghost/issues/81

## Global Constraints

- Route: `/<owner>/<repo>/pull/<n>/commits/<sha>`. The Commits tab stays active on it.
- The commit is read from the head repository, or from the base when the head repository is gone. This is the same rule as `pull/[number]/commits/page.tsx`.
- A `<sha>` that is not one of the pull request's commits → `notFound()`.
- Read-only: no new comments from this view. Replies on existing threads work, because `ReviewThread` already has its own reply box.
- A thread is drawn on the diff only on the `additions` side, and only if its `line` falls inside one of that file's hunks in the commit's own patch. Every other thread on this commit goes in the list above the diff.
- Follow `docs/code-standards.md`: one-line comments, pure code in `src/lib/`.

## Review Focus

- **Deletions-side threads:** the line numbers count from the pull request's base, not from this commit's parent, so drawing them could put them on the wrong line. They always go in the list. Task 1 tests this.
- **Multi-line threads** (`startLine`…`line`): placed by `line`, the end of the range, which is where `ReviewDiff` anchors them. Task 1 tests this.
- **A renamed file:** the patch header names the new path, and threads carry the new path. Parse `+++ b/<path>`, not `diff --git`. Task 1 tests this.
- **A pull request with more than 100 commits:** a `<sha>` past the first page 404s. Marked `ponytail:` in Task 3.
- **The viewer's pending comments:** these sit on the current head, so they show only on the head commit's view. They are included with `pending` set. Task 3 tests this manually.

---

### Task 1: Thread placement over a patch

**Files:**
- Create: `apps/web/src/lib/review-placement.ts`
- Test: `apps/web/src/lib/review-placement.test.ts`

**Interfaces:**
- Produces:
  - `additionRanges(patch: string): Map<string, [start: number, end: number][]>`: the new-file line ranges of each file's hunks, keyed by the `+++ b/` path. A deleted file (`+++ /dev/null`) has no entry.
  - `placeThreads<T extends { path: string; side: "additions" | "deletions"; line: number }>(threads: T[], patch: string): { placed: T[]; unplaced: T[] }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "bun:test";
import { additionRanges, placeThreads } from "./review-placement";

const patch = `diff --git a/src/greet.js b/src/greet.js
--- a/src/greet.js
+++ b/src/greet.js
@@ -1,5 +1,13 @@
 export function greet(name) {
-  return "Hello, " + name;
+  if (!name) {
@@ -40 +48,2 @@ export function farewell(name) {
+  x
+  y
diff --git a/old.js b/renamed.js
similarity index 90%
--- a/old.js
+++ b/renamed.js
@@ -3,2 +3,3 @@
 a
+b
 c
diff --git a/gone.js b/gone.js
--- a/gone.js
+++ /dev/null
@@ -1,2 +0,0 @@
-a
-b
`;

describe("additionRanges", () => {
  it("reads each hunk's new-file range, defaulting a missing count to 1", () => {
    expect(additionRanges(patch).get("src/greet.js")).toEqual([[1, 13], [48, 49]]);
  });
  it("keys a renamed file by its new path and skips a deleted one", () => {
    expect(additionRanges(patch).get("renamed.js")).toEqual([[3, 5]]);
    expect(additionRanges(patch).has("gone.js")).toBe(false);
  });
});

describe("placeThreads", () => {
  const at = (path: string, line: number, side: "additions" | "deletions" = "additions") => ({ path, line, side });
  it("places an additions thread whose line is inside a hunk", () => {
    const { placed, unplaced } = placeThreads([at("src/greet.js", 9), at("src/greet.js", 20)], patch);
    expect(placed).toEqual([at("src/greet.js", 9)]);
    expect(unplaced).toEqual([at("src/greet.js", 20)]);
  });
  it("never places a deletions-side thread or one on a file the commit does not touch", () => {
    const { placed } = placeThreads([at("src/greet.js", 2, "deletions"), at("other.js", 1)], patch);
    expect(placed).toEqual([]);
  });
});
```

The multi-line case is covered because a range thread is just its `line`, so no separate assertion is needed.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/web && bun test src/lib/review-placement.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both functions in `apps/web/src/lib/review-placement.ts`**

Scan the patch line by line. `+++ b/<path>` sets the current path, and `+++ /dev/null` clears it. Each `@@ -a[,b] +c[,d] @@` pushes `[c, c + (d ?? 1) - 1]` for the current path. Skip a hunk with `d === 0`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/web && bun test src/lib/review-placement.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/review-placement.ts apps/web/src/lib/review-placement.test.ts
git commit -m "place review threads on the lines a commit's patch shows"
```

### Task 2: Shared pieces: commit header, thread card, commit links

**Files:**
- Create: `apps/web/src/components/repositories/commit-header.tsx`, extracted from `apps/web/src/app/[username]/[repo]/commit/[hash]/page.tsx:29-55`
- Modify: `apps/web/src/app/[username]/[repo]/commit/[hash]/page.tsx`: use `CommitHeader`
- Modify: `apps/web/src/components/pull-requests/review.tsx:121-142`: extract the bordered thread block into an exported `ThreadCard`
- Modify: `apps/web/src/components/repositories/commit-list.tsx`: replace `commitBase` with `commitHref`
- Modify: `apps/web/src/app/[username]/[repo]/commits/[...ref]/page.tsx:57` and `apps/web/src/app/[username]/[repo]/pull/[number]/commits/page.tsx`
- Modify: `apps/web/src/app/[username]/[repo]/pull/[number]/pull-request-nav.tsx:30`

**Interfaces:**
- Produces:
  - `CommitHeader({ commit, browseHref, children? }: { commit: CommitDetail; browseHref: string; children?: ReactNode })`. `CommitDetail` is the `/commits/{sha}` response type. `children` renders at the right of the title row, which is where Task 3 puts its prev/next links.
  - `ThreadCard({ thread, headSha, pending?, ...viewing })`: the path/lines header, the `Outdated` badge, the `DiffHunk`, then `ReviewThread`. It renders exactly as the timeline does today.
  - `CommitList` prop `commitHref: string`. A row links to `${commitHref}/${sha}`. Both links in a row, the subject and the short sha, use it.

- [ ] **Step 1: Extract `CommitHeader` and `ThreadCard`, and switch `ReviewItem` and the commit page to them**

The output of both is unchanged.

- [ ] **Step 2: Change the `CommitList` prop and its callers**

- The repository commits page passes `` `/${username}/${repo}/commit` ``.
- The pull request Commits tab passes `` `/${username}/${repo}/pull/${number}/commits` ``.
- The tab's `commitBase` computation now moves to Task 3's page. Keep it here only if something else still uses it.

- [ ] **Step 3: Make the Commits tab active on nested paths**

`active={tab.label === "Commits" ? pathname.startsWith(tab.href) : pathname === tab.href}`

- [ ] **Step 4: Verify**

Run: `cd apps/web && bunx tsc --noEmit && bunx eslint src/components src/app/\[username\]/\[repo\]`
Expected: no errors.

Then load `/demoalice/review-demo/pull/1` and `/demoalice/review-demo/commit/1da7028`. Both should look exactly as before.

- [ ] **Step 5: Commit**

```bash
git commit -am "share the commit header and review thread card; link pull request commits inside the pull request"
```

### Task 3: The pull request commit page

**Files:**
- Create: `apps/web/src/app/[username]/[repo]/pull/[number]/commits/[sha]/page.tsx`
- Create: `apps/web/src/app/[username]/[repo]/pull/[number]/commits/[sha]/loading.tsx`, copied from `../loading.tsx`

**Interfaces:**
- Consumes: `placeThreads` (Task 1). `CommitHeader`, `ThreadCard` and `CommitList.commitHref` (Task 2). `ReviewThread`, `FileDiffs`, `CommitChecks`.

- [ ] **Step 1: Load the data**

Fetch these in parallel:
- the pull request
- `pulls/{number}/commits` with `limit: 100`
- the timeline
- the pending review, when signed in

Then:
- Resolve the commit repository: the head, or the base when the head is gone, as in the Commits tab.
- If `<sha>` is not in the commits → `notFound()`. Add `// ponytail: first 100 commits only; page through when a request outgrows it.`
- Fetch `/api/repositories/{owner}/{slug}/commits/{sha}`, plus that repository's `/commits/{sha}/patch` as text, server-side.

- [ ] **Step 2: Gather the threads on this commit**

Take every submitted review's comments with `commitSha === sha`, plus the pending review's. Remember which ones are pending. Pass them through `placeThreads(threads, patchText)`.

- [ ] **Step 3: Render, top to bottom**

1. `CommitHeader`, with `browseHref` set to the tree at the sha. Its `children` are "Commit i of n" with previous and next links to sibling commits in the pull request. The list is newest first, so "previous" is the next index.
2. `CommitChecks`.
3. If `unplaced` is non-empty: the heading "Comments on lines outside this commit's changes", then one `ThreadCard` per thread.
4. `FileDiffs` with the commit patch URL. Pass `annotations` built from `placed` as `ReviewDiff` builds them: `{ side, lineNumber: line, metadata: <ReviewThread …/> }` keyed by path, with `pending` set for pending threads.

- [ ] **Step 4: Verify in the browser** against the local `demoalice/review-demo#1`. Take screenshots with the scratchpad Playwright script.

- `/pull/1/commits/1da7028d85b3c48cd8e41c73500deb0c6841b74f`: the "lines 2–4" thread is drawn at line 4 and the "line 9" thread at line 9. The list above the diff is absent. The Commits tab is active, and the page reads "Commit 2 of 2".
- `/pull/1/commits/727c54d1ca8e5af931e9cb6ab894bd46b5d40a3b`: the line 10 thread is drawn, or listed above the diff if 727c54d's hunk does not cover line 10.
- `/pull/1/commits/0000000000000000000000000000000000000000` → 404.
- The Commits tab rows link to the new route.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\[username\]/\[repo\]/pull/\[number\]/commits/\[sha\]
git commit -m "show a pull request's commit with the review threads left on it"
```
