import { Injectable } from '@nestjs/common';
import { runGit } from '../exec/run-git.js';

@Injectable()
export class BranchesService {
  async getGitBranches(gitDir: string) {
    const raw = await runGit({
      args: ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'],
      gitDir,
    });
    return raw.split('\n').filter(Boolean);
  }
}
