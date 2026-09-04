import { Injectable } from '@nestjs/common';
import path from 'node:path';
import os from 'node:os';
import fs, { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

@Injectable()
export class RepositoryStorageService {
  /**
   * This function converts the username and repo to safe string and then ensures that the folder exists. WAL replay will be added soon.
   */
  async getRepoPath({ repo, username }: { username: string; repo: string }) {
    const potentiallyUnsafePath = `${username}/${repo}`;
    const safe = potentiallyUnsafePath
      .replace(/\.git$/, '')
      .replace(/[^a-zA-Z0-9._/-]/g, '');
    const dir = path.join(os.tmpdir(), safe + '.git');
    if (!fs.existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      spawnSync('git', ['init', '--bare', dir]);
    }
    return dir;
  }
}
