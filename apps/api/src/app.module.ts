import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { Database } from '@ghost/db';
import { AuthModule } from '@thallesp/nestjs-better-auth';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DATABASE, DatabaseModule } from './database/database.module.js';
import { createAuth } from './lib/auth.js';
import { IssuesModule } from './resources/issues/issues.module.js';
import { PullRequestsModule } from './resources/pull-requests/pull-requests.module.js';
import { RepositoriesModule } from './resources/repositories/repositories.module.js';
import { UsersService } from './services/users/users.service.js';
import { GitModule } from './git/git.module.js';
import { S3Service } from './services/s3/s3.service.js';
import { WalService } from './services/git/wal/wal.service.js';
import { BranchesService } from './services/git/branches/branches.service.js';
import { RepositoryAccessService } from './services/git/repository-access/repository-access.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` interpolates values (e.g. BETTER_AUTH_URL=http://localhost:${API_PORT}),
      // which dotenv does not expand on its own.
      expandVariables: true,
      envFilePath: ['.env.local', '.env', '../../.env'],
    }),
    DatabaseModule,
    AuthModule.forRootAsync({
      imports: [DatabaseModule],
      inject: [DATABASE, ConfigService],
      useFactory: (db: Database, config: ConfigService) => ({
        auth: createAuth(db, {
          secret: config.getOrThrow<string>('BETTER_AUTH_SECRET'),
          baseURL: config.getOrThrow<string>('BETTER_AUTH_URL'),
          trustedOrigins: config
            .get<string>('AUTH_TRUSTED_ORIGINS', 'http://localhost:3000')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
          cookieDomain: config.get<string>('AUTH_COOKIE_DOMAIN'),
        }),
      }),
    }),
    RepositoriesModule,
    PullRequestsModule,
    IssuesModule,
    GitModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    UsersService,
    S3Service,
    WalService,
    BranchesService,
    RepositoryAccessService,
  ],
})
export class AppModule {}
