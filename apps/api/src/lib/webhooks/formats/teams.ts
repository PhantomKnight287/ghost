import type { WebhookFormat } from './index.js';

/** Microsoft Teams, through a Workflows webhook or a legacy incoming webhook connector; both take an Adaptive Card: https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook */
export const teams: WebhookFormat = {
  // A Workflows URL on logic.azure.com is left out: any Azure Logic App has one, and it may want Ghost's JSON.
  matches: (url) =>
    url.hostname.endsWith('.webhook.office.com') ||
    (url.hostname.endsWith('.api.powerplatform.com') &&
      url.pathname.includes('/workflows/')),
  render: ({
    context,
    actor,
    action,
    url,
    excerpt,
    commits,
    moreCommits,
    timestamp,
  }) => {
    // DATE() and TIME() want RFC 3339 without fractions of a second.
    const when = timestamp.replace(/\.\d+Z$/, 'Z');
    return {
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
              actor
                ? {
                    type: 'ColumnSet',
                    columns: [
                      ...(actor.avatarUrl
                        ? [
                            {
                              type: 'Column',
                              width: 'auto',
                              verticalContentAlignment: 'Center',
                              items: [
                                {
                                  type: 'Image',
                                  url: actor.avatarUrl,
                                  altText: actor.name,
                                  size: 'Small',
                                  style: 'Person',
                                },
                              ],
                            },
                          ]
                        : []),
                      {
                        type: 'Column',
                        width: 'stretch',
                        verticalContentAlignment: 'Center',
                        items: [
                          {
                            type: 'TextBlock',
                            text: `${actor.name} ${action}`,
                            weight: 'Bolder',
                            wrap: true,
                          },
                          {
                            type: 'TextBlock',
                            // Teams shows the date and time in the reader's own zone.
                            text: `{{DATE(${when})}} {{TIME(${when})}}`,
                            isSubtle: true,
                            spacing: 'None',
                            wrap: true,
                          },
                        ],
                      },
                    ],
                  }
                : {
                    type: 'TextBlock',
                    text: action,
                    weight: 'Bolder',
                    wrap: true,
                  },
              ...commits.map((commit) => ({
                type: 'TextBlock',
                text: `[${commit.sha.slice(0, 7)}](${commit.url}) ${commit.subject} - ${commit.author}`,
                wrap: true,
                spacing: 'Small',
              })),
              ...(moreCommits > 0
                ? [
                    {
                      type: 'TextBlock',
                      text: `and ${moreCommits} more`,
                      isSubtle: true,
                      wrap: true,
                    },
                  ]
                : []),
              ...(excerpt
                ? [{ type: 'TextBlock', text: excerpt, wrap: true }]
                : []),
            ],
            actions: url
              ? [{ type: 'Action.OpenUrl', title: 'Open', url }]
              : [],
          },
        },
      ],
    };
  },
};
