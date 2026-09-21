import type { Database } from '@ghost/db';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from '@thallesp/nestjs-better-auth';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DATABASE, DatabaseModule } from './database/database.module.js';
import { GitModule } from './git/git.module.js';
import { createAuth } from './lib/auth.js';
import {
  emailVerificationEnabled,
  MailModule,
  mailConfigured,
} from './mail/mail.module.js';
import { MailService } from './mail/mail.service.js';
import { EmailsModule } from './resources/emails/emails.module.js';
import { GpgKeysModule } from './resources/gpg-keys/gpg-keys.module.js';
import { IssuesModule } from './resources/issues/issues.module.js';
import { PullRequestsModule } from './resources/pull-requests/pull-requests.module.js';
import { RepositoriesModule } from './resources/repositories/repositories.module.js';
import { UserModule } from './resources/user/user.module.js';
import { BranchesService } from './services/git/branches/branches.service.js';
import { RepositoryAccessService } from './services/git/repository-access/repository-access.service.js';
import { WalService } from './services/git/wal/wal.service.js';
import { S3Service } from './services/s3/s3.service.js';
import { UsersService } from './services/users/users.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` interpolates values (e.g. BETTER_AUTH_URL=http://localhost:${API_PORT}), which dotenv does not expand on its own.
      expandVariables: true,
      envFilePath: ['.env.local', '.env', '../../.env'],
    }),
    DatabaseModule,
    MailModule,
    AuthModule.forRootAsync({
      imports: [DatabaseModule, MailModule],
      inject: [DATABASE, ConfigService, MailService],
      useFactory: (db: Database, config: ConfigService, mail: MailService) => ({
        auth: createAuth(db, {
          secret: config.getOrThrow<string>('BETTER_AUTH_SECRET'),
          baseURL: config.getOrThrow<string>('BETTER_AUTH_URL'),
          trustedOrigins: config
            .get<string>('AUTH_TRUSTED_ORIGINS', 'http://localhost:3000')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
          cookieDomain: config.get<string>('AUTH_COOKIE_DOMAIN'),
          webAppUrl: config.get<string>('WEB_APP_URL', 'http://localhost:3000'),
          sendChangeEmail: mailConfigured(config)
            ? ({ email, name, newEmail, url }) =>
                mail.sendChangeEmailEmail(email, {
                  name,
                  newEmail,
                  approveUrl: url,
                })
            : undefined,
          sendResetPassword: mailConfigured(config)
            ? ({ email, name, url }) =>
                mail.sendResetPasswordEmail(email, { name, resetUrl: url })
            : undefined,
          sendVerificationEmail: emailVerificationEnabled(config)
            ? ({ email, name, url }) =>
                mail.sendVerificationEmail(email, { name, verifyUrl: url })
            : undefined,
        }),
      }),
    }),
    RepositoriesModule,
    PullRequestsModule,
    IssuesModule,
    EmailsModule,
    GpgKeysModule,
    GitModule,
    UserModule,
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
