import { withWebCallback } from './auth.js';

describe('withWebCallback', () => {
  const web = 'http://localhost:3000';

  it('points a relative callback at the web app', () => {
    expect(
      withWebCallback('http://api.test/api/auth/verify-email?token=t', web),
    ).toBe(
      'http://api.test/api/auth/verify-email?token=t&callbackURL=http%3A%2F%2Flocalhost%3A3000%2F',
    );
  });

  it('keeps an absolute callback the client already chose', () => {
    const url =
      'http://api.test/api/auth/reset-password/t?callbackURL=https%3A%2F%2Fapp.test%2Fauth%2Freset-password';
    expect(withWebCallback(url, web)).toBe(url);
  });

  it('leaves the url alone when no web app url is configured', () => {
    const url = 'http://api.test/api/auth/verify-email?token=t';
    expect(withWebCallback(url, undefined)).toBe(url);
  });
});
