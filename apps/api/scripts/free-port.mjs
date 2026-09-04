/**
 * Frees API_PORT before `nest start --watch` binds it.
 *
 * Two watchers for the same app are the real cause of the recurring
 * EADDRINUSE. The Nest CLI watcher keeps its tsc file-watcher alive even after
 * its child app process dies, and turbo can detach that watcher from the
 * `bun dev` that spawned it. A stale watcher is invisible — nothing on the
 * port, no app logs — until the next edit, when it recompiles and spawns its
 * own server on API_PORT, racing the watcher you actually meant to run.
 * Whoever loses prints "address already in use".
 *
 * Killing the port holder is not enough: the rival watcher survives and wins
 * the race on the *next* edit. So this kills any other Nest watcher for this
 * app, its descendants, and anything still listening on the port.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = process.env.API_PORT ?? '3001';
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    // A non-zero exit just means "no matches".
    return '';
  }
}

const lines = (output) =>
  output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

function pidsOnPort() {
  if (process.platform === 'win32') {
    return lines(run('netstat', ['-ano', '-p', 'tcp']))
      .filter((line) => line.includes(`:${port}`) && line.includes('LISTENING'))
      .map((line) => line.split(/\s+/).pop())
      .filter((pid) => pid && pid !== '0');
  }
  return lines(run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']));
}

/**
 * Other `nest start --watch` processes for *this* app. Matching on the app
 * directory keeps the blast radius to this workspace — a Nest watcher in
 * another checkout is left alone.
 */
function rivalWatchers() {
  if (process.platform === 'win32') return [];
  const ancestry = new Set(descendantsOf(String(process.pid)).concat(String(process.pid)));
  return lines(run('pgrep', ['-f', `${appDir}/node_modules/.bin/nest`])).filter(
    (pid) => !ancestry.has(pid),
  );
}

function descendantsOf(pid, seen = new Set()) {
  for (const child of lines(run('pgrep', ['-P', pid]))) {
    if (seen.has(child)) continue;
    seen.add(child);
    descendantsOf(child, seen);
  }
  return [...seen];
}

const watchers = rivalWatchers();
const targets = new Set([
  ...watchers,
  ...watchers.flatMap((pid) => descendantsOf(pid)),
  ...pidsOnPort(),
]);
targets.delete(String(process.pid));

for (const pid of targets) {
  try {
    // SIGKILL, not SIGTERM: a watcher whose shutdown hooks hang (e.g. waiting
    // on `pool.end()` against an unreachable database) is exactly the case
    // that leaves the port held.
    process.kill(Number(pid), 'SIGKILL');
    console.log(`[free-port] killed stale process ${pid}`);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      console.warn(`[free-port] could not kill ${pid}: ${error.message}`);
    }
  }
}
