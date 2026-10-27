import { DOCS_URL } from "@/lib/env";

export const DESCRIPTION = "New features and fixes in Ghost, newest first.";

/** Newest first. `body` is Markdown. */
export const CHANGELOG: {
  date: string;
  title: string;
  body: string;
}[] = [
  {
    date: "2026-10-27",
    title: "Repositories through GitHub's REST API",
    body: "GitHub's routes to list, edit and delete repositories work against Ghost. `GET /user/repos` lists everything you hold a role on, private repositories included, filtered by `visibility`, `affiliation` or `type`. `GET /users/{username}/repos` lists an account's public repositories, and `GET /orgs/{org}/repos` an organization's. All three sort and page as GitHub does. `PATCH /repos/{owner}/{repo}` renames a repository and changes its description, visibility or default branch, and `DELETE /repos/{owner}/{repo}` deletes it with a token that holds `delete_repo`.",
  },
  {
    date: "2026-10-27",
    title: "A complete API reference",
    body: "`/openapi.json` describes the response of every GitHub-compatible route, so code generators produce typed clients for the whole API. It also documents GitHub's error body, which routes take a token or a session and which work signed out, and the limits on label names and colours.",
  },
  {
    date: "2026-10-27",
    title: "Label names ignore case",
    body: "Label names are unique in a repository ignoring case, as on GitHub: `Bug` and `bug` cannot both exist, and `…/labels/BUG` finds `bug`. A name with leading or trailing spaces, or one that is `.` or `..`, is refused instead of being trimmed without a word. Imports from GitHub attach a label the repository already has in another case.",
  },
  {
    date: "2026-10-26",
    title: "Rate limits",
    body: "Every account gets 120 API requests a minute, shared by its tokens and sessions across Ghost's API and GitHub's REST and GraphQL, and searches draw from a smaller budget of their own. Responses carry GitHub's `X-RateLimit-*` headers, so tools such as the Terraform provider pace themselves, and a 429 says when to retry. Git over HTTP and SSH has its own budget, and sign-in, sign-up and password resets are limited per address.",
  },
  {
    date: "2026-10-25",
    title: "Personal access tokens on Ghost's API",
    body: "Personal access tokens work on Ghost's own API as well as the GitHub-compatible one: send `Authorization: Bearer <token>` and the request acts as the token's owner. Account security settings such as emails, keys and OAuth apps still need a signed-in browser session.",
  },
  {
    date: "2026-10-25",
    title: "Names match in any case",
    body: "User names, organization names and repository names are matched ignoring case, as on GitHub, in URLs, the API, GraphQL and git. `/PippinMole/Ghost` and `/pippinmole/ghost` open the same repository, and two repositories in one account can no longer differ only by case.",
  },
  {
    date: "2026-10-23",
    title: "Required status checks and signed commits",
    body: `Two more ruleset rules. **Required status checks** refuse a push and block a merge until the commit has passed every named check, optionally only once the branch is up to date with its base. **Required signatures** refuse any commit that does not verify. \`gh pr checks --required\` lists the required checks.`,
  },
  {
    date: "2026-10-23",
    title: "SSH signing keys",
    body: `Sign commits with an SSH key. Signing keys are kept apart from the keys you push with: add them in Settings, or with \`gh ssh-key add --type signing\`. See [Adding an SSH signing key](${DOCS_URL}/signing/adding-an-ssh-signing-key).`,
  },
  {
    date: "2026-10-23",
    title: "Rule insights and evaluate mode",
    body: "Every push and merge a ruleset checks is recorded: who wrote, to which ref, and what each rule decided. Admins read the record under Settings → Rules → Insights, filtered by ruleset, ref, actor, result and time, or through GitHub's rule suites API. A ruleset in **evaluate** mode checks every write the same way but never refuses one, so you can see what a rule would block before turning it on.",
  },
  {
    date: "2026-10-23",
    title: "Pull request rules",
    body: "A ruleset can require changes to go through a pull request, with a number of approvals, code owner review, approval of the latest push, resolved conversations and a choice of merge methods. Stale approvals can be dismissed on new pushes. The merge box lists every requirement still unmet, and people allowed to bypass the ruleset can merge anyway, which leaves an entry on the timeline.",
  },
  {
    date: "2026-10-23",
    title: "Newer goes back one page",
    body: "On every paged list, **Newer** steps back one page instead of jumping to the first.",
  },
  {
    date: "2026-10-22",
    title: "Faster file pages",
    body: "Opening a file takes fewer steps in a row: its history is looked up while the file is read, and a branch is found without listing every branch and tag.",
  },
  {
    date: "2026-10-20",
    title: "Markdown for agents, richer Discord previews",
    body: "Ask for any public profile, repository, issue, pull request or release list with `Accept: text/markdown` and Ghost answers in Markdown, comments and README included. `/llms.txt` tells AI agents what Ghost serves, and `/openapi.json` describes the API. Links pasted in Discord show the title, state, stats and buttons to open the page.",
  },
  {
    date: "2026-10-20",
    title: "Branch and tag rulesets",
    body: "Repository rulesets protect branches and tags: restrict creating, updating or deleting them, block force pushes and require linear history. Rulesets target refs by pattern, can be switched off without deleting them, and let chosen roles, teams or organization admins bypass them. A push that breaks a rule is refused with the rule and ruleset it broke. Set them up under Settings → Rules; protected branches and tags show a badge, and GitHub's rulesets REST API works against Ghost.",
  },
  {
    date: "2026-10-19",
    title: "Review requests and CODEOWNERS",
    body: `Request reviews from people and teams on a pull request, and re-request them after changes. A \`CODEOWNERS\` file in \`.ghost/\`, \`.github/\`, \`docs/\` or the repository root requests the owners of changed files automatically. Review requests show on your dashboard and in notifications, pull request lists filter by them, and \`gh pr create --reviewer\` and \`gh pr edit --add-reviewer\` work. See [Review requests](${DOCS_URL}/pull-requests/review-requests).`,
  },
  {
    date: "2026-10-17",
    title: "A clearer merge box",
    body: "The merge box sits above the comment box and is split into sections. Checks fold into one summary line that opens while any is not passing, and a merged or closed pull request says which branch went where, linking the merge commit.",
  },
  {
    date: "2026-10-17",
    title: "Review comments on a pull request's commits",
    body: "A commit opened from a pull request's Commits tab stays inside the pull request and shows the review threads left on it, on the lines they were written against. Previous and next links step through the pull request's commits.",
  },
  {
    date: "2026-10-17",
    title: "Upload attachments with a token",
    body: `API tokens can upload attachments for issues and comments, through GitHub's user-attachments route, so scripts and tools can put a screenshot in an issue. See [GitHub CLI](${DOCS_URL}/github-cli).`,
  },
  {
    date: "2026-10-16",
    title: "Commit statuses",
    body: "External CI and bots can report results on a commit through GitHub's commit status API. Statuses show on pull requests, commits and commit lists, `gh pr checks` lists them, and a `commit_status.created` webhook fires for each one.",
  },
  {
    date: "2026-10-16",
    title: "Start a repository from templates",
    body: "Create a repository with a README, a `.gitignore` template and a license, landed as its first commit. `gh repo create --add-readme --gitignore Go --license mit` works too.",
  },
  {
    date: "2026-10-16",
    title: "More fields in gh pr view --json",
    body: "`gh pr view --json` answers six fields it used to reject: `mergeCommit`, `mergedBy`, `baseRefOid`, `potentialMergeCommit`, `fullDatabaseId` and `closingIssuesReferences`.",
  },
  {
    date: "2026-10-15",
    title: "Two-factor authentication and passkeys",
    body: "Protect your account with an authenticator app, with backup codes for when you lose it, and sign in with a passkey instead of a password. Set both up under Settings → Security.",
  },
  {
    date: "2026-10-15",
    title: "Link to a comment",
    body: "Every comment has a menu with **Copy link**, next to Edit and Delete. Opening the link scrolls to the comment and highlights it, and the links match the ones GitHub's API returns.",
  },
  {
    date: "2026-10-15",
    title: "Review comments through GitHub's REST API",
    body: "Tokens can read and write line comments and reviews through GitHub's REST API: comment on a line of any commit in a pull request, reply in a thread, and start, submit or delete a review.",
  },
  {
    date: "2026-10-15",
    title: "Git submodules",
    body: `Submodules show the commit they are pinned to and link to their repository, at that commit on Ghost, GitHub, GitLab, Codeberg and other well-known hosts. Diffs show a moved submodule as its old and new commit, and \`git clone --recurse-submodules\` fetches private submodules on the same instance with the same credentials. See [Git submodules](${DOCS_URL}/submodules).`,
  },
  {
    date: "2026-10-13",
    title: "Download source code",
    body: "Download any branch, tag or commit as a zip or tarball from the Code button. Every release lists its source code archives with their size and download count, and `gh release download --archive` works against Ghost.",
  },
  {
    date: "2026-10-13",
    title: "Crawler rules",
    body: "Search engines index repositories, issues and pull requests, and skip the endless commit, file and download pages. The API asks crawlers to stay out entirely.",
  },
  {
    date: "2026-10-12",
    title: "Pull request links on push",
    body: "Pushing a branch prints a link to open a pull request for it, and the matching `gh pr create` command; a branch that already has an open pull request links to it instead.",
  },
  {
    date: "2026-10-12",
    title: "Clone URLs open the repository",
    body: "Opening a repository's clone URL in a browser takes you to the repository page instead of an error.",
  },
  {
    date: "2026-10-12",
    title: "Mention icons show state",
    body: 'A "mentioned this" entry on an issue or pull request timeline is coloured by the state of the thread it came from: open, closed or merged.',
  },
  {
    date: "2026-10-12",
    title: "OAuth app access restrictions",
    body: `Organizations can require an admin to approve an OAuth app before it reaches their repositories. Members ask for an app, and admins approve or deny it from organization settings. See [Managing access](${DOCS_URL}/oauth-apps/managing-access).`,
  },
  {
    date: "2026-10-12",
    title: "Releases from the GitHub CLI",
    body: `\`gh release\` works against Ghost: create, edit, list, view and delete releases, and upload and download their assets. See [GitHub CLI](${DOCS_URL}/github-cli).`,
  },
  {
    date: "2026-10-12",
    title: "Learn how Ghost works",
    body: "A new guide walks contributors through how Ghost works inside, so they can find their way around the code before making a change.",
  },
  {
    date: "2026-10-11",
    title: "Pull requests from the GitHub CLI",
    body: `\`gh pr\` works against Ghost: list, view, create, edit, check out, merge, close and reopen pull requests, and mark them ready or draft. See [GitHub CLI](${DOCS_URL}/github-cli).`,
  },
  {
    date: "2026-10-11",
    title: "GitHub's REST API for issues",
    body: "Ghost serves GitHub's REST routes for issues, comments, labels and assignees, with GitHub's paging, so `gh label`, `gh api --paginate` and typed SDKs such as octokit and PyGithub work against it.",
  },
  {
    date: "2026-10-11",
    title: "GitHub CLI support, checked against gh",
    body: "Every request the GitHub CLI makes in Ghost's tests is recorded, and CI fails when gh asks for something Ghost does not serve.",
  },
  {
    date: "2026-10-10",
    title: "OAuth apps",
    body: `Register OAuth apps in your account settings and let people sign in to them with their Ghost account, through the browser or the device flow. See [OAuth apps](${DOCS_URL}/oauth-apps).`,
  },
  {
    date: "2026-10-10",
    title: "Expiring tokens for OAuth apps",
    body: `An OAuth app can make its tokens expire after 8 hours and hand out refresh tokens, the way GitHub does. See [Refreshing tokens](${DOCS_URL}/oauth-apps/refreshing-tokens).`,
  },
  {
    date: "2026-10-10",
    title: "Sign in to the GitHub CLI from the browser",
    body: `\`gh auth login --web\`, \`gh auth refresh\` and \`gh auth setup-git\` work against Ghost. Tokens carry GitHub's scopes, and Ghost enforces them. See [GitHub CLI](${DOCS_URL}/github-cli).`,
  },
  {
    date: "2026-10-10",
    title: "Richer webhook payloads",
    body: `Webhook deliveries formatted for chat carry more detail about the event. See [Webhooks](${DOCS_URL}/webhooks).`,
  },
  {
    date: "2026-10-09",
    title: "The GitHub CLI",
    body: `Point the GitHub CLI at Ghost with \`GH_HOST\` to view, clone and create repositories, work with issues, manage SSH keys and call \`gh api\`. Ghost serves GitHub's GraphQL and REST APIs for them. See [GitHub CLI](${DOCS_URL}/github-cli).`,
  },
  {
    date: "2026-10-09",
    title: "Co-authors count as contributors",
    body: "Everyone named in a commit's `Co-authored-by` trailers is counted as a contributor to the repository, and each commit is counted once.",
  },
  {
    date: "2026-10-09",
    title: "Fewer release webhooks",
    body: "Editing a release sends a `release.edited` webhook only when something actually changed.",
  },
  {
    date: "2026-10-08",
    title: "Link previews for releases",
    body: "Sharing a repository's releases, or a single release, now shows a preview card with its name, notes, author and assets. Every preview card has a new look to match the rest of Ghost.",
  },
  {
    date: "2026-10-08",
    title: "Find files and browse the tree",
    body: "Press `t` or choose Go to file on a repository's code view to fuzzy-find any file at the current branch, tag or commit; a match in the file name ranks above one in its directories. A file page shows the repository's files in a sidebar, opened down to the file you are reading, and remembers whether you collapsed it.",
  },
  {
    date: "2026-10-08",
    title: "Several lines in one link",
    body: "A file link highlights several lines with `#L10,L11,L59`, a range with `#L10-L59`, or both at once, and scrolls to the first.",
  },
  {
    date: "2026-10-07",
    title: "Pull request commits in the timeline",
    body: `A pull request's timeline now lists the commits each push added, and marks force pushes with the head they replaced. A push that moves a request's head sends a \`pull_request.synchronized\` [webhook](${DOCS_URL}/webhooks).`,
  },
  {
    date: "2026-10-07",
    title: "Attachments in every Markdown field",
    body: "Issues, pull requests, comments and releases share one Markdown editor. Drop or paste files into it to attach them; HEIC photos are converted to JPEG first, and a draft waits until its uploads finish. The editor suggests people and issues as you type `@` or `#`, fenced code blocks are highlighted, and the assignee picker is searchable.",
  },
  {
    date: "2026-10-06",
    title: "Git LFS",
    body: `Repositories serve Git LFS objects and locks over HTTP and SSH, and files stored with LFS show their contents in the browser. See [Git LFS](${DOCS_URL}/git-lfs).`,
  },
  {
    date: "2026-10-06",
    title: "Storage limits",
    body: "Pushes, forks and release assets each count against a storage quota on the owning account, and git says why when a push is refused. Settings show usage and limits for users and organizations.",
  },
  {
    date: "2026-10-06",
    title: "Organization pages",
    body: "An organization's README appears above its pinned repositories.",
  },
  {
    date: "2026-10-05",
    title: "Sign in with GitHub",
    body: "Sign in or sign up with a GitHub account.",
  },
  {
    date: "2026-10-05",
    title: "Faster code search and large repositories",
    body: "Code search pages its results with infinite scroll, returns up to 2000 matching files and is rate-limited per account. Branch lists are searchable, branches with slashes resolve in every URL, and a `#L` link highlights and scrolls to its line.",
  },
  {
    date: "2026-10-04",
    title: "Importing large repositories",
    body: "The GitHub importer pushes once, runs its phases in parallel and resumes from where it stopped. Large pushes are verified without being held in memory, and Markdown renders the way GitHub renders it.",
  },
  {
    date: "2026-10-03",
    title: "Signed merge commits",
    body: "Merge commits Ghost creates, and suggestions applied from a review, are signed with the instance's key, and GitHub's merge commits verify.",
  },
  {
    date: "2026-10-03",
    title: "Checkout commands on pull requests",
    body: `The pull request page has a Code button with the commands to check the request out locally. See [Checking out pull requests locally](${DOCS_URL}/pull-requests/checking-out-locally).`,
  },
  {
    date: "2026-10-03",
    title: "Push validation",
    body: "A push is verified before it is committed to the repository, and merges are refused once the base account is at its storage quota.",
  },
  {
    date: "2026-10-03",
    title: "Language statistics",
    body: "Repository languages are counted the way GitHub's Linguist counts them, so data files no longer skew the bar.",
  },
  {
    date: "2026-10-01",
    title: "Import from GitHub",
    body: "Import a repository from GitHub along with its issues, pull requests and releases.",
  },
  {
    date: "2026-10-01",
    title: "Self-hosting",
    body: `Ghost ships a Docker Compose stack with setup scripts for bash and PowerShell, and sends mail through local \`sendmail\` when no mail service is configured. See [Self-hosting](${DOCS_URL}/self-hosting).`,
  },
  {
    date: "2026-09-30",
    title: "Webhooks",
    body: `Repositories and organizations send webhooks, with a catalog of events to choose from. Deliveries to Slack, Discord, Google Chat and Teams are posted as chat messages, and a webhook's signing secret can be replaced. See [Receiving webhooks](${DOCS_URL}/webhooks).`,
  },
  {
    date: "2026-09-28",
    title: "Notifications",
    body: "An inbox and thread emails for mentions, team mentions, assignments, comments, reviews and state changes. Subscribe to a thread, or watch or ignore a repository.",
  },
  {
    date: "2026-09-28",
    title: "Branch management",
    body: "Create and delete branches from a repository's branches page.",
  },
  {
    date: "2026-09-28",
    title: "Merge strategies",
    body: "Pull requests merge with a merge commit, a squash or a rebase, and the squash message can be edited before merging.",
  },
  {
    date: "2026-09-27",
    title: "Pull request reviews",
    body: "Approve, comment on or request changes to a pull request. Conflicting files are named when a request cannot merge cleanly.",
  },
  {
    date: "2026-09-27",
    title: "Tags and releases",
    body: "Create tags and releases, and attach assets to a release.",
  },
  {
    date: "2026-09-26",
    title: "Organizations",
    body: "Organizations share the user namespace and come with teams, base permissions and repository transfers.",
  },
  {
    date: "2026-09-26",
    title: "Collaborators",
    body: "Invite collaborators to a repository and give each a role.",
  },
  {
    date: "2026-09-26",
    title: "Repository settings",
    body: "A Settings tab to rename a repository and change its description, visibility and default branch. Deleting a repository purges everything it stored.",
  },
  {
    date: "2026-09-25",
    title: "Issue and pull request references",
    body: "Issues and pull requests that mention each other show the reference in their timelines, and closing keywords such as `fixes #12` close the issue they name.",
  },
];

/** Newest first. A release holds the entries dated on or before its own date and after the release below it. */
export const RELEASES: { version: string; date: string }[] = [
  { version: "v0.4.0", date: "2026-10-27" },
  { version: "v0.3.0", date: "2026-10-13" },
];

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});

/** `2026-10-07` as `October 7, 2026`. */
export function formatDate(date: string) {
  return DATE_FORMAT.format(new Date(date));
}
