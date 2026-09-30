import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';

import { mailConfigured, sendmailPath } from './mail.module.js';

const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('sendmail fallback', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ghost-sendmail-'));
    writeFileSync(
      join(dir, process.platform === 'win32' ? 'sendmail.exe' : 'sendmail'),
      '',
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('finds sendmail on PATH', () => {
    expect(sendmailPath(config({}), { PATH: dir })).toBe(
      join(dir, process.platform === 'win32' ? 'sendmail.exe' : 'sendmail'),
    );
  });

  it('prefers SENDMAIL_PATH', () => {
    expect(
      sendmailPath(config({ SENDMAIL_PATH: '/opt/bin/msmtp' }), { PATH: dir }),
    ).toBe('/opt/bin/msmtp');
  });

  it('treats empty relay and SMTP settings as unset', () => {
    expect(
      mailConfigured(config({ EMAIL_PROXY: '', MAIL_HOST: 'smtp.test' })),
    ).toBe(true);
  });
});
