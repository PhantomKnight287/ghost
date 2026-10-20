import {
  type INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Express } from 'express';

import { DomainErrorFilter } from './filters/domain-error/domain-error.filter.js';
import { GIT_TRANSPORT_ROUTES } from './git/git.constants.js';
import { githubOrigins } from './lib/github/origins.js';

export const OAUTH_ROUTES = [
  { path: 'login/device/code', method: RequestMethod.POST },
  { path: 'login/oauth/access_token', method: RequestMethod.POST },
  { path: 'login/oauth/authorize', method: RequestMethod.GET },
];

/** What every running instance needs, shared by `main.ts` and the end-to-end suite so the two cannot drift. The app must be created with `bodyParser: false`. */
export function configureApp(app: INestApplication) {
  // Caddy and the web server reach the API over the private network, so only their X-Forwarded-For sets req.ip; a request straight to the published port keeps its own address.
  const server: Express = app.getHttpAdapter().getInstance();
  server.set('trust proxy', 'loopback, linklocal, uniquelocal');
  // Node closes idle connections after 5s, the same as gh's device-flow poll interval, so a reused connection races the close and resets; outlast clients and proxies instead.
  app.getHttpServer().keepAliveTimeout = 65_000;
  // A clone URL opened in a browser lands on the repository's page. A plain route, registered ahead of Nest's, so `/api/<resource>` falls through: excluding `:username/:repo` from the prefix would also unprefix every `<resource>/:id` route.
  // The API is for clients, not crawlers; the web app is what search engines should index. The spec stays open so agents can read it.
  server.get('/robots.txt', (_req, res) => {
    res
      .type('text/plain')
      .send('User-agent: *\nAllow: /openapi.json\nDisallow: /\n');
  });
  const { web } = githubOrigins(app.get(ConfigService));
  server.get('/:username/:repo', (req, res, next) => {
    const { username, repo } = req.params;
    if (username === 'api') return next();
    res.redirect(
      `${web}/${encodeURIComponent(username)}/${encodeURIComponent(repo.replace(/\.git$/, ''))}`,
    );
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new DomainErrorFilter());
  // offset all CRUD apis to /api prefix so it does not conflict with git's rest stuff
  app.setGlobalPrefix('/api', {
    exclude: [...GIT_TRANSPORT_ROUTES, ...OAUTH_ROUTES],
  });
}
