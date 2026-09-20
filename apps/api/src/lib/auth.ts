import { apiKey } from '@better-auth/api-key';
import { type Database, schema } from '@ghost/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api';
import { organization, username } from 'better-auth/plugins';
import { and, eq, sql } from 'drizzle-orm';

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
  /**
   * Set whenever mail is configured. Better Auth sends this to the address
   * currently on the account, which is what makes a change reversible.
   */
  sendChangeEmail?: (data: {
    email: string;
    name?: string;
    newEmail: string;
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

/** Endpoints that take an address in the body and look a user up by it. */
const EMAIL_LOOKUP_PATHS = ['/sign-in/email', '/request-password-reset'];

/**
 * Resolves one of an account's extra addresses to the one Better Auth knows.
 *
 * Better Auth keys identity on `user.email` and has no concept of a second
 * address, so the swap happens before its endpoint runs: it still sees a
 * single, familiar address. Only verified rows resolve, otherwise adding an
 * address would be enough to sign in as its owner.
 */
function resolvePrimaryEmail(db: Database) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path === '/change-email') {
      const body = ctx.body as { newEmail?: unknown } | undefined;
      const next =
        typeof body?.newEmail === 'string'
          ? body.newEmail.trim().toLowerCase()
          : null;
      if (!next) return;

      // Checked here as well as in the database hook, so a taken address is
      // refused before a verification mail goes out.
      const session = await getSessionFromCtx(ctx);
      await assertEmailAvailable(db, next, session?.user.id ?? null);
      return;
    }

    if (!EMAIL_LOOKUP_PATHS.includes(ctx.path)) return;

    const body = ctx.body as { email?: unknown } | undefined;
    const input = typeof body?.email === 'string' ? body.email : null;
    if (!input) return;

    const [match] = await db
      .select({ email: schema.user.email })
      .from(schema.userEmail)
      .innerJoin(schema.user, eq(schema.user.id, schema.userEmail.userId))
      .where(
        and(
          eq(schema.userEmail.email, input.trim().toLowerCase()),
          eq(schema.userEmail.verified, true),
        ),
      )
      .limit(1);

    if (!match) return;

    return { context: { body: { ...body, email: match.email } } };
  });
}

/**
 * Claims an address for an account before it is written to `user.email`.
 *
 * Better Auth enforces uniqueness against `user.email` alone, so without this
 * a change-email request could take over an address another account has
 * already verified as an extra. Claiming one of the account's own verified
 * extras is fine: the extra row is dropped so the address is not held twice.
 */
async function assertEmailAvailable(
  db: Database,
  email: string,
  userId: string | null,
) {
  const taken = () =>
    APIError.from('UNPROCESSABLE_ENTITY', {
      message: 'That email address is already taken',
      code: 'EMAIL_ALREADY_TAKEN',
    });

  const [[primaryOwner], [extraOwner]] = await Promise.all([
    db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(sql`lower(${schema.user.email})`, email)),
    db
      .select({
        id: schema.userEmail.id,
        userId: schema.userEmail.userId,
        verified: schema.userEmail.verified,
      })
      .from(schema.userEmail)
      .where(eq(schema.userEmail.email, email)),
  ]);

  if (primaryOwner && primaryOwner.id !== userId) throw taken();
  if (!extraOwner) return null;
  if (extraOwner.userId !== userId) throw taken();

  if (!extraOwner.verified) {
    throw APIError.from('UNPROCESSABLE_ENTITY', {
      message: 'Confirm that address from the link sent to it first',
      code: 'EMAIL_NOT_VERIFIED',
    });
  }

  return extraOwner.id;
}

/**
 * Same check, then the write: the account's own extra row is dropped so the
 * address is not held twice once it lands on `user.email`.
 */
async function claimEmailForAccount(
  db: Database,
  email: string,
  userId: string | null,
) {
  const extraId = await assertEmailAvailable(db, email, userId);
  if (!extraId) return;

  await db.delete(schema.userEmail).where(eq(schema.userEmail.id, extraId));
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
    hooks: { before: resolvePrimaryEmail(db) },
    databaseHooks: {
      user: {
        update: {
          before: async (data, context) => {
            const next =
              typeof data.email === 'string'
                ? data.email.trim().toLowerCase()
                : null;
            if (!next) return;

            await claimEmailForAccount(
              db,
              next,
              context?.context.session?.user.id ??
                (typeof data.id === 'string' ? data.id : null),
            );
          },
        },
      },
    },
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
    user: {
      changeEmail: {
        enabled: true,
        // With no mail configured there is nobody to confirm with, and an
        // unverified account would be stuck on its first address forever.
        updateEmailWithoutVerification: !config.sendChangeEmail,
        sendChangeEmailConfirmation: config.sendChangeEmail
          ? async ({ user, newEmail, url }) =>
              config.sendChangeEmail!({
                email: user.email,
                name: user.name,
                newEmail,
                url: withWebCallback(url, config.webAppUrl),
              })
          : undefined,
      },
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
