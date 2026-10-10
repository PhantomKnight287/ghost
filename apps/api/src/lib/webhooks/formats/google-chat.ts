import type { WebhookFormat } from './index.js';
import { summaryOf } from './message.js';

/** Google Chat incoming webhooks: https://developers.google.com/workspace/chat/quickstart/webhooks */
export const googleChat: WebhookFormat = {
  matches: (url) =>
    url.hostname === 'chat.googleapis.com' &&
    url.pathname.startsWith('/v1/spaces/'),
  render: (message) => {
    const summary = plain(summaryOf(message));
    return {
      text: [
        `*${plain(message.context)}*`,
        message.url ? `<${message.url}|${summary}>` : summary,
        ...message.commits.map(
          (commit) =>
            `<${commit.url}|${commit.sha.slice(0, 7)}> ${plain(commit.subject)} - ${plain(commit.author)}`,
        ),
        ...(message.moreCommits > 0 ? [`and ${message.moreCommits} more`] : []),
        ...(message.excerpt ? [plain(message.excerpt)] : []),
      ].join('\n'),
    };
  },
};

// Chat has no escape for `<`: user text with `<users/all>` would page the space, so angle brackets become look-alikes.
function plain(text: string) {
  return text.replaceAll('<', '‹').replaceAll('>', '›');
}
