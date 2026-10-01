import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { ConfigService } from '@nestjs/config';

import { mailConfigured, sendmailPath } from './mail.module.js';

/** Build a ConfigService stub whose getter reads the supplied settings. */
const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('sendmail fallback', () => {
  const name = process.platform === 'win32' ? 'sendmail.exe' : 'sendmail';
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ghost-sendmail-'));
    writeFileSync(join(dir, name), '', { mode: 0o755 });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('finds sendmail on PATH', () => {
    expect(sendmailPath(config({}), { PATH: dir })).toBe(join(dir, name));
  });

  it.skipIf(process.platform === 'win32')(
    'skips non-executable candidates on PATH',
    () => {
      const firstDir = join(dir, 'non-executable');
      mkdirSync(firstDir);
      writeFileSync(join(firstDir, name), '', { mode: 0o644 });

      expect(
        sendmailPath(config({}), { PATH: [firstDir, dir].join(delimiter) }),
      ).toBe(join(dir, name));
    },
  );

  it('skips directories on PATH', () => {
    const firstDir = join(dir, 'directory');
    mkdirSync(join(firstDir, name), { recursive: true });

    expect(
      sendmailPath(config({}), { PATH: [firstDir, dir].join(delimiter) }),
    ).toBe(join(dir, name));
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
