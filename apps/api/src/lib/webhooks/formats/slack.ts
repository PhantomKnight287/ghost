import type { WebhookFormat } from './index.js';
import { summaryOf } from './message.js';

/** Slack incoming webhooks: https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks */
export const slack: WebhookFormat = {
  matches: (url) =>
    url.hostname === 'hooks.slack.com' && url.pathname.startsWith('/services/'),
  // Slack honours username and icon_url only for webhooks made before Slack apps; an app's webhook posts as the app.
  render: (message, sender) => {
    const summary = escape(summaryOf(message));
    const quoted = message.commits.length
      ? [
          ...message.commits.map(
            (commit) =>
              `<${commit.url}|\`${commit.sha.slice(0, 7)}\`> ${escape(commit.subject)} - ${escape(commit.author)}`,
          ),
          ...(message.moreCommits > 0
            ? [`and ${message.moreCommits} more`]
            : []),
        ].join('\n')
      : message.excerpt && escape(message.excerpt);
    return {
      username: sender.name,
      icon_url: sender.iconUrl,
      text: [
        `[${escape(message.context)}] ${message.url ? `<${message.url}|${summary}>` : summary}`,
        ...(quoted ? [`>${quoted.replaceAll('\n', '\n>')}`] : []),
      ].join('\n'),
      unfurl_links: false,
    };
  },
};

// Slack's only escapes; they also keep user text from forming `<!channel>` or a link.
function escape(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
