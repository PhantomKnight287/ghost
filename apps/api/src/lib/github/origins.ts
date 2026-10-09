import type { ConfigService } from '@nestjs/config';

/** Where GitHub-shaped responses point: browser links at the web app, API links and clone URLs at the API, SSH clone URLs at the SSH host. */
export function githubOrigins(config: ConfigService) {
  return {
    api: config.getOrThrow<string>('BETTER_AUTH_URL').replace(/\/$/, ''),
    web: config.get<string>('WEB_APP_URL', 'http://localhost:3000').replace(/\/$/, ''),
    sshHost: config.get<string>('SSH_CLONE_HOST', ''),
  };
}

export type GithubOrigins = ReturnType<typeof githubOrigins>;
