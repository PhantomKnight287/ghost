import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)(
  'Rate limits on sign-in, sign-up and reset',
  () => {
    let app: INestApplication;
    let addresses = 0;
    const password = 'correct horse battery staple';

    /** Every test signs in from its own address, so budgets never carry over. */
    const address = () => `203.0.113.${++addresses}`;
    const signIn = (ip: string, email: string, secret = password) =>
      request(app.getHttpServer())
        .post('/api/auth/sign-in/email')
        .set('x-real-ip', ip)
        .send({ email, password: secret });
    const account = async () => {
      const username = `rlauth${Date.now()}x${addresses}`;
      await signUp(app, username);
      return `${username}@example.com`;
    };

    beforeAll(async () => {
      vi.stubEnv('RAILWAY_SERVICE_ID', 'svc');
      ({ app } = await startApp({
        RATE_LIMIT_SIGN_IN_PER_MINUTE: '4',
        RATE_LIMIT_FAILED_SIGN_IN_PER_MINUTE: '2',
        RATE_LIMIT_SIGN_UP_PER_MINUTE: '2',
      }));
    });

    afterAll(async () => {
      vi.unstubAllEnvs();
      await app?.close();
    });

    it('limits sign-in attempts per IP', async () => {
      const email = await account();
      const ip = address();
      for (let i = 0; i < 4; i++) {
        const response = await signIn(ip, email).expect(200);
        expect(response.headers['x-ratelimit-resource']).toBe('auth');
      }
      const refused = await signIn(ip, email).expect(429);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(refused.headers['x-ratelimit-resource']).toBe('auth');
      expect(refused.headers['x-ratelimit-remaining']).toBe('0');
      expect(refused.body.message).toBe('API rate limit exceeded');
    });

    it('limits failed sign-ins more tightly', async () => {
      const email = await account();
      const ip = address();
      for (let i = 0; i < 2; i++) await signIn(ip, email, 'wrong').expect(401);
      await signIn(ip, email).expect(429);
    });

    it('limits sign-up and password reset per IP', async () => {
      const ip = address();
      const signUpAs = (username: string) =>
        request(app.getHttpServer())
          .post('/api/auth/sign-up/email')
          .set('x-real-ip', ip)
          .send({
            email: `${username}@example.com`,
            password,
            name: 'E2E',
            username,
          });
      const stamp = Date.now();
      await signUpAs(`rlsignup${stamp}a`).expect(200);
      await signUpAs(`rlsignup${stamp}b`).expect(200);
      await signUpAs(`rlsignup${stamp}c`).expect(429);
      await request(app.getHttpServer())
        .post('/api/auth/request-password-reset')
        .set('x-real-ip', ip)
        .send({ email: `rlsignup${stamp}a@example.com` })
        .expect(429);
    });

    it('counts a wrong current password as a failed sign-in', async () => {
      const email = await account();
      const ip = address();
      const { headers } = await signIn(address(), email).expect(200);
      const cookie = headers['set-cookie'] as unknown as string[];
      for (let i = 0; i < 2; i++) {
        const response = await request(app.getHttpServer())
          .post('/api/auth/change-password')
          .set('x-real-ip', ip)
          .set('origin', 'http://localhost:3000')
          .set('Cookie', cookie)
          .send({
            currentPassword: 'wrong',
            newPassword: 'another horse battery',
          });
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
      }
      await signIn(ip, email).expect(429);
    });

    it('limits change-email with sign-up, as it sends mail', async () => {
      const email = await account();
      const ip = address();
      const { headers } = await signIn(address(), email).expect(200);
      const cookie = headers['set-cookie'] as unknown as string[];
      const changeEmail = (to: string) =>
        request(app.getHttpServer())
          .post('/api/auth/change-email')
          .set('x-real-ip', ip)
          .set('origin', 'http://localhost:3000')
          .set('Cookie', cookie)
          .send({ newEmail: to });
      const stamp = Date.now();
      await changeEmail(`rlchange${stamp}a@example.com`);
      await changeEmail(`rlchange${stamp}b@example.com`);
      const refused = await changeEmail(`rlchange${stamp}c@example.com`);
      expect(refused.status).toBe(429);
      expect(refused.headers['x-ratelimit-resource']).toBe('auth');
    });

    it('counts IPs apart', async () => {
      const email = await account();
      const blocked = address();
      for (let i = 0; i < 2; i++)
        await signIn(blocked, email, 'wrong').expect(401);
      await signIn(blocked, email).expect(429);
      await signIn(address(), email).expect(200);
    });

    it('leaves get-session uncounted', async () => {
      const ip = address();
      for (let i = 0; i < 20; i++) {
        const response = await request(app.getHttpServer())
          .get('/api/auth/get-session')
          .set('x-real-ip', ip)
          .expect(200);
        expect(response.headers['x-ratelimit-limit']).toBeUndefined();
      }
    });

    it('still throttles an address after 20 bad tokens, now with Retry-After', async () => {
      const ip = address();
      const badToken = () =>
        request(app.getHttpServer())
          .get('/api/notifications')
          .set('x-real-ip', ip)
          .set('authorization', 'Bearer ghost_pat_nope');
      for (let i = 0; i < 20; i++) await badToken().expect(401);
      const refused = await badToken().expect(429);
      expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      expect(refused.headers['x-ratelimit-resource']).toBe('auth');
    });
  },
);
