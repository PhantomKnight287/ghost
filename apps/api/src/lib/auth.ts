import { apiKey } from '@better-auth/api-key';
import { type Database } from '@ghost/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization, username } from 'better-auth/plugins';

import { ac, roles } from './permissions.js';

export type AuthConfig = {
  secret: string;
  baseURL: string;
  trustedOrigins?: string[];
  /**
   * Registrable domain to pin session cookies to, e.g. `.example.com`, when the
   * web app and the API sit on sibling subdomains. Unset in local development,
   * where both share `localhost`.
   */
  cookieDomain?: string;
  /**
   * Set only when email verification is enabled (EMAIL_VERIFICATION_ENABLED);
   * self-hosted instances without mail configured leave it unset.
   */
  sendVerificationEmail?: (data: {
    email: string;
    name?: string;
    url: string;
  }) => Promise<void>;
  /** Set whenever mail is configured; password reset needs no verification flag. */
  sendResetPassword?: (data: {
    email: string;
    name?: string;
    url: string;
  }) => Promise<void>;
  /** Origin of the web app, which owns the verify and reset forms. */
  webAppUrl?: string;
};

/**
 * better-auth defaults `callbackURL` to `/`, which resolves against the API.
 * Point relative callbacks at the web app instead, where the forms live.
 */
export function withWebCallback(url: string, webAppUrl?: string): string {
  if (!webAppUrl) return url;
  const parsed = new URL(url);
  const callback = parsed.searchParams.get('callbackURL') ?? '/';
  if (!/^https?:\/\//.test(callback)) {
    parsed.searchParams.set('callbackURL', new URL(callback, webAppUrl).href);
  }
  return parsed.href;
}

export function createAuth(db: Database, config: AuthConfig) {
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins ?? [],
    advanced: config.cookieDomain
      ? {
          crossSubDomainCookies: {
            enabled: true,
            domain: config.cookieDomain,
          },
        }
      : undefined,
    database: drizzleAdapter(db, {
      provider: 'pg',
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: Boolean(config.sendVerificationEmail),
      sendResetPassword: config.sendResetPassword
        ? async ({ user, url }) =>
            config.sendResetPassword!({
              email: user.email,
              name: user.name,
              url: withWebCallback(url, config.webAppUrl),
            })
        : undefined,
    },
    emailVerification: config.sendVerificationEmail
      ? {
          sendOnSignUp: true,
          autoSignInAfterVerification: true,
          sendVerificationEmail: async ({ user, url }) =>
            config.sendVerificationEmail!({
              email: user.email,
              name: user.name,
              url: withWebCallback(url, config.webAppUrl),
            }),
        }
      : undefined,
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: 'owner',
        defaultRole: 'read',
        dynamicAccessControl: {
          enabled: true,
        },
        teams: {
          enabled: true,
          allowRemovingAllTeams: true,
        },
      }),
      username({}),
      apiKey({
        defaultPrefix: 'ghost_pat_',
        rateLimit: {
          enabled: true,
          maxRequests: 120,
          timeWindow: 60000, // 120 reqs in 1 min
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
