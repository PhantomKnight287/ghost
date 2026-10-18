import { describe, expect, it } from 'vitest';

import { parseIssueSearch } from './issue-search.js';

describe('parseIssueSearch', () => {
  it('reads the qualifiers gh writes for issue list --search', () => {
    expect(
      parseIssueSearch(
        'repo:ada/tools is:issue is:open label:bug label:"help wanted" author:ada assignee:bob crash on start',
      ),
    ).toEqual({
      repo: { owner: 'ada', name: 'tools' },
      state: 'open',
      isPullRequest: false,
      author: 'ada',
      assignee: 'bob',
      labels: ['bug', 'help wanted'],
      merged: null,
      reviewRequested: undefined,
      text: 'crash on start',
    });
  });

  it('ignores qualifiers Ghost cannot filter on instead of failing', () => {
    expect(
      parseIssueSearch(
        'repo:ada/tools milestone:v1 reason:completed sort:created-desc type:issue state:closed fix',
      ),
    ).toMatchObject({
      state: 'closed',
      isPullRequest: false,
      labels: [],
      text: 'fix',
    });
  });

  it('reads the qualifiers gh writes for pr status', () => {
    expect(
      parseIssueSearch(
        'repo:ada/tools state:open is:pr is:merged author:@me review-requested:@me',
      ),
    ).toMatchObject({
      isPullRequest: true,
      merged: true,
      author: '@me',
      reviewRequested: { login: '@me', direct: false },
    });
  });

  it('reads a review request for a user alone, or for a team by organization and slug', () => {
    expect(
      parseIssueSearch('repo:ada/tools user-review-requested:bob'),
    ).toMatchObject({ reviewRequested: { login: 'bob', direct: true } });
    expect(
      parseIssueSearch('repo:ada/tools team-review-requested:acme/infra'),
    ).toMatchObject({
      reviewRequested: { organization: 'acme', slug: 'infra' },
    });
    expect(
      parseIssueSearch('repo:ada/tools team-review-requested:infra'),
    ).toMatchObject({ reviewRequested: undefined });
  });

  it('defaults to every state and both kinds', () => {
    expect(parseIssueSearch('repo:ada/tools')).toMatchObject({
      state: 'all',
      isPullRequest: null,
      text: '',
    });
  });
});
