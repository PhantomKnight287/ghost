import { Injectable } from '@nestjs/common';
import { runGit } from '../../../lib/git/exec/run-git.js';

@Injectable()
export class BranchesService {
  async getGitBranches(gitDir: string) {
    const raw = await runGit({
      // `short` would print `heads/v1` for a branch that shares its name with a tag
      args: ['for-each-ref', '--format=%(refname:strip=2)', 'refs/heads/'],
      gitDir,
    });
    return raw.split('\n').filter(Boolean);
  }
}
