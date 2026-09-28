import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';

export type ThreadTemplate =
  | 'thread-opened'
  | 'thread-comment'
  | 'thread-review'
  | 'thread-assigned'
  | 'thread-state';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  /** Auth forms live in the web app, so every link in an email points there. */
  private readonly appUrl: string;

  constructor(
    private readonly mailer: MailerService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('WEB_APP_URL') ?? 'http://localhost:3000';
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
    }: {
      template: ThreadTemplate;
      threadId: string;
      subject: string;
      context: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.send(to, subject, template, context, {
      references: `<${threadId}@${new URL(this.appUrl).hostname}>`,
    });
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
