import {
  type Database,
} from '@ghost/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { organization, username } from 'better-auth/plugins';

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
    },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: 'owner',
        defaultRole: 'read',
        dynamicAccessControl: {
          enabled:true,
        },
        teams: {
          enabled: true,
          allowRemovingAllTeams: true,
        },
      }),
      username({})
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
