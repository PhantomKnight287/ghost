import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { InvalidRepositoryPathError } from '../../../lib/repositories/repositories.errors.js';
import { RepositoryStorageService } from './repository-storage.service.js';

describe('RepositoryStorageService', () => {
  const service = new RepositoryStorageService();
  const id = `spec_${process.pid}_${Date.now()}`;
  const dir = path.join(os.tmpdir(), 'ghost', `${id}.git`);

  afterEach(() => service.remove(id));

  it('initialises a bare repository for a new id', async () => {
    expect(await service.getRepoPath(id)).toBe(dir);
    expect(existsSync(path.join(dir, 'HEAD'))).toBe(true);
  });

  it('initialises a directory an interrupted init left without HEAD', async () => {
    await mkdir(dir, { recursive: true });
    await service.getRepoPath(id);
    expect(existsSync(path.join(dir, 'HEAD'))).toBe(true);
  });

  it('creates the cache root when it does not exist yet', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ghost-root-'));
    vi.stubEnv('TMPDIR', tmp);
    vi.resetModules();
    const { RepositoryStorageService: Fresh } = await import(
      './repository-storage.service.js'
    );
    try {
      const fresh = await new Fresh().getRepoPath(id);
      expect(fresh).toBe(path.join(tmp, 'ghost', `${id}.git`));
      expect(existsSync(path.join(fresh, 'HEAD'))).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('refuses an id that could escape the cache root', async () => {
    await expect(service.getRepoPath('../escape')).rejects.toBeInstanceOf(
      InvalidRepositoryPathError,
    );
  });
});
