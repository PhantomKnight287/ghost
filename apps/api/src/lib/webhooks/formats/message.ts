import type { WebhookBody, WebhookPing } from '../webhooks.js';

/** What a chat message says about an event, before a format escapes and shapes it. `summary` and `excerpt` hold user text, unescaped. */
export type WebhookMessage = {
  /** The repository's or organization's name. */
  context: string;
  summary: string;
  url: string | null;
  excerpt: string | null;
};

// Enough to see the point of a comment in a chat, short enough to keep a channel readable.
const EXCERPT_LENGTH = 500;

// A push lists this many commits; the rest are counted.
const LISTED_COMMITS = 5;

const REVIEW_VERBS = {
  approved: 'approved',
  changes_requested: 'requested changes on',
  commented: 'reviewed',
} as const;

export function messageOf(body: WebhookBody | WebhookPing): WebhookMessage {
  if (body.event === 'ping') {
    return {
      context: body.repository?.fullName ?? body.organization?.slug ?? '',
      summary: 'Ghost webhook connected',
      url: null,
      excerpt: `Events: ${body.webhook.events.join(', ')}`,
    };
  }

  const { repository } = body;
  const actor = body.sender?.username ?? 'Someone';
  const say = (
    summary: string,
    url: string | null = repository.htmlUrl,
    excerpt: string | null = null,
  ): WebhookMessage => ({
    context: repository.fullName,
    summary: `${actor} ${summary}`,
    url,
    excerpt: excerpt?.trim() ? truncate(excerpt.trim()) : null,
  });

  const thread = body.issue ?? body.pullRequest;
  const about = thread
    ? `${body.pullRequest ? 'pull request' : 'issue'} #${thread.number}: ${thread.title}`
    : '';
  const onThread = (summary: string, excerpt: string | null = null) =>
    say(summary, thread?.htmlUrl ?? repository.htmlUrl, excerpt);

  switch (body.event) {
    case 'push': {
      const [kind, name] = refName(body.ref ?? '');
      if (body.deleted) return say(`deleted ${kind} ${name}`);
      const url = `${repository.htmlUrl}/tree/${name}`;
      if (body.created) return say(`created ${kind} ${name}`, url);
      const commits = body.commits ?? [];
      const listed = commits
        .slice(0, LISTED_COMMITS)
        .map((commit) => `${commit.sha.slice(0, 7)} ${commit.subject}`);
      if (commits.length > LISTED_COMMITS) {
        listed.push(`and ${commits.length - LISTED_COMMITS} more`);
      }
      return say(
        `pushed ${commits.length} ${commits.length === 1 ? 'commit' : 'commits'} to ${name}`,
        url,
        listed.join('\n'),
      );
    }
    case 'issue.opened':
      return onThread(`opened ${about}`, thread?.body ?? null);
    case 'issue.edited':
      return onThread(`edited ${about}`);
    case 'issue.closed':
      return onThread(`closed ${about}`);
    case 'issue.reopened':
      return onThread(`reopened ${about}`);
    case 'issue.assigned':
      return onThread(`assigned ${body.assignee?.username} to ${about}`);
    case 'issue.unassigned':
      return onThread(`unassigned ${body.assignee?.username} from ${about}`);
    case 'issue.labeled':
      return onThread(`added the label ${body.label?.name} to ${about}`);
    case 'issue.unlabeled':
      return onThread(`removed the label ${body.label?.name} from ${about}`);
    case 'issue.commented':
      return onThread(`commented on ${about}`, body.comment?.body ?? null);
    case 'issue.comment_edited':
      return onThread(
        `edited a comment on ${about}`,
        body.comment?.body ?? null,
      );
    case 'issue.comment_deleted':
      return onThread(`deleted a comment on ${about}`);
    case 'pull_request.ready_for_review':
      return onThread(`marked ${about} ready for review`);
    case 'pull_request.converted_to_draft':
      return onThread(`converted ${about} to a draft`);
    case 'pull_request.merged':
      return onThread(`merged ${about}`);
    case 'pull_request.reviewed':
      return onThread(
        `${REVIEW_VERBS[body.review?.state ?? 'commented']} ${about}`,
        body.review?.body ?? null,
      );
    case 'pull_request.review_dismissed':
      return onThread(
        `dismissed a review on ${about}`,
        body.review?.dismissalMessage ?? null,
      );
    case 'pull_request.review_commented':
      return onThread(
        `commented on ${body.comment?.path ?? 'the code'} in ${about}`,
        body.comment?.body ?? null,
      );
    case 'label.created':
    case 'label.edited':
    case 'label.deleted':
      return say(
        `${body.event.slice('label.'.length)} the label ${body.label?.name}`,
        `${repository.htmlUrl}/labels`,
      );
    case 'release.created':
    case 'release.published':
    case 'release.edited':
    case 'release.deleted':
      return say(
        `${body.event.slice('release.'.length)} the release ${body.release?.name || body.release?.tagName}`,
        body.release?.htmlUrl ?? `${repository.htmlUrl}/releases`,
        body.event === 'release.deleted' ? null : (body.release?.body ?? null),
      );
    case 'star.created':
      return say(`starred ${repository.fullName}`);
    case 'star.deleted':
      return say(`unstarred ${repository.fullName}`);
    case 'watch.started':
      return say(`started watching ${repository.fullName}`);
    case 'fork.created':
      return say(
        `forked ${repository.fullName} to ${body.fork?.fullName}`,
        body.fork?.htmlUrl,
      );
    case 'repository.edited':
      return say(`edited the settings of ${repository.fullName}`);
    case 'repository.transferred':
      return say(`transferred ${repository.fullName} from ${body.from}`);
    case 'member.added':
      return say(
        `accepted the invitation to collaborate on ${repository.fullName}`,
      );
    case 'member.removed':
      return say(`removed ${body.member?.username} as a collaborator`);
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
