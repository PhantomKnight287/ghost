import { describe, expect, it } from 'vitest';

import { GithubValidationError } from './github.errors.js';
import {
  labelNamesOf,
  linkHeader,
  pageOf,
  type RestContext,
  toCommentRest,
  toIssueRest,
  toUserRest,
} from './rest.js';

const origins = {
  api: 'https://api.ghost.test',
  web: 'https://ghost.test',
  sshHost: '',
};

const ada = toUserRest(
  { ghostId: 'u1', numericId: 7, login: 'ada', avatarUrl: null },
  origins,
);

const context: RestContext = {
  repository: {
    ownerLogin: 'ada',
    apiUrl: 'https://api.ghost.test/api/v3/repos/ada/tools',
    webUrl: 'https://ghost.test/ada/tools',
  },
  users: new Map([['ada', ada]]),
  labelIds: new Map([['label_1', 3]]),
};

const issue = {
  id: 'issue_1',
  number: 4,
  title: 'Crash',
  body: null,
  state: 'closed' as const,
  isPullRequest: false,
  authorUsername: 'ada',
  closedByUsername: null,
  labels: [
    {
      id: 'label_1',
      name: 'help wanted',
      description: null,
      color: 'ededed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  assignees: ['ada'],
  commentCount: 2,
  closedAt: '2026-01-02T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  viewerCanEdit: true,
};

describe('toUserRest', () => {
  it('builds a simple-user with the URL templates typed SDKs expect', () => {
    expect(ada).toMatchObject({
      login: 'ada',
      id: 7,
      avatar_url: '',
      gravatar_id: '',
      url: 'https://api.ghost.test/api/v3/users/ada',
      html_url: 'https://ghost.test/ada',
      following_url:
        'https://api.ghost.test/api/v3/users/ada/following{/other_user}',
      type: 'User',
      site_admin: false,
    });
    expect(ada.node_id).toMatch(/^U_/);
  });

  it('marks an organization as one', () => {
    const org = toUserRest(
      { ghostId: 'o1', numericId: 2, login: 'acme', avatarUrl: 'logo.png' },
      origins,
      'Organization',
    );
    expect(org).toMatchObject({ type: 'Organization', avatar_url: 'logo.png' });
    expect(org.node_id).toMatch(/^O_/);
  });
});

describe('toIssueRest', () => {
  it('embeds users and labels, links the API and the web app, and says nothing of pull requests', () => {
    const rest = toIssueRest(
      issue,
      { numericId: 11, draft: null, mergedAt: null },
      context,
    );
    expect(rest).toMatchObject({
      id: 11,
      number: 4,
      state: 'closed',
      state_reason: 'completed',
      url: 'https://api.ghost.test/api/v3/repos/ada/tools/issues/4',
      html_url: 'https://ghost.test/ada/tools/issues/4',
      labels_url:
        'https://api.ghost.test/api/v3/repos/ada/tools/issues/4/labels{/name}',
      user: ada,
      assignee: ada,
      assignees: [ada],
      closed_by: null,
      comments: 2,
      locked: false,
      milestone: null,
      author_association: 'OWNER',
    });
    expect(rest.labels).toEqual([
      expect.objectContaining({
        id: 3,
        name: 'help wanted',
        url: 'https://api.ghost.test/api/v3/repos/ada/tools/labels/help%20wanted',
        default: false,
      }),
    ]);
    expect(rest.node_id).toMatch(/^I_/);
    expect(rest).not.toHaveProperty('pull_request');
    expect(rest).not.toHaveProperty('draft');
  });

  it('marks a pull request with its pull_request links and merge time', () => {
    const rest = toIssueRest(
      {
        ...issue,
        state: 'open',
        closedAt: null,
        isPullRequest: true,
        assignees: [],
        authorUsername: 'bob',
      },
      {
        numericId: 12,
        draft: true,
        mergedAt: new Date('2026-01-03T00:00:00Z'),
      },
      context,
    );
    expect(rest).toMatchObject({
      state_reason: null,
      html_url: 'https://ghost.test/ada/tools/pull/4',
      user: null,
      assignee: null,
      author_association: 'NONE',
      draft: true,
      pull_request: {
        url: 'https://api.ghost.test/api/v3/repos/ada/tools/pulls/4',
        html_url: 'https://ghost.test/ada/tools/pull/4',
        diff_url: 'https://ghost.test/ada/tools/pull/4.diff',
        patch_url: 'https://ghost.test/ada/tools/pull/4.patch',
        merged_at: '2026-01-03T00:00:00.000Z',
      },
    });
    expect(rest.node_id).toMatch(/^PR_/);
  });
});

describe('toCommentRest', () => {
  it('links by numeric id in the API and by Ghost id in the web app', () => {
    const rest = toCommentRest(
      {
        id: 'ic_1',
        numericId: 21,
        body: 'Same here',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        authorUsername: 'ada',
        issueNumber: 4,
        isPullRequest: true,
      },
      context,
    );
    expect(rest).toMatchObject({
      id: 21,
      url: 'https://api.ghost.test/api/v3/repos/ada/tools/issues/comments/21',
      html_url: 'https://ghost.test/ada/tools/pull/4#issuecomment-ic_1',
      issue_url: 'https://api.ghost.test/api/v3/repos/ada/tools/issues/4',
      user: ada,
    });
    expect(rest.node_id).toMatch(/^IC_/);
  });
});

describe('pageOf', () => {
  it('defaults to the first page of 30', () => {
    expect(pageOf({})).toEqual({ page: 1, perPage: 30, offset: 0 });
  });

  it('caps per_page at 100 and ignores values that are not positive integers', () => {
    expect(pageOf({ page: '3', per_page: '500' })).toEqual({
      page: 3,
      perPage: 100,
      offset: 200,
    });
    expect(pageOf({ page: '0', per_page: 'many' })).toEqual({
      page: 1,
      perPage: 30,
      offset: 0,
    });
    expect(pageOf({ page: '2.5' })).toEqual({
      page: 1,
      perPage: 30,
      offset: 0,
    });
  });
});

describe('linkHeader', () => {
  const url = new URL(
    'https://api.ghost.test/api/v3/repos/ada/tools/issues?state=all',
  );
  const at = (page: number) => ({ page, perPage: 10, offset: (page - 1) * 10 });

  it('links next and last from the first page, keeping the query', () => {
    expect(linkHeader(url, at(1), 35)).toBe(
      [
        '<https://api.ghost.test/api/v3/repos/ada/tools/issues?state=all&page=2&per_page=10>; rel="next"',
        '<https://api.ghost.test/api/v3/repos/ada/tools/issues?state=all&page=4&per_page=10>; rel="last"',
      ].join(', '),
    );
  });

  it('links every way from a middle page', () => {
    const link = linkHeader(url, at(2), 35);
    expect(link).toContain('page=1&per_page=10>; rel="prev"');
    expect(link).toContain('page=3&per_page=10>; rel="next"');
    expect(link).toContain('page=4&per_page=10>; rel="last"');
    expect(link).toContain('page=1&per_page=10>; rel="first"');
  });

  it('links only back from the last page', () => {
    const link = linkHeader(url, at(4), 35);
    expect(link).toContain('rel="prev"');
    expect(link).toContain('rel="first"');
    expect(link).not.toContain('rel="next"');
  });

  it('sends nothing when everything fits on one page', () => {
    expect(linkHeader(url, at(1), 10)).toBeNull();
    expect(linkHeader(url, at(1), 0)).toBeNull();
  });
});

describe('labelNamesOf', () => {
  it('reads every body shape GitHub accepts', () => {
    expect(labelNamesOf({ labels: ['bug'] })).toEqual(['bug']);
    expect(labelNamesOf(['bug', 'docs'])).toEqual(['bug', 'docs']);
    expect(labelNamesOf([{ name: 'bug' }])).toEqual(['bug']);
    expect(labelNamesOf({ labels: [{ name: 'bug' }, 'docs'] })).toEqual([
      'bug',
      'docs',
    ]);
  });

  it('refuses anything else as an invalid labels field', () => {
    for (const body of [{}, 'bug', [1], [{ title: 'bug' }], { labels: null }])
      expect(() => labelNamesOf(body)).toThrow(GithubValidationError);
  });
});
