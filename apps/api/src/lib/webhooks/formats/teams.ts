import type { WebhookFormat } from './index.js';

/** Microsoft Teams, through a Workflows webhook or a legacy incoming webhook connector; both take an Adaptive Card: https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook */
export const teams: WebhookFormat = {
  // A Workflows URL on logic.azure.com is left out: any Azure Logic App has one, and it may want Ghost's JSON.
  matches: (url) =>
    url.hostname.endsWith('.webhook.office.com') ||
    (url.hostname.endsWith('.api.powerplatform.com') &&
      url.pathname.includes('/workflows/')),
  render: ({ context, summary, url, excerpt }) => ({
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            { type: 'TextBlock', text: context, isSubtle: true, wrap: true },
            { type: 'TextBlock', text: summary, weight: 'Bolder', wrap: true },
            ...(excerpt
              ? [{ type: 'TextBlock', text: excerpt, wrap: true }]
              : []),
          ],
          actions: url ? [{ type: 'Action.OpenUrl', title: 'Open', url }] : [],
        },
      },
    ],
  }),
};
