// @ts-check
/**
 * Starts the desktop shell on the provisioned Electron runtime.
 *
 * ## Why this file is under `scripts/` and not under `apps/desktop/`
 *
 * Invariant 26. This is plain Node — `node` starts it — and `scripts/` is the
 * only root where both enforcers of that invariant can see it. Under
 * `apps/desktop/` it would be invisible to both at once: ESLint's boundary is
 * per-package and exempts `desktop` by design, so a `.ts` launcher there is
 * *permitted*; and a `.mjs` one matches no package glob at all — they end
 * `.ts,.tsx` — so no rule would apply to it whatsoever. The scan's root stops at
 * `scripts/` as well. Both mechanisms would return the reassuring answer.
 *
 * Moving it is a B4 amendment, not a refactor.
 *
 * ## Why it CALLS `electronBinaryPath` rather than naming the path
 *
 * The name invariant 26 says to spawn is that function's return value, not a
 * string that happens to match it today. `electronBinaryPath` is
 * `join(electronRoot(root), buildFor(key).executable)`, and a literal would
 * hard-code two things the provisioner owns:
 *
 * - **the version**, which drifts the moment `ELECTRON_VERSION` bumps, and would
 *   then point at a directory that does not exist;
 * - **the extension**, which is `electron.exe` on Windows and plain `electron`
 *   on Linux — the platform CI runs `proof:electronimports` on.
 *
 * A second opinion about where the binary lives is B3a, and it would be the
 * first one written against an invariant that exists precisely so there is one
 * resolver.
 *
 * Usage: node scripts/launch.mjs [--...args passed through]
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fileExists } from './lib/fetchVerified.mjs';
import { electronBinaryPath } from './provision/electron.mjs';
import { formatError } from './lib/reportError.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The shell's main entry, as Electron expects to be handed it.
 *
 * A directory containing a `package.json` with a `main` field is what Electron
 * resolves; `apps/desktop` is that directory, and its `main` points into
 * `dist/`, so the build has to have run.
 */
const APP_DIRECTORY = resolve(REPO_ROOT, 'apps', 'desktop');

/**
 * Refuses rather than falling back when the runtime is absent.
 *
 * The fallback here would be `require('electron')`, which is the download
 * invariant 26 exists to make unreachable — so "not provisioned" must read as
 * an instruction to provision, never as a reason to find the binary some other
 * way.
 *
 * @returns {Promise<string>}
 */
async function resolveRuntime() {
  const binary = electronBinaryPath(REPO_ROOT);
  if (await fileExists(binary)) return binary;
  throw new Error(
    `No Electron runtime at ${binary}. Run \`npm run provision:electron\` — it fetches the ` +
      `pinned build and verifies it against a recorded SHA-256. Do NOT install the electron ` +
      `package's own binary: importing it is the download path invariant 26 forbids, and it ` +
      `is verified against a source \`electron_use_remote_checksums\` can repoint.`,
  );
}

async function main() {
  const binary = await resolveRuntime();
  const child = spawn(binary, [APP_DIRECTORY, ...process.argv.slice(2)], {
    stdio: 'inherit',
    // No shell. The path is composed from a pinned version and a platform key,
    // but a shell would reinterpret whatever the repository root happens to
    // contain — a space, an ampersand — and that is a quoting bug waiting for
    // the first contributor whose checkout lives under `Program Files`.
    shell: false,
  });

  child.on('exit', (code, signal) => {
    // The shell's exit status is this process's exit status. A launcher that
    // always exits 0 makes a crashed app look like a clean run to anything that
    // spawned it.
    process.exitCode = signal !== null ? 1 : (code ?? 1);
  });
  child.on('error', (error) => {
    process.stderr.write(`\n${formatError(error)}\n`);
    process.exitCode = 1;
  });
}

await main();
