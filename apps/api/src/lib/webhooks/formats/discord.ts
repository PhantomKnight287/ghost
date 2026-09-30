import type { WebhookFormat } from './index.js';

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
  render: ({ context, summary, url, excerpt }, sender) => ({
    username: sender.name,
    avatar_url: sender.iconUrl,
    // user text may say @everyone; nothing it says pings anyone
    allowed_mentions: { parse: [] },
    embeds: [
      {
        // Discord's limit for an embed title
        title: summary.slice(0, 256),
        ...(url && { url }),
        ...(excerpt && { description: excerpt }),
        footer: { text: context },
      },
    ],
  }),
};
