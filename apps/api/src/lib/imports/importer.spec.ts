import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { attributed } from './attribution.js';
import {
  dispatchToImporter,
  githubImportConfig,
  retryDelayMs,
} from './importer.js';
import { ImporterUnavailableError } from './imports.errors.js';

const complete = {
  IMPORTER_URL: 'http://importer:3004',
  IMPORTER_SECRET: 'secret',
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'client-secret',
};

afterEach(() => vi.unstubAllGlobals());

describe('githubImportConfig', () => {
  it('is set only when all four values are', () => {
    expect(githubImportConfig(new ConfigService(complete))).toEqual({
      importerUrl: 'http://importer:3004',
      importerSecret: 'secret',
      github: { clientId: 'id', clientSecret: 'client-secret' },
    });
    for (const key of Object.keys(complete)) {
      expect(
        githubImportConfig(new ConfigService({ ...complete, [key]: '' })),
      ).toBeNull();
    }
  });
});

describe('retryDelayMs', () => {
  it('doubles per attempt up to half an hour, scaled by the jitter', () => {
    expect(retryDelayMs(1, () => 1)).toBe(30_000);
    expect(retryDelayMs(3, () => 1)).toBe(120_000);
    expect(retryDelayMs(20, () => 1)).toBe(30 * 60_000);
    expect(retryDelayMs(3, () => 0.5)).toBe(60_000);
  });
});

describe('attributed', () => {
  it('credits the GitHub author above the body', () => {
    expect(attributed('octocat', 'Opened', 'Body')).toBe(
      '_Opened by [@octocat](https://github.com/octocat) on GitHub._\n\nBody',
    );
    expect(attributed('octocat', 'Posted', null)).toBe(
      '_Posted by [@octocat](https://github.com/octocat) on GitHub._',
    );
  });
});

describe('dispatchToImporter', () => {
  const config = githubImportConfig(new ConfigService(complete))!;
  const job = {
    importId: 'import_1',
    attempt: 'a',
    source: 'octo/repo',
    destination: 'me/repo',
    githubToken: 'gh',
    ghostToken: 'ghost',
  };

  it('posts the job with the secret', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal('fetch', fetch);
    await dispatchToImporter(config, job);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('http://importer:3004/imports');
    expect(init.headers.Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body)).toEqual(job);
  });

  it('fails when the importer refuses or cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('busy', { status: 503 })),
    );
    await expect(dispatchToImporter(config, job)).rejects.toBeInstanceOf(
      ImporterUnavailableError,
    );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );
    await expect(dispatchToImporter(config, job)).rejects.toBeInstanceOf(
      ImporterUnavailableError,
    );
  });
});
