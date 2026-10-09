import type { Database } from '@ghost/db';
import { Inject } from '@nestjs/common';
import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { DATABASE } from '../../../../database/database.module.js';
import { CouldNotResolveError, GithubForbiddenError } from '../../../../lib/github/github.errors.js';
import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { decodeNodeIdAs } from '../../../../lib/github/node-id.js';
import { issueRefOf, labelNamesOf, usernamesOf } from '../../../../lib/github/node-lookup.js';
import { toIssueCommentNode } from '../../../../lib/github/nodes.js';
import { RepositoryForbiddenError } from '../../../../lib/repositories/access/repository-access.errors.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { IssueNode } from '../../types/issue.type.js';
import * as M from '../../types/mutations.type.js';
import type { RepositoryNode } from '../../types/repository.type.js';
import { IssueResolver } from '../issue/issue.resolver.js';
import { RepositoryResolver } from '../repository/repository.resolver.js';

type IssueRef = { username: string; repo: string; number: number; requesterId: string };

@Resolver()
@AllowAnonymous()
export class IssueMutationsResolver {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly issues: IssuesService,
    private readonly repositories: RepositoryResolver,
    private readonly issueNodes: IssueResolver,
  ) {}

  @Mutation(() => M.CreateIssuePayload, { nullable: true })
  async createIssue(@Args('input') input: M.CreateIssueInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'CreateIssue');
    const repository = await this.repositoryFor(input.repositoryId, userId);
    const labels = await this.labelNames(repository, input.labelIds ?? []);
    const assignees = await this.usernames(input.assigneeIds ?? []);
    const created = await this.write('CreateIssue', userId, context, () =>
      this.issues.createIssue({ username: repository.ownerLogin, repo: repository.slug, requesterId: userId, body: { title: input.title, body: input.body ?? undefined, labels, assignees } }),
    );
    return { clientMutationId: input.clientMutationId, issue: await this.issueNodes.fromRepository(repository, created.number, userId) };
  }

  @Mutation(() => M.UpdateIssuePayload, { nullable: true })
  async updateIssue(@Args('input') input: M.UpdateIssueInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'UpdateIssue');
    const { repository, ref } = await this.issueRef(input.id, userId);
    const labels = input.labelIds ? await this.labelNames(repository, input.labelIds) : null;
    const assignees = input.assigneeIds ? await this.usernames(input.assigneeIds) : null;
    // ponytail: one transaction per changed aspect; a failure midway keeps the earlier changes. Add IssuesService.updateMany if gh users hit it.
    await this.write('UpdateIssue', userId, context, async () => {
      if (input.title != null || input.body !== undefined) await this.issues.updateIssue({ ...ref, body: { title: input.title ?? undefined, body: input.body } });
      if (input.state === 'CLOSED') await this.issues.closeIssue(ref);
      if (input.state === 'OPEN') await this.issues.reopenIssue(ref);
      if (labels) await this.issues.setIssueLabels({ ...ref, names: labels });
      if (assignees) await this.issues.setIssueAssignees({ ...ref, usernames: assignees });
    });
    return { clientMutationId: input.clientMutationId, issue: await this.issueNodes.fromRepository(repository, ref.number, userId) };
  }

  @Mutation(() => M.CloseIssuePayload, { nullable: true })
  async closeIssue(@Args('input') input: M.CloseIssueInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'CloseIssue');
    const { repository, ref } = await this.issueRef(input.issueId, userId);
    await this.write('CloseIssue', userId, context, () => this.issues.closeIssue(ref));
    return { clientMutationId: input.clientMutationId, issue: await this.issueNodes.fromRepository(repository, ref.number, userId) };
  }

  @Mutation(() => M.ReopenIssuePayload, { nullable: true })
  async reopenIssue(@Args('input') input: M.ReopenIssueInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'ReopenIssue');
    const { repository, ref } = await this.issueRef(input.issueId, userId);
    await this.write('ReopenIssue', userId, context, () => this.issues.reopenIssue(ref));
    return { clientMutationId: input.clientMutationId, issue: await this.issueNodes.fromRepository(repository, ref.number, userId) };
  }

  @Mutation(() => M.AddCommentPayload, { nullable: true })
  async addComment(@Args('input') input: M.AddCommentInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'AddComment');
    const { repository, ref } = await this.issueRef(input.subjectId, userId);
    const comment = await this.write('AddComment', userId, context, () => this.issues.createComment({ ...ref, body: input.body }));
    const issue = await this.issueOnly(repository, ref, input.subjectId);
    return { clientMutationId: input.clientMutationId, commentEdge: { cursor: '', node: toIssueCommentNode(comment, issue, comment.authorUsername) } };
  }

  @Mutation(() => M.AddLabelsToLabelablePayload, { nullable: true })
  async addLabelsToLabelable(@Args('input') input: M.AddLabelsToLabelableInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'AddLabelsToLabelable');
    const { repository, ref } = await this.issueRef(input.labelableId, userId);
    const current = (await this.issueOnly(repository, ref, input.labelableId)).labelDtos.map((label) => label.name);
    const added = await this.labelNames(repository, input.labelIds);
    await this.write('AddLabelsToLabelable', userId, context, () => this.issues.setIssueLabels({ ...ref, names: [...new Set([...current, ...added])] }));
    return { clientMutationId: input.clientMutationId, labelable: await this.issueOnly(repository, ref, input.labelableId) };
  }

  @Mutation(() => M.RemoveLabelsFromLabelablePayload, { nullable: true })
  async removeLabelsFromLabelable(@Args('input') input: M.RemoveLabelsFromLabelableInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'RemoveLabelsFromLabelable');
    const { repository, ref } = await this.issueRef(input.labelableId, userId);
    const current = (await this.issueOnly(repository, ref, input.labelableId)).labelDtos.map((label) => label.name);
    const removed = new Set(await this.labelNames(repository, input.labelIds));
    await this.write('RemoveLabelsFromLabelable', userId, context, () => this.issues.setIssueLabels({ ...ref, names: current.filter((name) => !removed.has(name)) }));
    return { clientMutationId: input.clientMutationId, labelable: await this.issueOnly(repository, ref, input.labelableId) };
  }

  @Mutation(() => M.AddAssigneesToAssignablePayload, { nullable: true })
  async addAssigneesToAssignable(@Args('input') input: M.AddAssigneesToAssignableInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'AddAssigneesToAssignable');
    const { repository, ref } = await this.issueRef(input.assignableId, userId);
    const current = (await this.issueOnly(repository, ref, input.assignableId)).assigneeLogins;
    const added = await this.usernames(input.assigneeIds);
    await this.write('AddAssigneesToAssignable', userId, context, () => this.issues.setIssueAssignees({ ...ref, usernames: [...new Set([...current, ...added])] }));
    return { clientMutationId: input.clientMutationId, assignable: await this.issueOnly(repository, ref, input.assignableId) };
  }

  @Mutation(() => M.RemoveAssigneesFromAssignablePayload, { nullable: true })
  async removeAssigneesFromAssignable(@Args('input') input: M.RemoveAssigneesFromAssignableInput, @Viewer() viewer: GithubViewer | null, @Context() context: GraphqlContext) {
    const userId = this.require(viewer, 'RemoveAssigneesFromAssignable');
    const { repository, ref } = await this.issueRef(input.assignableId, userId);
    const current = (await this.issueOnly(repository, ref, input.assignableId)).assigneeLogins;
    const removed = new Set(await this.usernames(input.assigneeIds));
    await this.write('RemoveAssigneesFromAssignable', userId, context, () => this.issues.setIssueAssignees({ ...ref, usernames: current.filter((login) => !removed.has(login)) }));
    return { clientMutationId: input.clientMutationId, assignable: await this.issueOnly(repository, ref, input.assignableId) };
  }

  private require(viewer: GithubViewer | null, mutation: string) {
    if (!viewer) throw new GithubForbiddenError(`You must be signed in to run ${mutation}.`);
    return viewer.userId;
  }

  private unresolved(nodeId: string) {
    return new CouldNotResolveError(`Could not resolve to a node with the global id of '${nodeId}'`);
  }

  private async repositoryFor(nodeId: string, userId: string) {
    const repositoryId = decodeNodeIdAs(nodeId, 'Repository');
    return this.repositories.load(repositoryId, userId).catch(() => {
      throw this.unresolved(nodeId);
    });
  }

  /** The issue a node id names, with the IssueRef the service methods take. */
  private async issueRef(nodeId: string, userId: string): Promise<{ repository: RepositoryNode; ref: IssueRef }> {
    const found = await issueRefOf(this.db, decodeNodeIdAs(nodeId, 'Issue'));
    if (!found) throw this.unresolved(nodeId);
    const repository = await this.repositories.load(found.repositoryId, userId).catch(() => {
      throw this.unresolved(nodeId);
    });
    return { repository, ref: { username: repository.ownerLogin, repo: repository.slug, number: found.number, requesterId: userId } };
  }

  /** Pull request mutations arrive with milestone 3, so a number that is a pull request reads as unresolved here. */
  private async issueOnly(repository: RepositoryNode, ref: IssueRef, nodeId: string) {
    const found = await this.issueNodes.fromRepository(repository, ref.number, ref.requesterId);
    if (!(found instanceof IssueNode)) throw this.unresolved(nodeId);
    return found;
  }

  private async labelNames(repository: RepositoryNode, nodeIds: string[]) {
    const ids = nodeIds.map((nodeId) => decodeNodeIdAs(nodeId, 'Label'));
    return this.resolveAll(nodeIds, ids, await labelNamesOf(this.db, repository.ghostId, ids));
  }

  private async usernames(nodeIds: string[]) {
    const ids = nodeIds.map((nodeId) => decodeNodeIdAs(nodeId, 'User'));
    return this.resolveAll(nodeIds, ids, await usernamesOf(this.db, ids));
  }

  /** The value for each id in order; the first id with none fails as GitHub fails an unresolvable node. */
  private resolveAll(nodeIds: string[], ids: string[], found: Map<string, string>) {
    return ids.map((id, index) => {
      const value = found.get(id);
      if (value === undefined) throw this.unresolved(nodeIds[index]!);
      return value;
    });
  }

  /** Runs a write; a permission refusal reads as GitHub's FORBIDDEN wording, which names the login. */
  private async write<T>(mutation: string, userId: string, { loaders }: GraphqlContext, run: () => Promise<T>) {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof RepositoryForbiddenError)) throw error;
      const login = (await loaders.usersById.load(userId))?.username ?? '';
      throw new GithubForbiddenError(`${login} does not have the correct permissions to execute \`${mutation}\``);
    }
  }
}
