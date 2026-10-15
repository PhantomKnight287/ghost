import { DOCS_URL } from "@/lib/env";

export const DESCRIPTION = "New features and fixes in Ghost, newest first.";

/** Newest first. `body` is Markdown. */
export const CHANGELOG: {
  date: string;
  title: string;
  body: string;
}[] = [
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

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeZone: "UTC",
});

/** `2026-10-07` as `October 7, 2026`. */
export function formatDate(date: string) {
  return DATE_FORMAT.format(new Date(date));
}
