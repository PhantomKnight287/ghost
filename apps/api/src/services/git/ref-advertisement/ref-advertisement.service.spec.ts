import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { Test, TestingModule } from '@nestjs/testing';
import { RefAdvertisementService } from './ref-advertisement.service.js';

describe('RefAdvertisementService', () => {
  let service: RefAdvertisementService;
  let repoDirectory: string;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RefAdvertisementService],
    }).compile();

    service = module.get<RefAdvertisementService>(RefAdvertisementService);
    repoDirectory = mkdtempSync(path.join(tmpdir(), 'ghost-advertise-'));
    execFileSync('git', ['init', '-q', '--bare', repoDirectory]);
  });

  afterEach(() => rmSync(repoDirectory, { recursive: true, force: true }));

  it('answers a v2 client with capabilities instead of refs', async () => {
    const body = await text(
      service.advertise({
        repoDirectory,
        service: 'git-upload-pack',
        protocol: 'version=2',
      }),
    );

    expect(body).toContain('# service=git-upload-pack');
    expect(body).toContain('version 2');
    expect(body).toContain('ls-refs');
  });

  it('stays on v0 for anything but an exact version=2', async () => {
    const body = await text(
      service.advertise({
        repoDirectory,
        service: 'git-upload-pack',
        protocol: 'version=2:evil=1',
      }),
    );

    expect(body).not.toContain('version 2');
  });
});
