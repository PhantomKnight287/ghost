import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthService } from '@thallesp/nestjs-better-auth';

import type { Auth } from '../src/lib/auth.js';

export const DATABASE_URL = process.env.TEST_DATABASE_URL;
export const S3_ENDPOINT = process.env.TEST_S3_ENDPOINT;

export const s3Credentials = {
  S3_ACCESS_KEY_ID: process.env.TEST_S3_ACCESS_KEY_ID ?? 'ghost',
  S3_SECRET_ACCESS_KEY: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'ghostsecret',
  S3_BUCKET: process.env.TEST_S3_BUCKET ?? 'ghost-e2e',
};

/** Suites need a throwaway Postgres and an S3 endpoint (RustFS from compose.yaml works), and are skipped without them. */
export const hasBackends = Boolean(DATABASE_URL && S3_ENDPOINT);

/** Serves the whole app on a random port, against the database and bucket global-setup.ts prepared. */
export async function startApp() {
  Object.assign(process.env, {
    DATABASE_URL,
    S3_ENDPOINT,
    ...s3Credentials,
    BETTER_AUTH_SECRET: 'e2e-secret-e2e-secret-e2e-secret',
    BETTER_AUTH_URL: 'http://127.0.0.1',
    EMAIL_VERIFICATION_ENABLED: 'false',
    ZOEKT_URL: '',
    GIT_SSH_HOST_KEY: '',
    OTEL_EXPORTER_OTLP_ENDPOINT: '',
    PYROSCOPE_SERVER_ADDRESS: '',
  });

  // Imported late so the module reads the environment set above.
  const { AppModule } = await import('../src/app.module.js');
  const { configureApp } = await import('../src/app.setup.js');
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');

  return {
    app,
    origin: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`,
  };
}

/** A fresh account with a session cookie for the API and an API key for git over HTTP. */
export async function signUp(app: INestApplication, username: string) {
  const auth = app.get<AuthService<Auth>>(AuthService).api;
  const email = `${username}@example.com`;
  const password = 'correct horse battery staple';
  const { user } = await auth.signUpEmail({
    body: { email, password, name: 'E2E', username },
  });
  const { headers } = await auth.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const { key } = await auth.createApiKey({ body: { userId: user.id } });

  return { cookie: headers.get('set-cookie') ?? '', key };
}
