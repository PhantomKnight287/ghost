import path from 'node:path';

import type { Database } from '@ghost/db';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import type { Request, Response } from 'express';
import { GraphQLFormattedError } from 'graphql';
import { GraphQLError } from 'graphql/error';

import { DATABASE, DatabaseModule } from '../database/database.module.js';
import { DomainError } from '../domain/errors.js';
import { graphqlErrorType } from '../lib/github/error-type.js';
import { createLoaders } from '../lib/github/loaders.js';
import { githubValidationPlugin } from '../lib/github/validation.js';
import { CommitStatusesModule } from '../resources/commit-statuses/commit-statuses.module.js';
import { IssuesModule } from '../resources/issues/issues.module.js';
import { PullRequestsModule } from '../resources/pull-requests/pull-requests.module.js';
import { ReleasesModule } from '../resources/releases/releases.module.js';
import { RepositoriesModule } from '../resources/repositories/repositories.module.js';
import { AppClientsService } from '../services/apps/app-clients.service.js';
import { AppJwtService } from '../services/apps/app-jwt.service.js';
import { InstallationTokensService } from '../services/apps/installation-tokens.service.js';
import { UserTokensService } from '../services/apps/user-tokens.service.js';
import { GithubAuthMiddleware } from './auth/github-auth.middleware.js';
import { IssueCommentResolver } from './graphql/resolvers/issue-comment/issue-comment.resolver.js';
import { IssueMutationsResolver } from './graphql/resolvers/issue-mutations/issue-mutations.resolver.js';
import { IssueMutationsService } from './graphql/resolvers/issue-mutations/issue-mutations.service.js';
import { PullRequestMutationsResolver } from './graphql/resolvers/pull-request-mutations/pull-request-mutations.resolver.js';
import { PullRequestMutationsService } from './graphql/resolvers/pull-request-mutations/pull-request-mutations.service.js';
import { RepositoryReleasesResolver } from './graphql/resolvers/release/release.resolver.js';
import { ReleaseNodesService } from './graphql/resolvers/release/release-nodes.service.js';
import { RepositoryMutationsResolver } from './graphql/resolvers/repository-mutations/repository-mutations.resolver.js';
import { RepositoryMutationsService } from './graphql/resolvers/repository-mutations/repository-mutations.service.js';
import { SearchResolver } from './graphql/resolvers/search/search.resolver.js';
import { GithubSearchService } from './graphql/resolvers/search/search.service.js';
import { ViewerResolver } from './graphql/resolvers/viewer/viewer.resolver.js';
import { ViewerService } from './graphql/resolvers/viewer/viewer.service.js';
import { OauthModule } from './oauth/oauth.module.js';
import { GithubAppModule } from './rest/app/app.module.js';
import { GithubUserAttachmentsModule } from './rest/attachments/user-attachments.module.js';
import { GithubGitModule } from './rest/git/git.module.js';
import { GithubIssuesModule } from './rest/issues/issues.module.js';
import { MetaModule } from './rest/meta/meta.module.js';
import { GithubPullsModule } from './rest/pulls/pulls.module.js';
import { GithubReleasesModule } from './rest/releases/releases.module.js';
import { ReposModule } from './rest/repos/repos.module.js';
import { GithubRulesetsModule } from './rest/rulesets/rulesets.module.js';
import { GithubStatusesModule } from './rest/statuses/statuses.module.js';
import { TemplatesModule } from './rest/templates/templates.module.js';
import { UsersModule } from './rest/users/users.module.js';

@Module({
  imports: [
    GraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [DatabaseModule],
      inject: [DATABASE],
      useFactory: (db: Database) => ({
        path: '/graphql',
        useGlobalPrefix: true,
        autoSchemaFile:
          process.env.NODE_ENV === 'production'
            ? true
            : path.join(import.meta.dirname, '../../github.schema.gql'),
        sortSchema: true,
        buildSchemaOptions: {
          dateScalarMode: 'isoDate',
          numberScalarMode: 'integer',
        },
        introspection: true,
        // GitHub's validation lets fragments on different types share a field name with different types, which gh relies on; githubValidationPlugin validates instead.
        dangerouslyDisableValidation: true,
        plugins: [githubValidationPlugin],
        graphiql: {
          url: '/api/graphql',
        },
        context: ({ req, res }: { req: Request; res: Response }) => ({
          req,
          res,
          loaders: createLoaders(db),
        }),
        formatError: (formatted: GraphQLFormattedError, error: unknown) => {
          const original =
            error instanceof GraphQLError ? error.cause : undefined;
          if (!(original instanceof DomainError)) return formatted;
          return {
            type: graphqlErrorType(original.status),
            path: formatted.path,
            locations: formatted.locations,
            message: original.message,
          };
        },
      }),
    }),
    GithubAppModule,
    MetaModule,
    UsersModule,
    ReposModule,
    GithubIssuesModule,
    GithubPullsModule,
    IssuesModule,
    RepositoriesModule,
    OauthModule,
    PullRequestsModule,
    CommitStatusesModule,
    ReleasesModule,
    GithubReleasesModule,
    GithubStatusesModule,
    GithubUserAttachmentsModule,
    GithubGitModule,
    TemplatesModule,
    GithubRulesetsModule,
  ],
  providers: [
    AppJwtService,
    InstallationTokensService,
    AppClientsService,
    UserTokensService,
    ViewerResolver,
    IssueCommentResolver,
    SearchResolver,
    IssueMutationsResolver,
    RepositoryMutationsResolver,
    PullRequestMutationsResolver,
    RepositoryReleasesResolver,
    ViewerService,
    GithubSearchService,
    IssueMutationsService,
    RepositoryMutationsService,
    PullRequestMutationsService,
    ReleaseNodesService,
  ],
})
export class GithubModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(GithubAuthMiddleware)
      .forRoutes(
        { path: 'graphql', method: RequestMethod.ALL },
        { path: 'v3', method: RequestMethod.ALL },
        { path: 'v3/*path', method: RequestMethod.ALL },
        { path: 'uploads/*path', method: RequestMethod.ALL },
      );
  }
}
