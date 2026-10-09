import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
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
        graphiql: true,
        playground: true,
        context: ({ req, res }: { req: Request; res: Response }) => ({
          req,
          res,
          loaders: createLoaders(db),
        }),
      }),
    }),
    MetaModule,
    UsersModule,
  ],
  providers: [ViewerResolver],
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
