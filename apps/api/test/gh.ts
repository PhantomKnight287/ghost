import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The hostname the gh suite serves on port 443; set in CI, where /etc/hosts maps it. The suite is skipped without it. */
export const GH_E2E_HOST = process.env.GH_E2E_HOST;

const certDir = path.resolve(import.meta.dirname, '../.gh-e2e');

export function tlsFiles() {
  const certPath = path.join(certDir, 'cert.pem');
  return {
    key: readFileSync(path.join(certDir, 'key.pem')),
    cert: readFileSync(certPath),
    certPath,
  };
}

/** Runs gh against the e2e host with its own config dir. Async because the server runs in this process. */
export function runGh(
  args: string[],
  {
    configDir,
    token,
    input,
  }: { configDir: string; token?: string; input?: string },
) {
  const { certPath } = tlsFiles();
  const child = spawn('gh', args, {
    env: {
      PATH: process.env.PATH ?? '',
      HOME: configDir,
      GH_CONFIG_DIR: configDir,
      GH_HOST: GH_E2E_HOST ?? '',
      GH_PROMPT_DISABLED: '1',
      GH_NO_UPDATE_NOTIFIER: '1',
      NO_COLOR: '1',
      GH_BROWSER: 'true',
      SSL_CERT_FILE: certPath,
      GIT_SSL_CAINFO: certPath,
      ...(token && { GH_ENTERPRISE_TOKEN: token }),
    },
  });
  if (input !== undefined) child.stdin.end(input);
  else child.stdin.end();

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  child.stderr.on('data', (chunk) => (stderr += chunk));
  return new Promise<{ stdout: string; stderr: string; code: number }>(
    (resolve) =>
      child.on('close', (code) =>
        resolve({ stdout, stderr, code: code ?? -1 }),
      ),
  );
}
