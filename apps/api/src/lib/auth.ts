import { type Database } from '@ghost/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization, username } from 'better-auth/plugins';
import { apiKey } from '@better-auth/api-key';

import { ac, roles } from './permissions.js';

export type AuthConfig = {
  secret: string;
  baseURL: string;
  trustedOrigins?: string[];
};

export function createAuth(db: Database, config: AuthConfig) {
  return betterAuth({
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins ?? [],
    database: drizzleAdapter(db, {
      provider: 'pg',
    }),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async (data) => {
        console.log(data);
      },
    },
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
