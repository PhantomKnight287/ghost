import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { ReactAdapter } from '@webtre/nestjs-mailer-react-adapter';

import { MailService } from './mail.service.js';
import { proxyTransport } from './proxy.transport.js';

/** The local sendmail binary: SENDMAIL_PATH, else the first `sendmail` on PATH or in the usual sbin directories. Windows has none built in; a drop-in such as sendmail.exe on PATH is found the same way. */
export function sendmailPath(
  config: ConfigService,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const configured = config.get<string>('SENDMAIL_PATH');
  if (configured) return configured;
  const dirs = [
    ...(env.PATH ?? '').split(delimiter),
    '/usr/sbin',
    '/usr/lib',
  ].filter(Boolean);
  const names =
    process.platform === 'win32' ? ['sendmail.exe', 'sendmail'] : ['sendmail'];
  return dirs
    .flatMap((dir) => names.map((name) => join(dir, name)))
    .find((file) => existsSync(file));
}

/** True once any delivery route (HTTP relay, SMTP, or a local sendmail) is available. */
export function mailConfigured(config: ConfigService): boolean {
  return Boolean(
    config.get<string>('EMAIL_PROXY') ||
      config.get<string>('MAIL_HOST') ||
      sendmailPath(config),
  );
}

/** Self-hosters without mail configured keep email verification off. */
export function emailVerificationEnabled(config: ConfigService): boolean {
  return config.get<string>('EMAIL_VERIFICATION_ENABLED') === 'true';
}

@Global()
@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const proxyUrl = config.get<string>('EMAIL_PROXY');
        const host = config.get<string>('MAIL_HOST');
        const sendmail = proxyUrl || host ? undefined : sendmailPath(config);

        if (
          !proxyUrl &&
          !host &&
          !sendmail &&
          emailVerificationEnabled(config)
        ) {
          throw new Error(
            'EMAIL_VERIFICATION_ENABLED requires EMAIL_PROXY, MAIL_HOST/MAIL_PORT/MAIL_USER/MAIL_PASSWORD, or a sendmail binary',
          );
        }

        return {
          transport: proxyUrl
            ? proxyTransport(proxyUrl, config.get<string>('EMAIL_PROXY_SECRET'))
            : host
              ? {
                  host,
                  port: Number(config.get<string>('MAIL_PORT') ?? 587),
                  secure: config.get<string>('MAIL_SECURE') === 'true',
                  auth: {
                    user: config.getOrThrow<string>('MAIL_USER'),
                    pass: config.getOrThrow<string>('MAIL_PASSWORD'),
                  },
                }
              : sendmail
                ? { sendmail: true, path: sendmail }
                : // No mail configured and nothing sends mail: swallow instead of crashing.
                  { jsonTransport: true },
          defaults: {
            from:
              config.get<string>('EMAIL_SENDER') ??
              'Ghost <noreply@ghost.local>',
          },
          // Templates are compiled to dist/mail/templates alongside this module.
          template: {
            dir: join(import.meta.dirname, 'templates'),
            adapter: new ReactAdapter(),
          },
        };
      },
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
