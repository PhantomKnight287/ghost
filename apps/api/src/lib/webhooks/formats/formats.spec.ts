import { describe, expect, it } from 'vitest';

import type { WebhookBody } from '../webhooks.js';
import { renderWebhookBody as render } from './index.js';
import { messageOf } from './message.js';

const repository = {
  id: 'repo_1',
  fullName: 'ada/app',
  description: null,
  visibility: 'public' as const,
  defaultBranch: 'main',
  htmlUrl: 'https://ghost.test/ada/app',
};
const thread = {
  id: 'issue_1',
  number: 7,
  title: 'Bell count',
  body: 'The bell should count',
  state: 'open' as const,
  author: null,
  htmlUrl: 'https://ghost.test/ada/app/issues/7',
};
const body = (extra: Partial<WebhookBody>): WebhookBody => ({
  event: 'issue.opened',
  repository,
  sender: { id: 'user_1', username: 'ada' },
  createdAt: '2026-09-30T00:00:00.000Z',
  ...extra,
});
const commit = (n: number) => ({
  sha: `${n}`.repeat(40),
  authorName: 'Ada',
  authorEmail: 'ada@example.com',
  committedAt: '2026-09-30T00:00:00.000Z',
  subject: `Commit ${n}`,
  body: '',
});
const opened = body({ issue: thread });
const sender = {
  name: 'Ghost',
  iconUrl: 'https://ghost.test/icons/icon-192.png',
};
const send = (url: string, sent: Parameters<typeof render>[1]) =>
  render(url, sent, sender);

describe('render', () => {
  it.each([
    ['https://hooks.slack.com/services/T0/B0/x', 'slack'],
    ['https://discord.com/api/webhooks/1/x', 'discord'],
    ['https://discordapp.com/api/webhooks/1/x', 'discord'],
    ['https://canary.discord.com/api/webhooks/1/x', 'discord'],
    ['https://chat.googleapis.com/v1/spaces/AAA/messages?key=k', 'google chat'],
    ['https://contoso.webhook.office.com/webhookb2/x', 'teams'],
    [
      'https://default1.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/x/triggers/manual/paths/invoke',
      'teams',
    ],
    // Slack Workflow Builder wants its own variables, not a message
    ['https://hooks.slack.com/triggers/T0/1/x', 'ghost'],
    ['https://discord.com/channels/1/2', 'ghost'],
    ['https://prod-1.westus.logic.azure.com/workflows/x/triggers', 'ghost'],
    ['https://example.com/hooks.slack.com/services/x', 'ghost'],
    ['https://93.184.216.34/hook', 'ghost'],
  ])('sends %s as %s', (url, expected) => {
    const sent = JSON.parse(send(url, opened));
    const format =
      'embeds' in sent
        ? 'discord'
        : 'attachments' in sent
          ? 'teams'
          : 'unfurl_links' in sent
            ? 'slack'
            : 'text' in sent
              ? 'google chat'
              : 'ghost';
    expect(format).toBe(expected);
  });

  it('sends everything else Ghost’s own JSON', () => {
    expect(JSON.parse(send('https://93.184.216.34/hook', opened))).toEqual(
      opened,
    );
    expect(JSON.parse(send('not a url', opened))).toEqual(opened);
  });

  it('keeps user text from pinging a channel or forming a link', () => {
    const loud = body({
      issue: { ...thread, title: '<!channel> & <users/all> @everyone' },
    });

    expect(
      JSON.parse(send('https://hooks.slack.com/services/x', loud)),
    ).toEqual({
      username: 'Ghost',
      icon_url: 'https://ghost.test/icons/icon-192.png',
      text: [
        '[ada/app] <https://ghost.test/ada/app/issues/7|ada opened issue #7: &lt;!channel&gt; &amp; &lt;users/all&gt; @everyone>',
        '>The bell should count',
      ].join('\n'),
      unfurl_links: false,
    });
    expect(
      JSON.parse(send('https://discord.com/api/webhooks/1/x', loud)),
    ).toEqual({
      username: 'Ghost',
      avatar_url: 'https://ghost.test/icons/icon-192.png',
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: 'ada opened issue #7: <!channel> & <users/all> @everyone',
          url: 'https://ghost.test/ada/app/issues/7',
          description: 'The bell should count',
          footer: { text: 'ada/app' },
        },
      ],
    });
    expect(
      JSON.parse(send('https://chat.googleapis.com/v1/spaces/A/messages', loud))
        .text,
    ).toBe(
      [
        '*ada/app*',
        '<https://ghost.test/ada/app/issues/7|ada opened issue #7: ‹!channel› & ‹users/all› @everyone>',
        'The bell should count',
      ].join('\n'),
    );
  });

  it('sends a ping without a link, as a card in Teams', () => {
    const ping = {
      event: 'ping' as const,
      webhook: {
        id: 'whk_1',
        url: 'https://x.webhook.office.com/a',
        events: ['push'],
      },
      organization: { slug: 'acme' },
      createdAt: '2026-09-30T00:00:00.000Z',
    };
    const card = JSON.parse(send('https://x.webhook.office.com/a', ping))
      .attachments[0].content;

    expect(card.body.map((block: { text: string }) => block.text)).toEqual([
      'acme',
      'Ghost webhook connected',
      'Events: push',
    ]);
    expect(card.actions).toEqual([]);
    expect(
      JSON.parse(send('https://discord.com/api/webhooks/1/x', ping)).embeds[0],
    ).toEqual({
      title: 'Ghost webhook connected',
      description: 'Events: push',
      footer: { text: 'acme' },
    });
    expect(
      JSON.parse(send('https://hooks.slack.com/services/x', ping)).text,
    ).toBe('[acme] Ghost webhook connected\n>Events: push');
    expect(
      JSON.parse(
        send('https://chat.googleapis.com/v1/spaces/A/messages', {
          ...ping,
          organization: undefined,
          repository: { fullName: 'ada/app' },
        }),
      ).text,
    ).toBe('*ada/app*\nGhost webhook connected\nEvents: push');
  });

  it('adds an Open button in Teams when there is somewhere to go', () => {
    const card = JSON.parse(
      send('https://x.webhook.office.com/a', body({ event: 'star.created' })),
    ).attachments[0].content;
    expect(card.actions).toEqual([
      { type: 'Action.OpenUrl', title: 'Open', url: repository.htmlUrl },
    ]);
    expect(card.body).toHaveLength(2);
  });
});

describe('messageOf', () => {
  const pull = { ...thread, htmlUrl: 'https://ghost.test/ada/app/pulls/7' };
  const release = {
    id: 'release_1',
    tagName: 'v1',
    name: null,
    body: 'Notes',
    htmlUrl: 'https://ghost.test/ada/app/releases/tag/v1',
  };
  const label = {
    id: 'label_1',
    name: 'bug',
    description: null,
    color: 'ff0000',
  };
  const bob = { id: 'user_2', username: 'bob' };
  const comment = { id: 'ic_1', body: 'On it' };
  const review = {
    id: 'prr_1',
    state: 'changes_requested' as const,
    body: 'Almost',
    dismissalMessage: 'Stale',
  };

  it.each<[Partial<WebhookBody>, string, string | null, string | null]>([
    [
      { issue: thread },
      'ada opened issue #7: Bell count',
      thread.htmlUrl,
      'The bell should count',
    ],
    [
      { event: 'issue.edited', issue: thread },
      'ada edited issue #7: Bell count',
      thread.htmlUrl,
      null,
    ],
    [
      { event: 'issue.closed', pullRequest: pull },
      'ada closed pull request #7: Bell count',
      pull.htmlUrl,
      null,
    ],
    [
      { event: 'issue.reopened', issue: thread },
      'ada reopened issue #7: Bell count',
      thread.htmlUrl,
      null,
    ],
    [
      { event: 'issue.assigned', issue: thread, assignee: bob },
      'ada assigned bob to issue #7: Bell count',
      thread.htmlUrl,
      null,
    ],
    [
      { event: 'issue.unassigned', issue: thread, assignee: bob },
      'ada unassigned bob from issue #7: Bell count',
      thread.htmlUrl,
      null,
    ],
    [
      { event: 'issue.labeled', issue: thread, label },
      'ada added the label bug to issue #7: Bell count',
      thread.htmlUrl,
      null,
    ],
    [
      { event: 'issue.unlabeled', issue: thread, label },
      'ada removed the label bug from issue #7: Bell count',
      thread.htmlUrl,
      null,
    ],
    [
      { event: 'issue.commented', pullRequest: pull, comment },
      'ada commented on pull request #7: Bell count',
      pull.htmlUrl,
      'On it',
    ],
    [
      { event: 'issue.comment_edited', issue: thread, comment },
      'ada edited a comment on issue #7: Bell count',
      thread.htmlUrl,
      'On it',
    ],
    [
      { event: 'issue.comment_deleted', issue: thread, comment },
      'ada deleted a comment on issue #7: Bell count',
      thread.htmlUrl,
      null,
    ],
    [
      { event: 'pull_request.ready_for_review', pullRequest: pull },
      'ada marked pull request #7: Bell count ready for review',
      pull.htmlUrl,
      null,
    ],
    [
      { event: 'pull_request.converted_to_draft', pullRequest: pull },
      'ada converted pull request #7: Bell count to a draft',
      pull.htmlUrl,
      null,
    ],
    [
      {
        event: 'pull_request.synchronized',
        pullRequest: pull,
        forced: true,
        commits: [commit(3)],
      },
      'ada force-pushed 1 commit to pull request #7: Bell count',
      pull.htmlUrl,
      '3333333 Commit 3',
    ],
    [
      { event: 'pull_request.merged', pullRequest: pull },
      'ada merged pull request #7: Bell count',
      pull.htmlUrl,
      null,
    ],
    [
      { event: 'pull_request.reviewed', pullRequest: pull, review },
      'ada requested changes on pull request #7: Bell count',
      pull.htmlUrl,
      'Almost',
    ],
    [
      { event: 'pull_request.review_dismissed', pullRequest: pull, review },
      'ada dismissed a review on pull request #7: Bell count',
      pull.htmlUrl,
      'Stale',
    ],
    [
      {
        event: 'pull_request.review_commented',
        pullRequest: pull,
        comment: { ...comment, path: 'bell.ts' },
      },
      'ada commented on bell.ts in pull request #7: Bell count',
      pull.htmlUrl,
      'On it',
    ],
    [
      { event: 'label.created', label },
      'ada created the label bug',
      `${repository.htmlUrl}/labels`,
      null,
    ],
    [
      { event: 'label.edited', label },
      'ada edited the label bug',
      `${repository.htmlUrl}/labels`,
      null,
    ],
    [
      { event: 'label.deleted', label },
      'ada deleted the label bug',
      `${repository.htmlUrl}/labels`,
      null,
    ],
    [
      { event: 'release.created', release },
      'ada created the release v1',
      release.htmlUrl,
      'Notes',
    ],
    [
      { event: 'release.published', release: { ...release, name: 'One' } },
      'ada published the release One',
      release.htmlUrl,
      'Notes',
    ],
    [
      { event: 'release.edited', release },
      'ada edited the release v1',
      release.htmlUrl,
      'Notes',
    ],
    [
      {
        event: 'release.deleted',
        release: { id: 'release_1', tagName: 'v1', name: null },
      },
      'ada deleted the release v1',
      `${repository.htmlUrl}/releases`,
      null,
    ],
    [
      { event: 'star.created' },
      'ada starred ada/app',
      repository.htmlUrl,
      null,
    ],
    [
      { event: 'star.deleted' },
      'ada unstarred ada/app',
      repository.htmlUrl,
      null,
    ],
    [
      { event: 'watch.started' },
      'ada started watching ada/app',
      repository.htmlUrl,
      null,
    ],
    [
      {
        event: 'fork.created',
        fork: {
          ...repository,
          fullName: 'bob/app',
          htmlUrl: 'https://ghost.test/bob/app',
        },
      },
      'ada forked ada/app to bob/app',
      'https://ghost.test/bob/app',
      null,
    ],
    [
      { event: 'repository.edited' },
      'ada edited the settings of ada/app',
      repository.htmlUrl,
      null,
    ],
    [
      { event: 'repository.transferred', from: 'bob' },
      'ada transferred ada/app from bob',
      repository.htmlUrl,
      null,
    ],
    [
      { event: 'member.added' },
      'ada accepted the invitation to collaborate on ada/app',
      repository.htmlUrl,
      null,
    ],
    [
      { event: 'member.removed', member: bob },
      'ada removed bob as a collaborator',
      repository.htmlUrl,
      null,
    ],
    [
      {
        event: 'push',
        ref: 'refs/heads/main',
        created: false,
        deleted: false,
        commits: [commit(1)],
      },
      'ada pushed 1 commit to main',
      `${repository.htmlUrl}/tree/main`,
      `${'1'.repeat(7)} Commit 1`,
    ],
    [
      {
        event: 'push',
        ref: 'refs/tags/v1',
        created: true,
        deleted: false,
        commits: [],
      },
      'ada created tag v1',
      `${repository.htmlUrl}/tree/v1`,
      null,
    ],
    [
      {
        event: 'push',
        ref: 'refs/heads/old',
        created: false,
        deleted: true,
        commits: [],
      },
      'ada deleted branch old',
      repository.htmlUrl,
      null,
    ],
    [
      { event: 'issue.opened', issue: thread, sender: null },
      'Someone opened issue #7: Bell count',
      thread.htmlUrl,
      'The bell should count',
    ],
  ])('describes %o', (extra, summary, url, excerpt) => {
    expect(messageOf(body(extra))).toEqual({
      context: 'ada/app',
      summary,
      url,
      excerpt,
    });
  });

  it('lists the first commits of a big push and counts the rest', () => {
    const { excerpt } = messageOf(
      body({
        event: 'push',
        ref: 'refs/heads/main',
        commits: [1, 2, 3, 4, 5, 6, 7].map(commit),
      }),
    );
    expect(excerpt?.split('\n')).toHaveLength(6);
    expect(excerpt).toMatch(/Commit 5\nand 2 more$/);
  });

  it('cuts a long excerpt short', () => {
    const { excerpt } = messageOf(
      body({ issue: { ...thread, body: 'x'.repeat(2000) } }),
    );
    expect(excerpt).toHaveLength(500);
    expect(excerpt?.endsWith('…')).toBe(true);
  });
});
