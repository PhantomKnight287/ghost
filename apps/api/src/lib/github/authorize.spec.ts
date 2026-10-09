import { describe, expect, it } from 'vitest';

import { RepositoryNotFoundError } from '../repositories/repositories.errors.js';
import { orNull } from './authorize.js';

describe('orNull', () => {
  it('answers null for a refusal or a miss, which GitHub reads as "could not resolve"', async () => {
    await expect(
      orNull(Promise.reject(new RepositoryNotFoundError())),
    ).resolves.toBeNull();
  });

  it('lets any other failure through, so a database error is not reported as not found', async () => {
    const failure = new Error('connection refused');
    await expect(orNull(Promise.reject(failure))).rejects.toBe(failure);
  });
});
