import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { DATABASE, DatabaseModule } from '../database/database.module.js';
import type { Database } from '@ghost/db';
import path from 'node:path';
import type { Request, Response } from 'express';
import { createLoaders } from '../lib/github/loaders.js';
import { ViewerResolver } from './graphql/resolvers/viewer/viewer.resolver.js';
import { MetaModule } from './rest/meta/meta.module.js';
import { UsersModule } from './rest/users/users.module.js';
import { GithubAuthMiddleware } from './auth/github-auth.middleware.js';
import { GraphQLFormattedError } from 'graphql';
import { GraphQLError } from 'graphql/error';
import { DomainError } from '../domain/errors.js';
import { graphqlErrorType } from '../lib/github/error-type.js';
import { githubValidationPlugin } from '../lib/github/validation.js';
import { ReposModule } from './rest/repos/repos.module.js';
import { IssuesModule } from '../resources/issues/issues.module.js';
import { RepositoriesModule } from '../resources/repositories/repositories.module.js';
import { IssueCommentResolver } from './graphql/resolvers/issue-comment/issue-comment.resolver.js';
import { SearchResolver } from './graphql/resolvers/search/search.resolver.js';
import { IssueMutationsResolver } from './graphql/resolvers/issue-mutations/issue-mutations.resolver.js';
import { RepositoryMutationsResolver } from './graphql/resolvers/repository-mutations/repository-mutations.resolver.js';
import { OauthModule } from './oauth/oauth.module.js';

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
    MetaModule,
    UsersModule,
    ReposModule,
    IssuesModule,
    RepositoriesModule,
    OauthModule,
  ],
  providers: [
    ViewerResolver,
    IssueCommentResolver,
    SearchResolver,
    IssueMutationsResolver,
    RepositoryMutationsResolver,
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
      );
  }
}
