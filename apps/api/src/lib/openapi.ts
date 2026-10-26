import { DocumentBuilder } from '@nestjs/swagger';

export const openApiConfig = new DocumentBuilder()
  .setTitle('Ghost')
  .setDescription("API reference for Ghost's API")
  .setVersion('0.0.1')
  .addBearerAuth(
    {
      type: 'http',
      scheme: 'bearer',
      description:
        'A personal access token (`ghost_pat_…`) from Settings, sent as `Authorization: Bearer <token>` or `Authorization: token <token>`. It acts as the account that created it. A token on a public route acts as its owner; a bad one is refused with 401. Email addresses, SSH, GPG and signing keys, OAuth apps and invitations by username refuse it with 403 and need a signed-in browser session. Tokens issued to OAuth apps carry scopes and work only on the GitHub-compatible API under `/api/v3` and `/api/graphql`. Twenty bad tokens from one address within a minute get 429. Each account gets 120 requests a minute by default, shared by its tokens and sessions; responses carry the GitHub `X-RateLimit-*` headers, and a 429 carries `Retry-After`. `GET /api`, avatar and attachment downloads and the importer callbacks are not counted and carry no such headers, nor does a 401 for a bad token.',
    },
    'token',
  )
  .addCookieAuth(
    'better-auth.session_token',
    {
      type: 'apiKey',
      in: 'cookie',
      description:
        'The session cookie the web app signs in with; served with a `__Secure-` prefix over HTTPS.',
    },
    'session',
  )
  .addSecurityRequirements('token')
  .addSecurityRequirements('session')
  .build();
