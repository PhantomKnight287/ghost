import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NonFastForwardError } from '../../../lib/git/wal/wal.errors.js';
import { ZERO_OID } from '../../../lib/git/wal/wal.types.js';
import { PullRefsService } from './pull-refs.service.js';

describe('PullRefsService', () => {
  let service: PullRefsService;
  let gitDir: string;
  let base: string;
  let head: string;
  const where = vi.fn().mockResolvedValue([]);
  const db = { select: () => ({ from: () => ({ where }) }) };

  const git = (...args: string[]) =>
    execFileSync('git', ['-C', gitDir, ...args], {
      encoding: 'utf8',
      input: '',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'a',
        GIT_AUTHOR_EMAIL: 'a@example.com',
        GIT_COMMITTER_NAME: 'a',
        GIT_COMMITTER_EMAIL: 'a@example.com',
      },
    }).trim();

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PullRefsService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    gitDir = mkdtempSync(path.join(tmpdir(), 'ghost-pull-refs-'));
    execFileSync('git', ['init', '-q', '--bare', gitDir]);
    const tree = git('hash-object', '-t', 'tree', '-w', '--stdin');
    const commit = (message: string, ...parents: string[]) =>
      git(
        'commit-tree',
        tree,
        ...parents.flatMap((parent) => ['-p', parent]),
        '-m',
        message,
      );
    base = commit('base');
    head = commit('head', base);
    git('update-ref', 'refs/pull/1/head', head);
    git('update-ref', 'refs/pull/1/merge', commit('merge', base, head));
  });

  afterEach(() => rmSync(gitDir, { recursive: true, force: true }));

  const reconcile = (baseSha: string, headSha: string) =>
    service.reconcileInBackground({
      pullRequestId: 'pr_1',
      number: 1,
      gitDir,
      baseSha,
      headSha,
    });

  it('leaves refs alone when they match the tips a reader resolved', async () => {
    const sync = vi
      .spyOn(service, 'syncInBackground')
      .mockImplementation(() => {});
    reconcile(base, head);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sync).not.toHaveBeenCalled();
  });

  it('reconciles pending accounting even when refs already match', async () => {
    where.mockResolvedValueOnce([{ id: 'pending-entry' }]);
    const sync = vi
      .spyOn(service, 'syncInBackground')
      .mockImplementation(() => {});
    reconcile(base, head);
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith('pr_1'));
  });

  it('syncs when the base moved past the test merge', async () => {
    const sync = vi
      .spyOn(service, 'syncInBackground')
      .mockImplementation(() => {});
    reconcile(head, head);
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith('pr_1'));
  });

  it('syncs when the merge ref is missing', async () => {
    git('update-ref', '-d', 'refs/pull/1/merge');
    const sync = vi
      .spyOn(service, 'syncInBackground')
      .mockImplementation(() => {});
    reconcile(base, head);
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith('pr_1'));
  });

  it('retries a sync that lost the race to a push, then gives up', async () => {
    const write = vi
      .spyOn(service as never as { write: () => Promise<void> }, 'write')
      .mockRejectedValue(new NonFastForwardError('refs/pull/1/head'));

    await expect(service.sync('pr_1')).rejects.toBeInstanceOf(
      NonFastForwardError,
    );
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('reruns once for every sync asked for while one is running', async () => {
    let finish!: () => void;
    const sync = vi
      .spyOn(service, 'sync')
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (finish = resolve)),
      )
      .mockResolvedValue(undefined);

    service.syncInBackground('pr_1');
    service.syncInBackground('pr_1');
    service.syncInBackground('pr_1');
    finish();

    await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('swallows a failed lookup, since the push it follows already landed', async () => {
    where.mockRejectedValueOnce(new Error('connection reset'));
    const sync = vi.spyOn(service, 'syncInBackground');

    await expect(
      service.syncAfterPush({
        repositoryId: 'repo_1',
        transitions: [
          { ref: 'refs/heads/main', oldOid: ZERO_OID, newOid: ZERO_OID },
        ],
      }),
    ).resolves.toBeUndefined();
    expect(sync).not.toHaveBeenCalled();
  });

  it('looks nothing up for a push that moved no branch', async () => {
    await service.syncAfterPush({
      repositoryId: 'repo_1',
      transitions: [
        { ref: 'refs/tags/v1', oldOid: ZERO_OID, newOid: ZERO_OID },
      ],
    });
    expect(where).not.toHaveBeenCalled();
  });
});
