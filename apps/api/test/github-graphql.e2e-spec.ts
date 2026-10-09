import type { INestApplication } from '@nestjs/common';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('GitHub GraphQL', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  let stranger: { cookie: string; key: string; userId: string };
  const username = `ghgql${Date.now()}`;
  let work: string;
  let pullRequestNumber: number;

  const graphql = (query: string, variables: object = {}, token?: string) => {
    const call = request(app.getHttpServer())
      .post('/api/graphql')
      .send({ query, variables });
    return token ? call.set('authorization', `token ${token}`) : call;
  };

  beforeAll(async () => {
    let origin: string;
    ({ app, origin } = await startApp());
    owner = await signUp(app, username);
    const api = request(app.getHttpServer());
    await api
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'public-repo', visibility: 'public' })
      .expect(201);
    await api
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'secret-repo', visibility: 'private' })
      .expect(201);
    stranger = await signUp(app, `${username}x`);

    // Ghost numbers pull requests and issues together; one real pull request lets issueOrPullRequest answer a PullRequest.
    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-ghgql-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args], { cwd: work });
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(path.join(work, 'a.txt'), 'two\n');
    git('commit', '-q', '-am', 'second');
    // The server runs in this process, so the push must not block the event loop.
    await promisify(execFile)('git', ['push', '-q', `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/public-repo.git`, 'main', 'feature'], { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    const pull = await api.post(`/api/repositories/${username}/public-repo/pulls`).set('cookie', owner.cookie).send({ title: 'Feature', base: 'main', head: 'feature' }).expect(201);
    pullRequestNumber = pull.body.number;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('answers a query at /api/graphql', async () => {
    const response = await graphql('{ __typename }').expect(200);
    expect(response.body).toEqual({ data: { __typename: 'Query' } });
  });

  it('answers introspection, which gh sends to enterprise hosts', async () => {
    const response = await graphql('{ __type(name: "Query") { name } }').expect(
      200,
    );
    expect(response.body.data.__type.name).toBe('Query');
  });

  it('refuses a wrong token with 401 Bad credentials', async () => {
    const response = await graphql(
      '{ __typename }',
      {},
      'ghost_pat_nope',
    ).expect(401);
    expect(response.body.message).toBe('Bad credentials');
  });
  it('answers viewer with the token owner', async () => {
    const response = await graphql(
      '{ viewer { __typename id login name url resourcePath avatarUrl } }',
      {},
      owner.key,
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.viewer).toMatchObject({
      __typename: 'User',
      login: username,
      resourcePath: `/${username}`,
    });
    expect(response.body.data.viewer.id).toMatch(/^U_/);
  });

  it('refuses viewer anonymously, as GitHub does', async () => {
    const response = await graphql('{ viewer { login } }').expect(200);
    expect(response.body.errors[0].type).toBe('FORBIDDEN');
  });

  it('resolves user, repositoryOwner and node by id', async () => {
    const response = await graphql(
      'query($login: String!) { user(login: $login) { id login } repositoryOwner(login: $login) { __typename login } }',
      { login: username },
    ).expect(200);
    expect(response.body.data.repositoryOwner).toEqual({
      __typename: 'User',
      login: username,
    });
    const node = await graphql(
      'query($id: ID!) { node(id: $id) { __typename ... on User { login } } }',
      { id: response.body.data.user.id },
    ).expect(200);
    expect(node.body.data.node).toEqual({
      __typename: 'User',
      login: username,
    });
  });

  it('answers a missing user as NOT_FOUND with GitHub wording', async () => {
    const response = await graphql(
      '{ user(login: "nobody-here-xyz") { login } }',
    ).expect(200);
    expect(response.body.data.user).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      type: 'NOT_FOUND',
      message:
        "Could not resolve to a User with the login of 'nobody-here-xyz'.",
    });
  });

  const REPO_QUERY =
    'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id databaseId name nameWithOwner owner { login } sshUrl url hasIssuesEnabled hasWikiEnabled description isPrivate visibility viewerPermission defaultBranchRef { name } parent { name } mergeCommitAllowed rebaseMergeAllowed squashMergeAllowed } }';

  it('answers the repository fields gh reads before every command', async () => {
    const response = await graphql(
      REPO_QUERY,
      { owner: username, name: 'public-repo' },
      owner.key,
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.repository).toMatchObject({
      databaseId: null,
      name: 'public-repo',
      nameWithOwner: `${username}/public-repo`,
      owner: { login: username },
      hasIssuesEnabled: true,
      hasWikiEnabled: false,
      isPrivate: false,
      visibility: 'PUBLIC',
      viewerPermission: 'ADMIN',
      parent: null,
      mergeCommitAllowed: true,
    });
    expect(response.body.data.repository.id).toMatch(/^R_/);
  });

  it.each([
    ['anonymous', () => undefined],
    ['a stranger', () => stranger.key],
  ])('answers a private repository as NOT_FOUND for %s', async (_, token) => {
    const response = await graphql(
      REPO_QUERY,
      { owner: username, name: 'secret-repo' },
      token(),
    ).expect(200);
    expect(response.body.data.repository).toBeNull();
    expect(response.body.errors[0]).toMatchObject({
      type: 'NOT_FOUND',
      message: `Could not resolve to a Repository with the name '${username}/secret-repo'.`,
    });
  });
  it('lists labels and assignable users, which gh issue create resolves names against', async () => {
    const api = request(app.getHttpServer());
    await api.post(`/api/repositories/${username}/public-repo/labels`).set('cookie', owner.cookie).send({ name: 'bug', color: 'd73a4a' }).expect(201);
    const response = await graphql(
      'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { labels(first: 100) { totalCount nodes { id name color description } } label(name: "bug") { name } assignableUsers(first: 100) { totalCount nodes { id login name } } } }',
      { owner: username, name: 'public-repo' },
      owner.key,
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    const repository = response.body.data.repository;
    expect(repository.labels.nodes).toContainEqual(expect.objectContaining({ name: 'bug', color: 'd73a4a' }));
    expect(repository.labels.nodes[0].id).toMatch(/^LA_/);
    expect(repository.label).toEqual({ name: 'bug' });
    expect(repository.assignableUsers.nodes.map((user: { login: string }) => user.login)).toContain(username);
    const label = repository.labels.nodes[0];
    const lookup = await graphql('query($id: ID!) { node(id: $id) { ... on Label { name } } }', { id: label.id }, owner.key).expect(200);
    expect(lookup.body.data.node).toEqual({ name: label.name });
  });

  it('lists, filters and pages issues as gh issue list asks', async () => {
    const api = request(app.getHttpServer());
    for (const title of ['First', 'Second', 'Third']) {
      await api.post(`/api/repositories/${username}/public-repo/issues`).set('cookie', owner.cookie).send({ title, labels: title === 'Second' ? ['bug'] : [] }).expect(201);
    }
    const LIST = 'query($owner: String!, $repo: String!, $limit: Int, $endCursor: String, $states: [IssueState!] = OPEN, $assignee: String, $author: String) { repository(owner: $owner, name: $repo) { hasIssuesEnabled issues(first: $limit, after: $endCursor, orderBy: {field: CREATED_AT, direction: DESC}, states: $states, filterBy: {assignee: $assignee, createdBy: $author}) { totalCount nodes { number title url state updatedAt labels(first: 100) { nodes { id name description color } totalCount } } pageInfo { hasNextPage endCursor } } } }';
    const first = await graphql(LIST, { owner: username, repo: 'public-repo', limit: 2 }, owner.key).expect(200);
    expect(first.body.errors).toBeUndefined();
    const issues = first.body.data.repository.issues;
    expect(issues.totalCount).toBe(3);
    expect(issues.nodes.map((issue: { title: string }) => issue.title)).toEqual(['Third', 'Second']);
    expect(issues.nodes[1].labels.nodes[0].name).toBe('bug');
    expect(issues.nodes[0].state).toBe('OPEN');
    expect(issues.pageInfo.hasNextPage).toBe(true);
    const second = await graphql(LIST, { owner: username, repo: 'public-repo', limit: 2, endCursor: issues.pageInfo.endCursor }, owner.key).expect(200);
    expect(second.body.data.repository.issues.nodes.map((issue: { title: string }) => issue.title)).toEqual(['First']);
    const filtered = await graphql(LIST, { owner: username, repo: 'public-repo', limit: 10, author: `${username}x` }, owner.key).expect(200);
    expect(filtered.body.data.repository.issues.totalCount).toBe(0);
    const ascending = await graphql(LIST.replace('direction: DESC', 'direction: ASC'), { owner: username, repo: 'public-repo', limit: 1 }, owner.key).expect(200);
    expect(ascending.body.data.repository.issues.nodes[0].title).toBe('First');
  });

  it('answers every field gh issue view asks for, with empty values for what Ghost lacks', async () => {
    const api = request(app.getHttpServer());
    const created = await api.post(`/api/repositories/${username}/public-repo/issues`).set('cookie', owner.cookie).send({ title: 'Viewed', body: 'Body text' }).expect(201);
    await api.post(`/api/repositories/${username}/public-repo/issues/${created.body.number}/comments`).set('cookie', owner.cookie).send({ body: 'A comment' }).expect(201);
    const VIEW = `query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { hasIssuesEnabled issue: issueOrPullRequest(number: $number) { __typename ...on Issue { id number url state stateReason createdAt title body author { login ...on User { id name } } milestone { number title description dueOn } assignees(first: 100) { nodes { id login name databaseId } totalCount } labels(first: 100) { nodes { id name description color } totalCount } reactionGroups { content users { totalCount } } comments(last: 1) { nodes { author { login ...on User { id name } } authorAssociation body createdAt includesCreatedEdit isMinimized minimizedReason reactionGroups { content users { totalCount } } } totalCount } parent { id number title url state repository { nameWithOwner } } subIssues(first: 100) { nodes { id number } totalCount } subIssuesSummary { total completed percentCompleted } } } } }`;
    const response = await graphql(VIEW, { owner: username, repo: 'public-repo', number: created.body.number }, owner.key).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.repository.issue).toMatchObject({
      __typename: 'Issue',
      title: 'Viewed',
      body: 'Body text',
      state: 'OPEN',
      stateReason: null,
      author: { login: username },
      milestone: null,
      reactionGroups: [],
      parent: null,
      subIssues: { nodes: [], totalCount: 0 },
      subIssuesSummary: { total: 0, completed: 0, percentCompleted: 0 },
      comments: { totalCount: 1, nodes: [{ body: 'A comment', authorAssociation: 'OWNER', isMinimized: false }] },
    });
    const issueId = response.body.data.repository.issue.id;
    const lookup = await graphql('query($id: ID!) { node(id: $id) { ... on Issue { title } } }', { id: issueId }, owner.key).expect(200);
    expect(lookup.body.data.node).toEqual({ title: 'Viewed' });
  });

  it('answers a pull request number in issueOrPullRequest as a PullRequest', async () => {
    const response = await graphql('query($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { issueOrPullRequest(number: $number) { __typename ...on PullRequest { number title } } } }', { owner: username, repo: 'public-repo', number: pullRequestNumber }, owner.key).expect(200);
    expect(response.body.data.repository.issueOrPullRequest).toMatchObject({ __typename: 'PullRequest', number: pullRequestNumber });
  });

  it('answers a missing issue number as NOT_FOUND', async () => {
    const response = await graphql('query($owner: String!, $repo: String!) { repository(owner: $owner, name: $repo) { issue(number: 9999) { title } } }', { owner: username, repo: 'public-repo' }, owner.key).expect(200);
    expect(response.body.errors[0]).toMatchObject({ type: 'NOT_FOUND', message: `Could not resolve to an Issue with the number of 9999.` });
  });

  it('searches issues with gh qualifiers and ignores ones Ghost cannot apply', async () => {
    const response = await graphql(
      'query($q: String!) { search(type: ISSUE, last: 30, query: $q) { issueCount nodes { ...on Issue { title } } } }',
      { q: `repo:${username}/public-repo is:issue is:open label:bug milestone:v1 sort:created-desc` },
      owner.key,
    ).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.search.nodes).toEqual([{ title: 'Second' }]);
  });

  it('creates, edits, comments on, labels, closes and reopens an issue through mutations', async () => {
    const repo = await graphql('query($o: String!, $n: String!) { repository(owner: $o, name: $n) { id label(name: "bug") { id } } viewer { id } }', { o: username, n: 'public-repo' }, owner.key).expect(200);
    const { id: repositoryId, label } = repo.body.data.repository;
    const viewerId = repo.body.data.viewer.id;

    const created = await graphql('mutation($input: CreateIssueInput!) { createIssue(input: $input) { clientMutationId issue { id number title url labels(first: 10) { nodes { name } } assignees(first: 10) { nodes { login } } } } }', { input: { repositoryId, title: 'From gh', body: 'Body', labelIds: [label.id], assigneeIds: [viewerId], clientMutationId: 'c1' } }, owner.key).expect(200);
    expect(created.body.errors).toBeUndefined();
    const issue = created.body.data.createIssue.issue;
    expect(created.body.data.createIssue.clientMutationId).toBe('c1');
    expect(issue.labels.nodes).toEqual([{ name: 'bug' }]);
    expect(issue.assignees.nodes).toEqual([{ login: username }]);

    const updated = await graphql('mutation($input: UpdateIssueInput!) { updateIssue(input: $input) { issue { title } } }', { input: { id: issue.id, title: 'Renamed' } }, owner.key).expect(200);
    expect(updated.body.data.updateIssue.issue.title).toBe('Renamed');

    const comment = await graphql('mutation($input: AddCommentInput!) { addComment(input: $input) { commentEdge { node { body url } } } }', { input: { subjectId: issue.id, body: 'Thanks' } }, owner.key).expect(200);
    expect(comment.body.data.addComment.commentEdge.node.body).toBe('Thanks');

    const removed = await graphql('mutation($input: RemoveLabelsFromLabelableInput!) { removeLabelsFromLabelable(input: $input) { labelable { ...on Issue { labels(first: 10) { totalCount } } } } }', { input: { labelableId: issue.id, labelIds: [label.id] } }, owner.key).expect(200);
    expect(removed.body.data.removeLabelsFromLabelable.labelable.labels.totalCount).toBe(0);

    const closed = await graphql('mutation($input: CloseIssueInput!) { closeIssue(input: $input) { issue { state stateReason } } }', { input: { issueId: issue.id, stateReason: 'NOT_PLANNED' } }, owner.key).expect(200);
    expect(closed.body.data.closeIssue.issue.state).toBe('CLOSED');

    const reopened = await graphql('mutation($input: ReopenIssueInput!) { reopenIssue(input: $input) { issue { state } } }', { input: { issueId: issue.id } }, owner.key).expect(200);
    expect(reopened.body.data.reopenIssue.issue.state).toBe('OPEN');
  });

  it('refuses mutations without a viewer, and refuses a node id of the wrong type', async () => {
    const repo = await graphql('query($o: String!, $n: String!) { repository(owner: $o, name: $n) { id } }', { o: username, n: 'public-repo' }, owner.key).expect(200);
    const anonymous = await graphql('mutation($input: CreateIssueInput!) { createIssue(input: $input) { issue { id } } }', { input: { repositoryId: repo.body.data.repository.id, title: 'x' } }).expect(200);
    expect(anonymous.body.errors[0].type).toBe('FORBIDDEN');
    const wrongType = await graphql('mutation($input: CloseIssueInput!) { closeIssue(input: $input) { issue { id } } }', { input: { issueId: repo.body.data.repository.id } }, owner.key).expect(200);
    expect(wrongType.body.errors[0]).toMatchObject({ type: 'NOT_FOUND', message: expect.stringContaining('Could not resolve to a node with the global id of') });
  });

  it('refuses a stranger writing to a public repository with FORBIDDEN', async () => {
    const repo = await graphql('query($o: String!, $n: String!) { repository(owner: $o, name: $n) { issues(first: 1) { nodes { id } } } }', { o: username, n: 'public-repo' }, owner.key).expect(200);
    const response = await graphql('mutation($input: CloseIssueInput!) { closeIssue(input: $input) { issue { id } } }', { input: { issueId: repo.body.data.repository.issues.nodes[0].id } }, stranger.key).expect(200);
    expect(response.body.errors[0].type).toBe('FORBIDDEN');
  });

  it('creates a repository for the viewer through createRepository', async () => {
    const viewer = await graphql('{ viewer { id } }', {}, owner.key).expect(200);
    const response = await graphql('mutation($input: CreateRepositoryInput!) { createRepository(input: $input) { repository { name nameWithOwner visibility url } } }', { input: { name: 'made-by-gh', visibility: 'PRIVATE', ownerId: viewer.body.data.viewer.id, description: 'x' } }, owner.key).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.createRepository.repository).toMatchObject({ name: 'made-by-gh', nameWithOwner: `${username}/made-by-gh`, visibility: 'PRIVATE' });
  });

  it('serves GraphiQL to a browser and accepts the session cookie there', async () => {
    const page = await request(app.getHttpServer()).get('/api/graphql').set('accept', 'text/html').expect(200);
    expect(page.text).toContain('graphiql');
    const response = await request(app.getHttpServer()).post('/api/graphql').set('cookie', owner.cookie).send({ query: '{ viewer { login } }' }).expect(200);
    expect(response.body.data.viewer.login).toBe(username);
  });

  it('answers an unknown field with a validation error naming it, which gh prints', async () => {
    const response = await graphql('{ viewer { login notAField } }', {}, owner.key).expect(400);
    expect(response.body.errors[0].message).toContain('notAField');
  });

  it('refuses a label or assignee id that does not resolve, instead of dropping it', async () => {
    const repo = await graphql('query($o: String!, $n: String!) { repository(owner: $o, name: $n) { id } }', { o: username, n: 'public-repo' }, owner.key).expect(200);
    const repositoryId = repo.body.data.repository.id;
    const secretLabel = await request(app.getHttpServer()).post(`/api/repositories/${username}/secret-repo/labels`).set('cookie', owner.cookie).send({ name: 'elsewhere', color: '000000' }).expect(201);
    const foreignLabelId = (await graphql('query($o: String!) { repository(owner: $o, name: "secret-repo") { label(name: "elsewhere") { id } } }', { o: username }, owner.key).expect(200)).body.data.repository.label.id;
    expect(secretLabel.body.name).toBe('elsewhere');
    const create = (input: object) => graphql('mutation($input: CreateIssueInput!) { createIssue(input: $input) { issue { id } } }', { input: { repositoryId, title: 'Bad ids', ...input } }, owner.key).expect(200);
    const foreign = await create({ labelIds: [foreignLabelId] });
    expect(foreign.body.errors[0]).toMatchObject({ type: 'NOT_FOUND', message: `Could not resolve to a node with the global id of '${foreignLabelId}'` });
    const missingUser = Buffer.from('nobody').toString('base64url');
    const unknown = await create({ assigneeIds: [`U_${missingUser}`] });
    expect(unknown.body.errors[0]).toMatchObject({ type: 'NOT_FOUND', message: `Could not resolve to a node with the global id of 'U_${missingUser}'` });
  });

  it('resolves a comment by node id, and a repository through its owner', async () => {
    const issues = await graphql('query($o: String!) { repository(owner: $o, name: "public-repo") { issues(first: 50, states: [OPEN, CLOSED]) { nodes { title comments(first: 1) { nodes { id body } } } } } }', { o: username }, owner.key).expect(200);
    const comment = issues.body.data.repository.issues.nodes.flatMap((issue: { comments: { nodes: { id: string; body: string }[] } }) => issue.comments.nodes)[0];
    const lookup = await graphql('query($id: ID!) { node(id: $id) { ... on IssueComment { body author { login } } } }', { id: comment.id }, owner.key).expect(200);
    expect(lookup.body.data.node).toEqual({ body: comment.body, author: { login: username } });
    const visible = await graphql('query($id: ID!) { nodes(ids: [$id]) { id } }', { id: comment.id }, stranger.key).expect(200);
    expect(visible.body.data.nodes).toEqual([{ id: comment.id }]);

    const owned = await graphql('query($o: String!) { repositoryOwner(login: $o) { repository(name: "public-repo") { name } } user(login: $o) { repository(name: "secret-repo") { name } } }', { o: username }, stranger.key).expect(200);
    expect(owned.body.errors).toBeUndefined();
    expect(owned.body.data).toEqual({ repositoryOwner: { repository: { name: 'public-repo' } }, user: { repository: null } });
  });

  it("answers gh's GitHub preview media types in Accept with JSON instead of 406", async () => {
    const response = await request(app.getHttpServer())
      .post('/api/graphql')
      .set('authorization', `token ${owner.key}`)
      .set('accept', 'application/vnd.github.merge-info-preview+json, application/vnd.github.nebula-preview')
      .send({ query: '{ viewer { login } }' })
      .expect(200);
    expect(response.body.data.viewer.login).toBe(username);
  });

  it('pages labels as gh issue create asks for them', async () => {
    const response = await graphql('query RepositoryLabelList($owner: String!, $name: String!, $endCursor: String) { repository(owner: $owner, name: $name) { labels(first: 100, orderBy: {field: NAME, direction: ASC}, after: $endCursor) { nodes { id name color description } pageInfo { hasNextPage endCursor } } } }', { owner: username, name: 'public-repo', endCursor: null }, owner.key).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.repository.labels.nodes.map((label: { name: string }) => label.name)).toContain('bug');
    expect(response.body.data.repository.labels.pageInfo.hasNextPage).toBe(false);
  });

  it('pages assignable users as gh issue create asks for them', async () => {
    const response = await graphql('query RepositoryAssignableUsers($owner: String!, $name: String!, $endCursor: String) { repository(owner: $owner, name: $name) { assignableUsers(first: 100, after: $endCursor) { nodes { id login name } pageInfo { hasNextPage endCursor } } } }', { owner: username, name: 'public-repo', endCursor: null }, owner.key).expect(200);
    expect(response.body.errors).toBeUndefined();
    expect(response.body.data.repository.assignableUsers.nodes.map((user: { login: string }) => user.login)).toContain(username);
  });

  // gh's IssueByNumber query (pkg/cmd/issue/shared/lookup.go): one field list on both fragments, issue-only fields dropped from the pull request one.
  const SHARED = 'number,url,state,createdAt,title,body,author{login,...on User{id,name}},milestone{number,title,description,dueOn},assignees(first:100){nodes{id,login,name,databaseId},totalCount},labels(first:100){nodes{id,name,description,color},totalCount},reactionGroups{content,users{totalCount}},projectItems(first:100){nodes{id, project{id,title}, status:fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue{optionId,name}}},totalCount},id';
  const LAST_COMMENT = 'comments(last: 1){nodes{author{login,...on User{id,name}},authorAssociation,body,createdAt,includesCreatedEdit,isMinimized,minimizedReason,reactionGroups{content,users{totalCount}}},totalCount}';
  const ALL_COMMENTS = 'comments(first: 100){nodes{id,author{login,...on User{id,name}},authorAssociation,body,createdAt,includesCreatedEdit,isMinimized,minimizedReason,reactionGroups{content,users{totalCount}},url,viewerDidAuthor},pageInfo{hasNextPage,endCursor},totalCount}';
  const ISSUE_ONLY = 'stateReason,isPinned,issueType{id,name,description,color},parent{id,number,title,url,state,repository{nameWithOwner}},subIssues(first:100){nodes{id,number,title,url,state,repository{nameWithOwner}},totalCount},subIssuesSummary{total,completed,percentCompleted}';
  const lookup = (comments: string) => `query IssueByNumber($owner: String!, $repo: String!, $number: Int!) { repository(owner: $owner, name: $repo) { hasIssuesEnabled issue: issueOrPullRequest(number: $number) { __typename ...on Issue{${SHARED},${comments},${ISSUE_ONLY}} ...on PullRequest{${SHARED},${comments}} } } }`;

  it("answers gh's issue lookup, which selects the same fields on Issue and PullRequest", async () => {
    const issues = await graphql('query($o: String!) { repository(owner: $o, name: "public-repo") { issues(first: 1) { nodes { number } } } }', { o: username }, owner.key).expect(200);
    const issueNumber = issues.body.data.repository.issues.nodes[0].number;
    for (const comments of [LAST_COMMENT, ALL_COMMENTS]) {
      const issue = await graphql(lookup(comments), { owner: username, repo: 'public-repo', number: issueNumber }, owner.key).expect(200);
      expect(issue.body.errors).toBeUndefined();
      expect(issue.body.data.repository.issue).toMatchObject({ __typename: 'Issue', number: issueNumber, state: 'OPEN', issueType: null, projectItems: { nodes: [], totalCount: 0 } });
      const pull = await graphql(lookup(comments), { owner: username, repo: 'public-repo', number: pullRequestNumber }, owner.key).expect(200);
      expect(pull.body.errors).toBeUndefined();
      expect(pull.body.data.repository.issue).toMatchObject({ __typename: 'PullRequest', number: pullRequestNumber, state: 'OPEN', title: 'Feature', body: '', author: { login: username }, labels: { totalCount: 0 }, comments: { totalCount: 0 } });
    }
  });

  it('still refuses two different fields under one name on the same type', async () => {
    const response = await graphql('{ viewer { a: login a: name } }', {}, owner.key).expect(400);
    expect(response.body.errors[0].message).toContain('"a" conflict');
  });
});
