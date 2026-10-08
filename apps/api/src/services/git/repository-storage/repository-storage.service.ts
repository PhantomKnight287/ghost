import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runGit } from '../../../lib/git/exec/run-git.js';
import { InvalidRepositoryPathError } from '../../../lib/repositories/repositories.errors.js';

const CACHE_ROOT = path.join(os.tmpdir(), 'ghost');

@Injectable()
export class RepositoryStorageService {
  /** Local cache directory for a repository. Keyed by the row id so renaming a user or a repository never moves the cache or orphans its log. */
  async getRepoPath(repositoryId: string) {
    const dir = this.pathFor(repositoryId);
    // A directory left without HEAD by a failed or interrupted init is initialised again rather than trusted.
    if (!existsSync(path.join(dir, 'HEAD'))) {
      // git init makes the repository's own directory but not the cache root above it.
      await mkdir(dir, { recursive: true });
      await runGit({ args: ['init', '--quiet', '--bare'], gitDir: dir });
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
