import type { IncomingMessage } from 'node:http';

import type { Database } from '@ghost/db';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';

import { AppController } from './app.controller.js';
import { ApiKeyAuthGuard } from './auth/api-key-auth.guard.js';
import { AvatarsModule } from './avatars/avatars.module.js';
import { DATABASE, DatabaseModule } from './database/database.module.js';
import { GitModule } from './git/git.module.js';
import { GithubModule } from './github/github.module.js';
import { createAuth } from './lib/auth.js';
import { githubOAuthConfig } from './lib/imports/importer.js';
import {
  emailVerificationEnabled,
  MailModule,
  mailConfigured,
} from './mail/mail.module.js';
import { MailService } from './mail/mail.service.js';
import { AttachmentsModule } from './resources/attachments/attachments.module.js';
import { BranchesModule } from './resources/branches/branches.module.js';
import { CollaboratorsModule } from './resources/collaborators/collaborators.module.js';
import { CommitStatusesModule } from './resources/commit-statuses/commit-statuses.module.js';
import { EmailsModule } from './resources/emails/emails.module.js';
import { GpgKeysModule } from './resources/gpg-keys/gpg-keys.module.js';
import { ImportsModule } from './resources/imports/imports.module.js';
import { IssuesModule } from './resources/issues/issues.module.js';
import { NotificationsModule } from './resources/notifications/notifications.module.js';
import { OauthAppsModule } from './resources/oauth-apps/oauth-apps.module.js';
import { OrganizationsModule } from './resources/organizations/organizations.module.js';
import { PullRequestsModule } from './resources/pull-requests/pull-requests.module.js';
import { ReleasesModule } from './resources/releases/releases.module.js';
import { RulesetsModule } from './resources/rulesets/rulesets.module.js';
import { RepositoriesModule } from './resources/repositories/repositories.module.js';
import { SshKeysModule } from './resources/ssh-keys/ssh-keys.module.js';
import { UserModule } from './resources/user/user.module.js';
import { WebhooksModule } from './resources/webhooks/webhooks.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { S3Module } from './s3/s3.module.js';
import { AvatarStorageService } from './services/avatars/avatar-storage.service.js';
import { AppStatsService } from './services/stats/app-stats.service.js';
import { RepositoryTemplatesModule } from './resources/repository-templates/repository-templates.module.js';
import { SshSigningKeysModule } from './resources/ssh-signing-keys/ssh-signing-keys.module.js';

/** Body parsing for `type`, except on GitHub's asset uploads, which stream raw bytes of any type to object storage. */
const parses = (type: string) => (req: IncomingMessage) => {
  const request = req as Request;
  return (
    !request.originalUrl.startsWith('/api/uploads/') &&
    Boolean(request.is(type))
  );
};

@Module({
  imports: [
    S3Module,
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` interpolates values (e.g. BETTER_AUTH_URL=http://localhost:${API_PORT}), which dotenv does not expand on its own.
      expandVariables: true,
      envFilePath: ['.env.local', '.env', '../../.env'],
    }),
    DatabaseModule,
    RateLimitModule,
    MailModule,
    AuthModule.forRootAsync({
      disableGlobalAuthGuard: true,
      imports: [DatabaseModule, MailModule, AvatarsModule],
      inject: [DATABASE, ConfigService, MailService, AvatarStorageService],
      useFactory: (
        db: Database,
        config: ConfigService,
        mail: MailService,
        avatars: AvatarStorageService,
      ) => ({
        // Importer batches carry whole issue bodies, which GitHub allows up to 64K characters each.
        bodyParser: {
          json: { limit: '2mb', type: parses('application/json') },
          urlencoded: { type: parses('application/x-www-form-urlencoded') },
        },
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
          github: githubOAuthConfig(config) ?? undefined,
          sendChangeEmail: mailConfigured(config)
            ? ({ email, name, newEmail, url }) =>
                mail.sendChangeEmailEmail(email, {
                  name,
                  newEmail,
                  approveUrl: url,
                })
            : undefined,
          onOrganizationDeleted: async (organizationId, oauthClientIds) => {
            await Promise.all(
              [organizationId, ...oauthClientIds].map((id) =>
                avatars.remove(id),
              ),
            );
          },
          sendOrganizationInvitation: mailConfigured(config)
            ? ({ email, url, ...context }) =>
                mail.sendOrganizationInvitationEmail(email, {
                  ...context,
                  acceptUrl: url,
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
    OrganizationsModule,
    PullRequestsModule,
    IssuesModule,
    ImportsModule,
    ReleasesModule,
    RulesetsModule,
    AttachmentsModule,
    BranchesModule,
    NotificationsModule,
    CollaboratorsModule,
    CommitStatusesModule,
    WebhooksModule,
    EmailsModule,
    GpgKeysModule,
    SshKeysModule,
    GitModule,
    UserModule,
    GithubModule,
    OauthAppsModule,
    RepositoryTemplatesModule,
    SshSigningKeysModule,
  ],
  controllers: [AppController],
  providers: [
    AppStatsService,
    { provide: APP_GUARD, useClass: ApiKeyAuthGuard },
  ],
})
export class AppModule {}
