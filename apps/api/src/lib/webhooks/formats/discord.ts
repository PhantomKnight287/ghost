import type { WebhookFormat } from './index.js';
import type { WebhookMessage } from './message.js';

const HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'ptb.discord.com',
  'canary.discord.com',
]);

/** Discord webhooks: https://discord.com/developers/docs/resources/webhook#execute-webhook */
export const discord: WebhookFormat = {
  matches: (url) =>
    HOSTS.has(url.hostname) && url.pathname.startsWith('/api/webhooks/'),
  // Laid out like GitHub's own Discord messages: the actor as the author, `[repo] Action` as the title.
  render: (message, sender) => ({
    username: sender.name,
    avatar_url: sender.iconUrl,
    // user text may say @everyone; nothing it says pings anyone
    allowed_mentions: { parse: [] },
    embeds: [
      {
        ...(message.actor && {
          author: {
            name: message.actor.name,
            ...(message.actor.url && { url: message.actor.url }),
            ...(message.actor.avatarUrl && {
              icon_url: message.actor.avatarUrl,
            }),
          },
        }),
        // Discord's limit for an embed title
        title: `[${message.context}] ${capitalize(message.action)}`.slice(
          0,
          256,
        ),
        ...(message.url && { url: message.url }),
        ...(description(message) && { description: description(message) }),
        color: message.color,
        timestamp: message.timestamp,
      },
    ],
  }),
};

/** Linked commits for a push, the excerpt otherwise. User text in an excerpt renders as the Markdown it was written in. */
function description({ commits, moreCommits, excerpt }: WebhookMessage) {
  if (commits.length === 0) return excerpt;
  return [
    ...commits.map(
      (commit) =>
        `[\`${commit.sha.slice(0, 7)}\`](${commit.url}) ${escape(commit.subject)} - ${escape(commit.author)}`,
    ),
    ...(moreCommits > 0 ? [`and ${moreCommits} more`] : []),
  ].join('\n');
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A commit subject is plain text: `*`, `_` and `[` in it must not turn into Markdown.
function escape(text: string) {
  return text.replace(/[\\`*_~|[\]]/g, '\\$&');
}
