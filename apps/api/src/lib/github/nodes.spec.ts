import { describe, expect, it } from 'vitest';

import { IssueState } from '../../github/graphql/enums.js';
import { encodeNodeId } from './node-id.js';
import {
  toCommitNode,
  toIssueNode,
  toOrganizationNode,
  toUserNode,
} from './nodes.js';

const origins = {
  api: 'https://api.ghost.test',
  web: 'https://ghost.test',
  sshHost: 'ghost.test:1031',
};

describe('toUserNode', () => {
  it('builds GitHub user fields from a Ghost user row', () => {
    const created = new Date('2026-01-01T00:00:00Z');
    const node = toUserNode(
      {
        id: 'u1',
        numericId: 7,
        username: 'ada',
        name: 'Ada',
        image: null,
        createdAt: created,
      } as never,
      origins,
    );
    expect(node).toMatchObject({
      kind: 'User',
      ghostId: 'u1',
      login: 'ada',
      name: 'Ada',
      avatarUrl: '',
      resourcePath: '/ada',
      url: 'https://ghost.test/ada',
      databaseId: 7,
      createdAt: created,
    });
    expect(node.id).toMatch(/^U_/);
  });
});

describe('toOrganizationNode', () => {
  it('uses the slug as the login', () => {
    const node = toOrganizationNode(
      {
        id: 'o1',
        slug: 'acme',
        name: 'Acme',
        logo: 'https://x/logo.png',
      } as never,
      origins,
    );
    expect(node).toMatchObject({
      kind: 'Organization',
      login: 'acme',
      avatarUrl: 'https://x/logo.png',
      url: 'https://ghost.test/acme',
    });
    expect(node.id).toMatch(/^O_/);
  });
});

describe('toIssueNode', () => {
  const repository = {
    ghostId: 'repo_1',
    ownerLogin: 'ada',
    slug: 'tools',
    url: 'https://ghost.test/ada/tools',
    resourcePath: '/ada/tools',
  } as never;
  const dto = {
    id: 'issue_1',
    number: 7,
    title: 'T',
    body: null,
    state: 'closed',
    isPullRequest: false,
    authorUsername: 'ada',
    viaApp: null,
    closedByUsername: 'ada',
    labels: [],
    assignees: ['bob'],
    commentCount: 0,
    closedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    viewerCanEdit: true,
  };

  it('maps Ghost issue state, empty body and URLs onto GitHub fields', () => {
    const node = toIssueNode(dto as never, repository);
    expect(node).toMatchObject({
      number: 7,
      body: '',
      state: IssueState.CLOSED,
      closed: true,
      stateReason: 'COMPLETED',
      url: 'https://ghost.test/ada/tools/issues/7',
      resourcePath: '/ada/tools/issues/7',
      assigneeLogins: ['bob'],
      viewerCanUpdate: true,
    });
    expect(node.id).toMatch(/^I_/);
  });

  it('leaves stateReason null on an open issue', () => {
    expect(
      toIssueNode(
        { ...dto, state: 'open', closedAt: null } as never,
        repository,
      ).stateReason,
    ).toBeNull();
  });
});

describe('toCommitNode', () => {
  const commit = {
    sha: 'a'.repeat(40),
    authorName: 'Ada',
    authorEmail: 'ada@ghost.test',
    committerName: 'Ada',
    committerEmail: 'ada@ghost.test',
    authoredAt: '2026-01-01T00:00:00Z',
    committedAt: '2026-01-01T00:00:00Z',
    subject: 'Add a feature',
    body: '',
  };
  const repository = {
    ghostId: 'r1',
    url: 'https://ghost.test/ada/tools',
    resourcePath: '/ada/tools',
  };
  const status = (id: string, state: 'pending' | 'error') => ({
    id,
    state,
    context: `ci/${id}`,
    description: null,
    targetUrl: null,
    createdAt: '2026-01-02T00:00:00Z',
    creator: null,
    viaApp: null,
  });

  it('has no rollup without statuses', () => {
    expect(toCommitNode(commit, repository).statusCheckRollup).toBeNull();
  });

  it('builds the rollup from the combined status', () => {
    const rollup = toCommitNode(
      {
        ...commit,
        status: {
          sha: commit.sha,
          state: 'failure',
          totalCount: 2,
          statuses: [status('s1', 'pending'), status('s2', 'error')],
        },
      },
      repository,
    ).statusCheckRollup;
    expect(rollup).toMatchObject({
      id: encodeNodeId('StatusCheckRollup', `r1:${commit.sha}`),
      state: 'FAILURE',
      contexts: [
        {
          id: encodeNodeId('StatusContext', 's1'),
          context: 'ci/s1',
          state: 'PENDING',
          createdAt: new Date('2026-01-02T00:00:00Z'),
        },
        { id: encodeNodeId('StatusContext', 's2'), state: 'ERROR' },
      ],
    });
    expect(rollup?.contexts).toHaveLength(2);
  });
});
