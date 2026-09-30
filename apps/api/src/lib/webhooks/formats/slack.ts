import type { WebhookFormat } from './index.js';

/** Slack incoming webhooks: https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks */
export const slack: WebhookFormat = {
  matches: (url) =>
    url.hostname === 'hooks.slack.com' && url.pathname.startsWith('/services/'),
  // Slack honours username and icon_url only for webhooks made before Slack apps; an app's webhook posts as the app.
  render: ({ context, summary, url, excerpt }, sender) => ({
    username: sender.name,
    icon_url: sender.iconUrl,
    text: [
      `[${escape(context)}] ${url ? `<${url}|${escape(summary)}>` : escape(summary)}`,
      ...(excerpt ? [`>${escape(excerpt).replaceAll('\n', '\n>')}`] : []),
    ].join('\n'),
    unfurl_links: false,
  }),
};

// Slack's only escapes; they also keep user text from forming `<!channel>` or a link.
function escape(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
