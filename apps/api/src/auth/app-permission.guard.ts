import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  APP_PERMISSION,
  type AppPermissionNeeds,
  neededLevels,
  PULL_REQUESTS_ON_PULLS,
} from '../lib/apps/app-permission.js';
import { IntegrationForbiddenError } from '../lib/apps/apps.errors.js';
import { grants } from '../lib/apps/permissions.js';
import type { AppPermission } from '@ghost/permissions';
import { RepositoryNotFoundError } from '../lib/repositories/repositories.errors.js';
import type { GithubRequest } from '../github/auth/github-request.js';
import type { GitAuthenticatedBufferedRequest } from '../git/types.js';
import { InstallationAccessService } from '../services/apps/installation-access.service.js';
import { RepositoryAccessService } from '../services/git/repository-access/repository-access.service.js';

type Request = GithubRequest & GitAuthenticatedBufferedRequest;

/** Limits an installation token to the routes that declare a permission, on the repositories its installation covers, as far as its permissions reach. Everyone else passes untouched. */
@Injectable()
export class AppPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: RepositoryAccessService,
    private readonly installations: InstallationAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
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

  private async pullRequestsSuffice(
    context: ExecutionContext,
    req: Request,
    repositoryId: string,
    levels: [AppPermission, 'read' | 'write'][],
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
          name === 'issues' &&
          grants(req.appInstallation!.permissions, 'pull_requests', level),
      )
    )
      return false;
    return this.installations.onPullRequest(repositoryId, {
      number: number ? Number(number) : undefined,
      commentId: comment_id ? Number(comment_id) : undefined,
    });
  }
}
