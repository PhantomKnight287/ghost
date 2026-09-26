import { Injectable } from '@nestjs/common';
import path from 'node:path';
import os from 'node:os';
import fs, { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { InvalidRepositoryPathError } from '../../../resources/repositories/repositories.errors.js';

const CACHE_ROOT = path.join(os.tmpdir(), 'ghost');

@Injectable()
export class RepositoryStorageService {
  /** Local cache directory for a repository. Keyed by the row id so renaming a user or a repository never moves the cache or orphans its log. */
  async getRepoPath(repositoryId: string) {
    const dir = this.pathFor(repositoryId);
    if (!fs.existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      spawnSync('git', ['init', '--bare', dir]);
    }
    return dir;
  }

  async remove(repositoryId: string) {
    await rm(this.pathFor(repositoryId), { recursive: true, force: true });
  }

  private pathFor(repositoryId: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(repositoryId)) {
      throw new InvalidRepositoryPathError(`bad repository id`);
    }
    return path.join(CACHE_ROOT, `${repositoryId}.git`);
  }
}
