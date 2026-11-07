import { CommitNotFoundError } from '../repositories/repositories.errors.js';
import { NoCommitFoundError } from './github.errors.js';

/** GitHub names the ref when it resolves to no commit, where its other 404s say only "Not Found". */
export async function onCommit<T>(ref: string, read: Promise<T>) {
  try {
    return await read;
  } catch (error) {
    if (error instanceof CommitNotFoundError) throw new NoCommitFoundError(ref);
    throw error;
  }
}
