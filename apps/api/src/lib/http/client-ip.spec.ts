import { describe, expect, it } from 'vitest';

import { clientIp } from './client-ip.js';

describe('clientIp', () => {
  it('reads X-Real-IP on Railway and ignores X-Forwarded-For there', () => {
    expect(
      clientIp(
        {
          headers: { 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' },
          ip: '10.0.0.1',
        },
        true,
      ),
    ).toBe('1.1.1.1');
  });

  it('leaves the headers to trust proxy elsewhere', () => {
    expect(
      clientIp(
        {
          headers: { 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' },
          ip: '10.0.0.1',
        },
        false,
      ),
    ).toBe('10.0.0.1');
  });

  it('falls back to the socket address without a header', () => {
    expect(clientIp({ headers: {}, ip: '10.0.0.1' }, false)).toBe('10.0.0.1');
  });
});
