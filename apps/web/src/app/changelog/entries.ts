import { DOCS_URL } from "@/lib/env";

export const DESCRIPTION = "New features and fixes in Ghost, newest first.";

/** Newest first. `body` is Markdown. */
export const CHANGELOG: {
  date: string;
  title: string;
  body: string;
}[] = [
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
    body: `The pull request page has a Code button with the commands to check the request out locally. See [Checking out pull requests locally](${DOCS_URL}/checking-out-pull-requests-locally).`,
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
