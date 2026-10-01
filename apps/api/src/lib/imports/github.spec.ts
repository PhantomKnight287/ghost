import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertGitHubRepositoryReadable,
  listGitHubRepositories,
} from './github.js';
import {
  GitHubNotConnectedError,
  GitHubRepositoryNotFoundError,
  GitHubUnavailableError,
} from './imports.errors.js';

const raw = { full_name: 'octo/repo', private: true, description: null };

function answer(response: Response | Error) {
  const fetch =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('assertGitHubRepositoryReadable', () => {
  it('passes a readable repository', async () => {
    const fetch = answer(Response.json({}));
    await assertGitHubRepositoryReadable('tok', 'octo/repo');
    expect(fetch.mock.calls[0][0]).toBe(
      'https://api.github.com/repos/octo/repo',
    );
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('turns a 404 into not found', async () => {
    answer(new Response('', { status: 404 }));
    await expect(
      assertGitHubRepositoryReadable('tok', 'octo/repo'),
    ).rejects.toBeInstanceOf(GitHubRepositoryNotFoundError);
  });

  it('asks for GitHub to be linked again when the token is revoked', async () => {
    answer(new Response('', { status: 401 }));
    await expect(
      assertGitHubRepositoryReadable('tok', 'octo/repo'),
    ).rejects.toBeInstanceOf(GitHubNotConnectedError);
  });

  it('turns other failures into GitHub being unavailable', async () => {
    answer(new Response('', { status: 500 }));
    await expect(
      assertGitHubRepositoryReadable('tok', 'octo/repo'),
    ).rejects.toBeInstanceOf(GitHubUnavailableError);
    answer(new Error('ENOTFOUND'));
    await expect(
      assertGitHubRepositoryReadable('tok', 'octo/repo'),
    ).rejects.toBeInstanceOf(GitHubUnavailableError);
  });
});

describe('listGitHubRepositories', () => {
  const page = (size: number) =>
    Array.from({ length: size }, (_, index) => ({ ...raw, full_name: `octo/repo-${index}` }));

  it('lists repositories the user has direct access to, page by page', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(page(100)))
      .mockResolvedValueOnce(Response.json(page(1)));
    vi.stubGlobal('fetch', fetch);

    const repositories = await listGitHubRepositories('tok');
    expect(repositories).toHaveLength(101);
    expect(repositories[0]).toEqual({ fullName: 'octo/repo-0', private: true, description: null });
    expect(fetch.mock.calls[0][0]).toContain('/user/repos?sort=pushed&per_page=100&page=1&affiliation=owner,collaborator,organization_member');
    expect(fetch.mock.calls[1][0]).toContain('page=2');
  });

  it('stops after ten pages', async () => {
    const fetch = vi.fn().mockImplementation(async () => Response.json(page(100)));
    vi.stubGlobal('fetch', fetch);
    expect(await listGitHubRepositories('tok')).toHaveLength(1000);
    expect(fetch).toHaveBeenCalledTimes(10);
  });

  it('lists nothing when GitHub has nothing', async () => {
    answer(new Response('', { status: 404 }));
    expect(await listGitHubRepositories('tok')).toEqual([]);
  });
});
