import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailerModule } from '@nestjs-modules/mailer';
import { ReactAdapter } from '@webtre/nestjs-mailer-react-adapter';

import { MailService } from './mail.service.js';
import { proxyTransport } from './proxy.transport.js';

/** True once either delivery route (HTTP relay or SMTP) is configured. */
export function mailConfigured(config: ConfigService): boolean {
  return Boolean(
    config.get<string>('EMAIL_PROXY') ?? config.get<string>('MAIL_HOST'),
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

        if (!proxyUrl && !host && emailVerificationEnabled(config)) {
          throw new Error(
            'EMAIL_VERIFICATION_ENABLED requires either EMAIL_PROXY or MAIL_HOST/MAIL_PORT/MAIL_USER/MAIL_PASSWORD',
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
