import type { WebhookFormat } from './index.js';

/** Google Chat incoming webhooks: https://developers.google.com/workspace/chat/quickstart/webhooks */
export const googleChat: WebhookFormat = {
  matches: (url) =>
    url.hostname === 'chat.googleapis.com' &&
    url.pathname.startsWith('/v1/spaces/'),
  render: ({ context, summary, url, excerpt }) => ({
    text: [
      `*${plain(context)}*`,
      url ? `<${url}|${plain(summary)}>` : plain(summary),
      ...(excerpt ? [plain(excerpt)] : []),
    ].join('\n'),
  }),
};

// Chat has no escape for `<`: user text with `<users/all>` would page the space, so angle brackets become look-alikes.
function plain(text: string) {
  return text.replaceAll('<', '‹').replaceAll('>', '›');
}
