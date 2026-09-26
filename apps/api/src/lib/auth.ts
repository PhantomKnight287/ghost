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

import { ac, roles } from '@ghost/permissions';

export type AuthConfig = {
  secret: string;
  baseURL: string;
  trustedOrigins?: string[];
  /** Registrable domain to pin session cookies to, e.g. `.example.com`, when the web app and the API sit on sibling subdomains. Unset in local development, where both share `localhost`. */
  cookieDomain?: string;
  /** Set only when email verification is enabled (EMAIL_VERIFICATION_ENABLED); self-hosted instances without mail configured leave it unset. */
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
  /** Set whenever mail is configured. Better Auth sends this to the address currently on the account, which is what makes a change reversible. */
  /** After an organization is gone: what it stored outside the database goes too. */
  onOrganizationDeleted?: (organizationId: string) => Promise<void>;
  sendOrganizationInvitation?: (data: {
    email: string;
    inviter: string;
    organization: string;
    role: string;
    url: string;
  }) => Promise<void>;
  sendChangeEmail?: (data: {
    email: string;
    name?: string;
    newEmail: string;
    url: string;
  }) => Promise<void>;
  /** Origin of the web app, which owns the verify and reset forms. */
  webAppUrl?: string;
};

/** better-auth defaults `callbackURL` to `/`, which resolves against the API. Point relative callbacks at the web app instead, where the forms live. */
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

/** Swaps an account's verified extra address for the `user.email` Better Auth knows (unverified ones must not let anyone sign in as the owner), and makes the organization slug check refuse a name a user or a route holds. */
function beforeAuthHooks(db: Database) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path === '/organization/check-slug') {
      const body = ctx.body as { slug?: unknown } | undefined;
      await assertNameFree(db, body?.slug, 'organization');
      return;
    }

    if (ctx.path === '/change-email') {
      const body = ctx.body as { newEmail?: unknown } | undefined;
      const next =
        typeof body?.newEmail === 'string'
          ? body.newEmail.trim().toLowerCase()
          : null;
      if (!next) return;

      // Checked here as well as in the database hook, so a taken address is refused before a verification mail goes out.
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
 * Better Auth checks uniqueness against `user.email` alone, so without this a change-email could take an address another account verified as an extra. Claiming the account's own extra drops that row instead.
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

/** The web app's own top-level routes: an account under one of these names would have no profile to reach. */
const RESERVED_NAMES = new Set([
  'api',
  'auth',
  'dashboard',
  'search',
  'settings',
]);

/** Why `name` cannot be taken as a username or an organization slug, or null when it can. `/name/repo` resolves a name to a user or an organization, so the two must never share one. Case is ignored, as both are matched lowercase. */
async function nameConflict(
  db: Database,
  name: string,
  taking: 'username' | 'organization',
) {
  const lowered = name.toLowerCase();
  if (RESERVED_NAMES.has(lowered)) return 'That name is reserved';

  const [taken] =
    taking === 'username'
      ? await db
          .select({ id: schema.organization.id })
          .from(schema.organization)
          .where(eq(sql`lower(${schema.organization.slug})`, lowered))
      : await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(sql`lower(${schema.user.username})`, lowered));
  if (!taken) return null;

  return taking === 'username'
    ? 'An organization already uses that name'
    : 'A user already has that name';
}

async function assertNameFree(
  db: Database,
  name: unknown,
  taking: 'username' | 'organization',
) {
  if (typeof name !== 'string') return;
  const conflict = await nameConflict(db, name, taking);
  if (!conflict) return;

  throw APIError.from('UNPROCESSABLE_ENTITY', {
    message: conflict,
    code: 'NAME_ALREADY_TAKEN',
  });
}

/** Better Auth's username availability check knows only users; an organization's slug or a route name is just as taken. */
function afterAuthHooks(db: Database) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== '/is-username-available') return;

    const returned = ctx.context.returned as { available?: unknown } | null;
    const body = ctx.body as { username?: unknown } | undefined;
    if (returned?.available !== true || typeof body?.username !== 'string') {
      return;
    }
    if (await nameConflict(db, body.username, 'username')) {
      return ctx.json({ available: false });
    }
  });
}

/** Same check, then the write: the account's own extra row is dropped so the address is not held twice once it lands on `user.email`. */
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
    hooks: { before: beforeAuthHooks(db), after: afterAuthHooks(db) },
    databaseHooks: {
      user: {
        create: {
          before: async (data) => {
            await assertNameFree(db, data.username, 'username');
          },
        },
        update: {
          before: async (data, context) => {
            await assertNameFree(db, data.username, 'username');

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
        // With no mail configured there is nobody to confirm with, and an unverified account would be stuck on its first address forever.
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
          sendOnSignIn: true,
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
        defaultRole: 'member',
        sendInvitationEmail: config.sendOrganizationInvitation
          ? async ({ id, email, role, organization, inviter }) =>
              config.sendOrganizationInvitation!({
                email,
                role,
                organization: organization.name,
                inviter: inviter.user.name,
                url: `${config.webAppUrl ?? ''}/auth/accept-invitation?invitationId=${id}`,
              })
          : undefined,
        organizationHooks: {
          beforeCreateOrganization: async ({ organization }) => {
            await assertNameFree(db, organization.slug, 'organization');
          },
          beforeUpdateOrganization: async ({ organization }) => {
            await assertNameFree(db, organization.slug, 'organization');
          },
          // Repository rows would cascade away while their stored history stayed behind; deleting a repository is what purges it (docs/0020).
          beforeDeleteOrganization: async ({ organization }) => {
            const [repository] = await db
              .select({ id: schema.repository.id })
              .from(schema.repository)
              .where(eq(schema.repository.organizationId, organization.id))
              .limit(1);
            if (!repository) return;

            throw APIError.from('CONFLICT', {
              message:
                'Delete or transfer the organization’s repositories first',
              code: 'ORGANIZATION_HAS_REPOSITORIES',
            });
          },
          afterCreateOrganization: async ({ organization }) => {
            await db
              .insert(schema.organizationSettings)
              .values({ organizationId: organization.id })
              .onConflictDoNothing();
          },
          afterDeleteOrganization: async ({ organization }) => {
            await config.onOrganizationDeleted?.(organization.id);
          },
        },
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
