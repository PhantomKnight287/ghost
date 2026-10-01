import type { ConfigService } from '@nestjs/config';

import { ImporterUnavailableError } from './imports.errors.js';

export type GitHubImportConfig = {
  importerUrl: string;
  importerSecret: string;
  github: { clientId: string; clientSecret: string };
};

export type ImportJob = {
  importId: string;
  attempt: string;
  source: string;
  destination: string;
  githubToken: string;
  ghostToken: string;
};

const DISPATCH_TIMEOUT_MS = 10_000;
const RETRY_BASE_MS = 30_000;
const RETRY_CAP_MS = 30 * 60_000;

/** Imports run only with all four set: the importer to hand jobs to, and the GitHub OAuth app that supplies a token for them. */
export function githubImportConfig(
  config: ConfigService,
): GitHubImportConfig | null {
  const importerUrl = config.get<string>('IMPORTER_URL');
  const importerSecret = config.get<string>('IMPORTER_SECRET');
  const clientId = config.get<string>('GITHUB_CLIENT_ID');
  const clientSecret = config.get<string>('GITHUB_CLIENT_SECRET');
  if (!importerUrl || !importerSecret || !clientId || !clientSecret) {
    return null;
  }
  return { importerUrl, importerSecret, github: { clientId, clientSecret } };
}

/** Exponential with full jitter, so importers recovering together are not hit by every waiting import at once. */
export function retryDelayMs(attempt: number, random = Math.random) {
  const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
  return Math.round(ceiling * random());
}

export async function dispatchToImporter(
  { importerUrl, importerSecret }: GitHubImportConfig,
  job: ImportJob,
) {
  const response = await fetch(new URL('/imports', importerUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${importerSecret}`,
    },
    body: JSON.stringify(job),
    signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
  }).catch((cause: unknown) => {
    throw new ImporterUnavailableError({ cause });
  });

  if (!response.ok) {
    throw new ImporterUnavailableError({
      cause: new Error(
        `importer answered ${response.status}: ${await response.text()}`,
      ),
    });
  }
}
