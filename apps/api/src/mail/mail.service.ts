import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerService } from '@nestjs-modules/mailer';

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

  private async send(
    to: string,
    subject: string,
    template: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    await this.mailer.sendMail({
      to,
      subject,
      template,
      context: { ...context, appUrl: this.appUrl },
    });
    this.logger.log(`Sent "${template}" to ${to}`);
  }
}
