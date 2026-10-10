import type { WebhookBody, WebhookPing } from '../webhooks.js';

/** Who did it, linked to their profile where they have one. */
export type WebhookActor = {
  name: string;
  url: string | null;
  avatarUrl: string | null;
};

export type WebhookCommit = {
  sha: string;
  url: string;
  subject: string;
  author: string;
};

/** What a chat message says about an event, before a format escapes and shapes it. `action`, `excerpt` and commit subjects hold user text, unescaped. */
export type WebhookMessage = {
  /** The repository's or organization's name. */
  context: string;
  /** Null only for a ping, which nobody did. */
  actor: WebhookActor | null;
  /** What happened, after the actor's name: "opened issue #7: Bell count". */
  action: string;
  url: string | null;
  excerpt: string | null;
  /** The newest commits of a push. */
  commits: WebhookCommit[];
  /** Commits pushed beyond those listed. */
  moreCommits: number;
  /** An RGB accent, the way GitHub colours its chat messages. */
  color: number;
  /** ISO 8601, when the event happened. */
  timestamp: string;
};

/** The actor and the action as one sentence, for formats with no author line. */
export function summaryOf({ actor, action }: WebhookMessage) {
  return actor ? `${actor.name} ${action}` : action;
}

// Enough to see the point of a comment in a chat, short enough to keep a channel readable.
const EXCERPT_LENGTH = 500;

// A push lists this many commits; the rest are counted.
const LISTED_COMMITS = 5;

// GitHub's Primer colours: green for something new, purple for merged, red for gone, blue for code and talk, grey for edits.
const GREEN = 0x1f883d;
const PURPLE = 0x8250df;
const RED = 0xcf222e;
const BLUE = 0x0969da;
const GREY = 0x59636e;

const REVIEWS = {
  approved: ['approved', GREEN],
  changes_requested: ['requested changes on', RED],
  commented: ['reviewed', BLUE],
} as const;

export function messageOf(body: WebhookBody | WebhookPing): WebhookMessage {
  if (body.event === 'ping') {
    return {
      context: body.repository?.fullName ?? body.organization?.slug ?? '',
      actor: null,
      action: 'Ghost webhook connected',
      url: null,
      excerpt: `Events: ${body.webhook.events.join(', ')}`,
      commits: [],
      moreCommits: 0,
      color: BLUE,
      timestamp: body.createdAt,
    };
  }

  const { repository, sender } = body;
  const actor: WebhookActor = {
    name: sender?.username ?? 'Someone',
    url: sender?.htmlUrl ?? null,
    avatarUrl: sender?.avatarUrl ?? null,
  };
  const say = (
    action: string,
    color: number,
    url: string | null = repository.htmlUrl,
    excerpt: string | null = null,
  ): WebhookMessage => ({
    context: repository.fullName,
    actor,
    action,
    url,
    excerpt: excerpt?.trim() ? truncate(excerpt.trim()) : null,
    commits: [],
    moreCommits: 0,
    color,
    timestamp: body.createdAt,
  });
  /** A message listing the pushed commits, linked to each one. */
  const pushed = (action: string, url: string): WebhookMessage => {
    const { commits = [] } = body;
    return {
      ...say(action, BLUE, url),
      commits: commits.slice(0, LISTED_COMMITS).map((commit) => ({
        sha: commit.sha,
        url: `${repository.htmlUrl}/commit/${commit.sha}`,
        subject: commit.subject,
        author: commit.authorName,
      })),
      moreCommits: Math.max(commits.length - LISTED_COMMITS, 0),
    };
  };

  const thread = body.issue ?? body.pullRequest;
  const about = thread
    ? `${body.pullRequest ? 'pull request' : 'issue'} #${thread.number}: ${thread.title}`
    : '';
  const onThread = (
    action: string,
    color: number,
    excerpt: string | null = null,
  ) => say(action, color, thread?.htmlUrl ?? repository.htmlUrl, excerpt);

  switch (body.event) {
    case 'push': {
      const [kind, name] = refName(body.ref ?? '');
      if (body.deleted) return say(`deleted ${kind} ${name}`, RED);
      if (body.created)
        return say(
          `created ${kind} ${name}`,
          GREEN,
          `${repository.htmlUrl}/tree/${name}`,
        );
      const [only] = body.commits ?? [];
      return pushed(
        `pushed ${commitCount(body)} to ${name}`,
        body.commits?.length === 1
          ? `${repository.htmlUrl}/commit/${only.sha}`
          : `${repository.htmlUrl}/commits/${name}`,
      );
    }
    case 'issue.opened':
      return onThread(`opened ${about}`, GREEN, thread?.body ?? null);
    case 'issue.edited':
      return onThread(`edited ${about}`, GREY);
    case 'issue.closed':
      return onThread(`closed ${about}`, RED);
    case 'issue.reopened':
      return onThread(`reopened ${about}`, GREEN);
    case 'issue.assigned':
      return onThread(`assigned ${body.assignee?.username} to ${about}`, GREY);
    case 'issue.unassigned':
      return onThread(
        `unassigned ${body.assignee?.username} from ${about}`,
        GREY,
      );
    case 'issue.labeled':
      return onThread(`added the label ${body.label?.name} to ${about}`, GREY);
    case 'issue.unlabeled':
      return onThread(
        `removed the label ${body.label?.name} from ${about}`,
        GREY,
      );
    case 'issue.commented':
      return onThread(
        `commented on ${about}`,
        BLUE,
        body.comment?.body ?? null,
      );
    case 'issue.comment_edited':
      return onThread(
        `edited a comment on ${about}`,
        GREY,
        body.comment?.body ?? null,
      );
    case 'issue.comment_deleted':
      return onThread(`deleted a comment on ${about}`, RED);
    case 'pull_request.ready_for_review':
      return onThread(`marked ${about} ready for review`, GREEN);
    case 'pull_request.converted_to_draft':
      return onThread(`converted ${about} to a draft`, GREY);
    case 'pull_request.merged':
      return onThread(`merged ${about}`, PURPLE);
    case 'pull_request.synchronized':
      return pushed(
        `${body.forced ? 'force-pushed' : 'pushed'} ${commitCount(body)} to ${about}`,
        thread?.htmlUrl ?? repository.htmlUrl,
      );
    case 'pull_request.reviewed': {
      const [verb, color] = REVIEWS[body.review?.state ?? 'commented'];
      return onThread(`${verb} ${about}`, color, body.review?.body ?? null);
    }
    case 'pull_request.review_dismissed':
      return onThread(
        `dismissed a review on ${about}`,
        GREY,
        body.review?.dismissalMessage ?? null,
      );
    case 'pull_request.review_commented':
      return onThread(
        `commented on ${body.comment?.path ?? 'the code'} in ${about}`,
        BLUE,
        body.comment?.body ?? null,
      );
    case 'label.created':
    case 'label.edited':
    case 'label.deleted':
      return say(
        `${body.event.slice('label.'.length)} the label ${body.label?.name}`,
        body.event === 'label.created'
          ? GREEN
          : body.event === 'label.deleted'
            ? RED
            : GREY,
        `${repository.htmlUrl}/labels`,
      );
    case 'release.created':
    case 'release.published':
    case 'release.edited':
    case 'release.deleted':
      return say(
        `${body.event.slice('release.'.length)} the release ${body.release?.name || body.release?.tagName}`,
        body.event === 'release.deleted'
          ? RED
          : body.event === 'release.edited'
            ? GREY
            : GREEN,
        body.release?.htmlUrl ?? `${repository.htmlUrl}/releases`,
        body.event === 'release.deleted' ? null : (body.release?.body ?? null),
      );
    case 'star.created':
      return say(`starred ${repository.fullName}`, GREEN);
    case 'star.deleted':
      return say(`unstarred ${repository.fullName}`, GREY);
    case 'watch.started':
      return say(`started watching ${repository.fullName}`, GREEN);
    case 'fork.created':
      return say(
        `forked ${repository.fullName} to ${body.fork?.fullName}`,
        GREEN,
        body.fork?.htmlUrl,
      );
    case 'repository.edited':
      return say(`edited the settings of ${repository.fullName}`, GREY);
    case 'repository.transferred':
      return say(`transferred ${repository.fullName} from ${body.from}`, GREY);
    case 'member.added':
      return say(
        `accepted the invitation to collaborate on ${repository.fullName}`,
        GREEN,
      );
    case 'member.removed':
      return say(`removed ${body.member?.username} as a collaborator`, RED);
  }
}

/** `refs/heads/main` is the branch main, `refs/tags/v1` the tag v1. */
function refName(ref: string): [kind: string, name: string] {
  if (ref.startsWith('refs/tags/'))
    return ['tag', ref.slice('refs/tags/'.length)];
  return ['branch', ref.replace(/^refs\/heads\//, '')];
}

function truncate(text: string) {
  return text.length > EXCERPT_LENGTH
    ? `${text.slice(0, EXCERPT_LENGTH - 1)}…`
    : text;
}

function commitCount({ commits = [] }: WebhookBody) {
  return `${commits.length} ${commits.length === 1 ? 'commit' : 'commits'}`;
}
