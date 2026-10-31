import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type GqlContextType, GqlExecutionContext } from '@nestjs/graphql';
import type { GraphQLResolveInfo } from 'graphql';

import {
  ALLOW_USER_TOKENS,
  APP_PERMISSION,
  type AppPermissionNeeds,
  neededLevels,
  PULL_REQUESTS_ON_PULLS,
} from '../lib/apps/app-permission.js';
import { IntegrationForbiddenError } from '../lib/apps/apps.errors.js';
import { GRAPHQL_ROOT_PERMISSIONS } from '../lib/apps/graphql-permissions.js';
import { commonPermissions, grants } from '../lib/apps/permissions.js';
import type { AppPermission, AppPermissions } from '@ghost/permissions';
import type { UserToServerCaller } from '../lib/apps/user-token-context.js';
import { RepositoryNotFoundError } from '../lib/repositories/repositories.errors.js';
import type { GithubRequest } from '../github/auth/github-request.js';
import type { GitAuthenticatedBufferedRequest } from '../git/types.js';
import { InstallationAccessService } from '../services/apps/installation-access.service.js';
import { RepositoryAccessService } from '../services/git/repository-access/repository-access.service.js';

type Request = GithubRequest & GitAuthenticatedBufferedRequest;

/** Limits an installation token to the routes and GraphQL root fields that declare a permission, on the repositories its installation covers, as far as its permissions reach. A `ghu_` token gets the same limits from its app's installations, narrowed further when scoped, on top of its user's own access. Everyone else passes untouched. */
@Injectable()
export class AppPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: RepositoryAccessService,
    private readonly installations: InstallationAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType<GqlContextType>() === 'graphql')
      return this.forGraphqlRoot(context);
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (req.userToServer) return this.forUser(context, req, req.userToServer);
    const caller = req.appInstallation;
    if (!caller) return true;
    const needs = this.reflector.getAllAndOverride<
      AppPermission | AppPermissionNeeds | undefined
    >(APP_PERMISSION, [context.getHandler(), context.getClass()]);
    if (needs === undefined) throw new IntegrationForbiddenError();
    const levels = Object.entries(neededLevels(needs, req)) as [
      AppPermission,
      'read' | 'write',
    ][];
    const granted = levels.every(([name, level]) =>
      grants(caller.permissions, name, level),
    );

    const { owner, username, repo } = req.params as Record<string, string>;
    if (!repo) {
      if (!granted) throw new IntegrationForbiddenError();
      return true;
    }
    const repository =
      req.repository ??
      (await this.access.authorize({
        username: owner ?? username!,
        repo: repo.replace(/\.git$/i, ''),
        requesterId: caller.botUserId,
      }));
    const covered = await this.installations.covers(caller, repository.id);
    if (covered && granted) return true;
    if (
      covered &&
      (await this.pullRequestsSuffice(context, req, repository.id, levels))
    )
      return true;
    // A public repository answers a read the way it answers anyone; the bot is not who reads it then.
    if (
      repository.visibility === 'public' &&
      levels.every(([, level]) => level === 'read')
    ) {
      req.githubViewer = null;
      req.actor = null;
      req.appInstallation = null;
      return true;
    }
    if (!covered && repository.visibility === 'private')
      throw new RepositoryNotFoundError();
    throw new IntegrationForbiddenError();
  }

  /** A query or mutation field needs what GRAPHQL_ROOT_PERMISSIONS lists for it, and is denied when unlisted; the fields below it are held by appPermissionMiddleware. */
  private forGraphqlRoot(context: ExecutionContext) {
    const gql = GqlExecutionContext.create(context);
    const caller = gql.getContext<{ req: Request }>().req.appInstallation;
    if (!caller) return true;
    const info = gql.getInfo<GraphQLResolveInfo>();
    const needs =
      GRAPHQL_ROOT_PERMISSIONS[`${info.parentType.name}.${info.fieldName}`];
    if (
      !needs ||
      !Object.entries(needs).every(([name, level]) =>
        grants(caller.permissions, name as AppPermission, level),
      )
    )
      throw new IntegrationForbiddenError();
    return true;
  }

  /** The user's own role still decides, since every service checks it for the user; this adds the app's limits: a declared route, an installation of the app covering the repository, and its accepted permissions. */
  private async forUser(
    context: ExecutionContext,
    req: Request,
    caller: UserToServerCaller,
  ) {
    const handlers = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_USER_TOKENS, handlers))
      return true;
    const needs = this.reflector.getAllAndOverride<
      AppPermission | AppPermissionNeeds | undefined
    >(APP_PERMISSION, handlers);
    if (needs === undefined) throw new IntegrationForbiddenError();
    const levels = Object.entries(neededLevels(needs, req)) as [
      AppPermission,
      'read' | 'write',
    ][];
    const allow = (held: AppPermissions) =>
      levels.every(([name, level]) =>
        grants(
          caller.permissions
            ? commonPermissions(held, caller.permissions)
            : held,
          name,
          level,
        ),
      );

    const { owner, username, repo } = req.params as Record<string, string>;
    if (!repo) {
      if (!allow(await this.installations.appPermissions(caller.appId)))
        throw new IntegrationForbiddenError();
      return true;
    }
    const repository =
      req.repository ??
      (await this.access.authorize({
        username: owner ?? username!,
        repo: repo.replace(/\.git$/i, ''),
        requesterId: caller.userId,
      }));
    const narrowedAway =
      caller.repositoryIds && !caller.repositoryIds.includes(repository.id);
    const accepted = narrowedAway
      ? null
      : await this.installations.acceptedFor(
          caller.appId,
          repository.id,
          caller.installationId,
        );
    if (accepted && allow(accepted)) return true;
    if (
      accepted &&
      (await this.pullRequestsSuffice(
        context,
        req,
        repository.id,
        levels,
        caller.permissions
          ? commonPermissions(accepted, caller.permissions)
          : accepted,
      ))
    )
      return true;
    // A public repository answers a read to its user the way it answers them anywhere.
    if (
      repository.visibility === 'public' &&
      levels.every(([, level]) => level === 'read')
    )
      return true;
    if (!accepted && repository.visibility === 'private')
      throw new RepositoryNotFoundError();
    throw new IntegrationForbiddenError();
  }

  private async pullRequestsSuffice(
    context: ExecutionContext,
    req: Request,
    repositoryId: string,
    levels: [AppPermission, 'read' | 'write'][],
    held: AppPermissions = req.appInstallation!.permissions,
  ) {
    const { number, comment_id } = req.params as Record<string, string>;
    if (
      !this.reflector.getAllAndOverride<boolean>(PULL_REQUESTS_ON_PULLS, [
        context.getHandler(),
        context.getClass(),
      ]) ||
      (!number && !comment_id) ||
      !levels.every(
        ([name, level]) =>
          name === 'issues' && grants(held, 'pull_requests', level),
      )
    )
      return false;
    return this.installations.onPullRequest(repositoryId, {
      number: number ? Number(number) : undefined,
      commentId: comment_id ? Number(comment_id) : undefined,
    });
  }
}
