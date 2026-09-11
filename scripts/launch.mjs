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
 * ## Why it refuses a stale build rather than launching one
 *
 * This is the only caller of {@link refuseStaleBuild} whose output a person
 * reads instead of a proof. That makes it the one where staleness is
 * undetectable downstream: a proof that ran against an old bundle at least
 * prints cases somebody can compare, and a window does not. The refusal names
 * `npm run build`, because `npm run typecheck` produces neither bundle and is
 * the spelling habit reaches for.
 *
 * Usage: node scripts/launch.mjs [--...args passed through]
 *   or:  npm start [-- --...args]
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SHELL_LAUNCH, refuseStaleBuild } from './lib/buildFreshness.mjs';
import { fileExists } from './lib/fetchVerified.mjs';
import { electronBinaryPath } from './provision/electron.mjs';
import { pdfiumLibrary } from './provision/pdfium.mjs';
import { tessdataDirectory, tessdataPath } from './provision/tessdata.mjs';
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

/**
 * Where the shell should look for `pdfium.dll`, or nothing.
 *
 * ## Why the launcher answers this and the application does not
 *
 * `electronBinaryPath` is here for a stated reason — a second opinion about
 * where a provisioned artefact lives is B3a — and this is the same sentence with
 * a different binary. `apps/desktop` cannot call `pdfiumLibrary` itself:
 * `scripts/` is plain Node tooling and is not part of what a packaged
 * application ships, so an import would resolve in a checkout and vanish in a
 * build. So the one process that knows both the repository root and how to start
 * the shell passes the answer down.
 *
 * ## Absent is a decided state, not a failure to raise
 *
 * Unlike the runtime, PDFium is not needed to start: it backs the Stage 5
 * editing commands and nothing else. `engineHostPlatform.ts` answers `null` for
 * an unset variable and creates no PDFium host, and a command routed to a writer
 * with no registration is refused **by name** — which is what a user without
 * `npm run provision:pdfium` should get, rather than a shell that will not open.
 *
 * @returns {Promise<Record<string, string>>} the variables to add to the child's
 *   environment — empty when the library is not provisioned.
 */
async function pdfiumEnvironment() {
  const library = pdfiumLibrary(REPO_ROOT);
  if (!(await fileExists(library))) return {};
  return { MONSTERA_PDFIUM_LIBRARY: library };
}

/**
 * The OCR models' directory, passed the same way and for the same reasons.
 *
 * {@link pdfiumEnvironment}' shape one artefact along: `scripts/provision/
 * tessdata.mjs` owns where a provisioned model lives, `apps/desktop` cannot call
 * it, and absent is a decided state — OCR is offered only where a model is
 * present, so a checkout without `npm run provision:tessdata` gets a shell that
 * opens and does not offer recognition.
 *
 * **Keyed on `eng`'s presence rather than on the directory's.** The directory is
 * created by the first download, so an interrupted provision can leave it empty —
 * and an empty directory passed down is a datadir every recognition fails
 * against, which is the state that reads like a broken feature rather than an
 * unprovisioned one. `eng` is the model CI provisions and the one the surface
 * defaults to.
 *
 * @returns {Promise<Record<string, string>>} the variables to add to the child's
 *   environment — empty when no model is provisioned.
 */
async function tessdataEnvironment() {
  if (!(await fileExists(tessdataPath(REPO_ROOT, 'eng')))) return {};
  return { MONSTERA_TESSDATA_DIRECTORY: tessdataDirectory(REPO_ROOT) };
}

async function main() {
  refuseStaleBuild(REPO_ROOT, SHELL_LAUNCH, 7);
  const binary = await resolveRuntime();
  const child = spawn(binary, [APP_DIRECTORY, ...process.argv.slice(2)], {
    stdio: 'inherit',
    // THE PARENT'S ENVIRONMENT PLUS ONE, spelled out rather than left to the
    // default: `spawn` inherits the whole environment when `env` is omitted, and
    // an object holding only the addition would start the shell with no PATH,
    // no APPDATA and no TEMP.
    env: {
      ...process.env,
      ...(await pdfiumEnvironment()),
      ...(await tessdataEnvironment()),
    },
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

try {
  await main();
} catch (error) {
  // A PERSON reads this one. An unhandled rejection would print the same facts
  // buried in a stack trace under a runtime warning, and the two refusals this
  // file raises are both instructions — provision the runtime, run the build —
  // so the instruction is what has to survive to the terminal.
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
