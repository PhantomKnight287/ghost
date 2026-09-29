import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';
import { render } from '@react-email/components';
import { sql } from 'drizzle-orm';
import { createElement, type FunctionComponent } from 'react';

import { DATABASE } from '../database/database.module.js';
import ThreadAssigned from './templates/thread-assigned.js';
import ThreadComment from './templates/thread-comment.js';
import ThreadOpened from './templates/thread-opened.js';
import ThreadReview from './templates/thread-review.js';
import ThreadState from './templates/thread-state.js';

export type ThreadTemplate =
  | 'thread-opened'
  | 'thread-comment'
  | 'thread-review'
  | 'thread-assigned'
  | 'thread-state';

// The context is built per template by NotifierService, the same untyped hand-off the mailer's template adapter gets.
const THREAD_TEMPLATES = {
  'thread-opened': ThreadOpened,
  'thread-comment': ThreadComment,
  'thread-review': ThreadReview,
  'thread-assigned': ThreadAssigned,
  'thread-state': ThreadState,
} as unknown as Record<
  ThreadTemplate,
  FunctionComponent<Record<string, unknown>>
>;

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  /** Auth forms live in the web app, so every link in an email points there. */
  private readonly appUrl: string;
  /** `DELIVERY_EMAIL=queue` hands thread emails to apps/delivery, which retries them; otherwise they are sent inline, best effort. */
  private readonly queue: boolean;

  constructor(
    private readonly mailer: MailerService,
    config: ConfigService,
    @Inject(DATABASE) private readonly db: Database,
  ) {
    this.appUrl = config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000';
    this.queue = config.get<string>('DELIVERY_EMAIL') === 'queue';
  }

  async sendVerificationEmail(
    to: string,
    context: { name?: string; verifyUrl: string },
  ): Promise<void> {
    await this.send(to, 'Verify your email', 'verify-email', context);
  }

  async sendVerifyAliasEmail(
    to: string,
    context: { name?: string; verifyUrl: string },
  ): Promise<void> {
    await this.send(to, 'Confirm your email address', 'verify-alias', context);
  }

  async sendChangeEmailEmail(
    to: string,
    context: { name?: string; newEmail: string; approveUrl: string },
  ): Promise<void> {
    await this.send(
      to,
      'Approve your new email address',
      'change-email',
      context,
    );
  }

  async sendResetPasswordEmail(
    to: string,
    context: { name?: string; resetUrl: string },
  ): Promise<void> {
    await this.send(to, 'Reset your password', 'reset-password', context);
  }

  async sendOrganizationInvitationEmail(
    to: string,
    context: {
      inviter: string;
      organization: string;
      role: string;
      acceptUrl: string;
    },
  ): Promise<void> {
    await this.send(
      to,
      `${context.inviter} invited you to join ${context.organization}`,
      'organization-invitation',
      context,
    );
  }

  async sendRepositoryInvitationEmail(
    to: string,
    context: {
      name?: string;
      inviter: string;
      repository: string;
      role: string;
    },
  ): Promise<void> {
    await this.send(
      to,
      `${context.inviter} invited you to ${context.repository}`,
      'repository-invitation',
      { ...context, invitationsUrl: `${this.appUrl}/dashboard` },
    );
  }

  /** Every email about one issue or pull request names the same thread in `References`, so mail clients file them as one conversation. */
  async sendThreadEmail(
    to: string,
    {
      template,
      threadId,
      subject,
      context,
      idempotencyKey,
    }: {
      template: ThreadTemplate;
      threadId: string;
      subject: string;
      context: Record<string, unknown>;
      /** The same key enqueues once, so a retried outbox event sends no duplicate. */
      idempotencyKey: string;
    },
  ): Promise<void> {
    if (this.queue) {
      await this.enqueueThreadEmail(
        to,
        template,
        subject,
        context,
        idempotencyKey,
      );
      return;
    }
    await this.send(to, subject, template, context, {
      references: `<${threadId}@${new URL(this.appUrl).hostname}>`,
    });
  }

  // ponytail: the HTTP relay carries no headers, so queued mail loses `References` as relayed mail already does; add it to the payload when delivery speaks SMTP.
  private async enqueueThreadEmail(
    to: string,
    template: ThreadTemplate,
    subject: string,
    context: Record<string, unknown>,
    idempotencyKey: string,
  ) {
    const element = createElement(THREAD_TEMPLATES[template], {
      ...context,
      appUrl: this.appUrl,
    });
    const [html, text] = await Promise.all([
      render(element),
      render(element, { plainText: true }),
    ]);
    await this.db
      .insert(schema.deliveryJob)
      .values({
        kind: 'email',
        idempotencyKey: `email:${idempotencyKey}`,
        payload: { to, subject, html, text },
      })
      .onConflictDoNothing();
    await this.db.execute(sql`NOTIFY delivery`);
    this.logger.log(`Queued "${template}" to ${to}`);
  }

  private async send(
    to: string,
    subject: string,
    template: string,
    context: Record<string, unknown>,
    options: { references?: string } = {},
  ): Promise<void> {
    await this.mailer.sendMail({
      to,
      subject,
      template,
      context: { ...context, appUrl: this.appUrl },
      ...options,
    });
    this.logger.log(`Sent "${template}" to ${to}`);
  }
}
