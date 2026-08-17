// @ts-check
/**
 * Proof that provisioning is safe under concurrency (rule B2).
 *
 * The bug this guards against: an implementation that clears the destination
 * and extracts into it lets one process delete the directory another is
 * mid-extraction into. What survives is a half-populated tree — and
 * `fileExists` is perfectly happy with a truncated binary, so the caller is
 * told the tool is ready. This matters far beyond gitleaks: the same primitive
 * provisions pdfium.dll, mutool and Ghostscript, where a half-written native
 * library is a crash with no useful stack rather than a clean error.
 *
 * Concurrency is not exotic here. A CI job with several steps, a pre-commit
 * hook racing a proof, or two terminals all reach it.
 *
 * The proof starts from a cold cache and races several provisioners. It passes
 * only if every one of them succeeds *and* the published binary actually runs.
 * The "actually runs" half is the load-bearing half — checking only for exit
 * code 0 would pass against a corrupted file.
 *
 * Usage: node scripts/provision/gitleaks.proof.mjs
 */

import { spawn } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GITLEAKS_VERSION, gitleaksBinaryPath } from './gitleaks.mjs';
import { fileExists } from '../lib/fetchVerified.mjs';

const RACERS = 3;
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The gitleaks subtree — `.tools/gitleaks` — derived from the path the
 * implementation itself publishes to, never from a hand-written string.
 *
 * This proof used to cold-start by deleting the whole `.tools` root. `.tools` is
 * the shared provisioning root for every native artefact the project downloads,
 * so the proof destroyed tools it does not own. That is not hypothetical: it
 * deleted a 69 MB MuPDF source download mid-flight the first time a second
 * artefact existed, and the failure surfaced as an unrelated ENOENT on rename
 * inside the *other* provisioner.
 *
 * @returns {string}
 */
function gitleaksToolDirectory() {
  return dirname(dirname(gitleaksBinaryPath()));
}

/**
 * Runs one provisioner and collects everything it wrote.
 *
 * `spawn` has no `encoding` option — that is `spawnSync` — so the option passed
 * here previously was silently ignored and every chunk arrived as a Buffer,
 * concatenated onto a string by implicit coercion. It happened to read correctly
 * for ASCII output and would have split a multi-byte character across a chunk
 * boundary. Decoding explicitly says what is actually happening.
 *
 * @returns {Promise<{ status: number, output: string }>}
 */
function raceOne() {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [resolve(HERE, 'gitleaks.mjs')], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    /** @type {Buffer[]} */
    const chunks = [];
    child.stdout.on('data', (/** @type {Buffer} */ chunk) => chunks.push(chunk));
    child.stderr.on('data', (/** @type {Buffer} */ chunk) => chunks.push(chunk));
    child.on('close', (/** @type {number | null} */ status) =>
      resolveRun({ status: status ?? 1, output: Buffer.concat(chunks).toString('utf8') }),
    );
  });
}

async function main() {
  // Cold start: without this every racer takes the already-provisioned fast
  // path and the race the proof exists to test never happens. Scoped to the
  // gitleaks subtree — see gitleaksToolDirectory for what deleting the whole
  // root cost.
  await rm(gitleaksToolDirectory(), { recursive: true, force: true });

  const results = await Promise.all(Array.from({ length: RACERS }, raceOne));

  /** @type {string[]} */
  const failures = [];

  results.forEach((result, index) => {
    if (result.status !== 0) {
      failures.push(`racer ${index + 1} exited ${result.status}:\n${result.output}`);
    }
  });

  const binary = gitleaksBinaryPath();
  if (!(await fileExists(binary))) {
    failures.push(`no binary at ${binary} after ${RACERS} concurrent provisions.`);
  } else {
    /** @type {string} */
    const probe = await new Promise((resolveProbe) => {
      const child = spawn(binary, ['version'], { stdio: ['ignore', 'pipe', 'ignore'] });
      /** @type {Buffer[]} */
      const chunks = [];
      child.stdout.on('data', (/** @type {Buffer} */ chunk) => chunks.push(chunk));
      child.on('error', () => resolveProbe(''));
      child.on('close', () => resolveProbe(Buffer.concat(chunks).toString('utf8')));
    });
    if (!`${probe}`.includes(GITLEAKS_VERSION)) {
      failures.push(
        `the published binary does not report ${GITLEAKS_VERSION} when run — it exists but ` +
          `is not usable, which is the exact outcome a file-existence check would have missed. ` +
          `Got: ${JSON.stringify(probe)}`,
      );
    }
  }

  // Leaves nothing behind: a staging directory that survives means the publish
  // path exited without cleaning up.
  //
  // This assertion used to be false by construction, twice over. It tested
  // `${dirname(binary)}.staging`, but the implementation only ever creates
  // `${versionDirectory}.staging-${pid}` — a name that never matches — and it
  // tested with `fileExists`, which is `stat().isFile()` and so returns false
  // for a directory even when the name did match. Deleting the cleanup entirely
  // left two staging directories on disk and this proof still reported success.
  //
  // Enumerating the parent removes both mistakes: the pid suffix cannot be
  // guessed, so it must not be predicted.
  const versionDirectory = dirname(binary);
  const stagingPrefix = `${basename(versionDirectory)}.staging`;
  const siblings = await readdir(dirname(versionDirectory), { withFileTypes: true }).catch(() => []);
  const survivors = siblings
    .filter((entry) => entry.name.startsWith(stagingPrefix))
    .map((entry) => entry.name);

  if (survivors.length > 0) {
    failures.push(
      `${survivors.length} staging director${survivors.length === 1 ? 'y' : 'ies'} survived in ` +
        `${dirname(versionDirectory)}: ${survivors.join(', ')}`,
    );
  }

  if (failures.length > 0) {
    process.stderr.write(`\n${failures.length} provisioning proof failure(s):\n\n${failures.join('\n\n')}\n`);
    return 1;
  }

  process.stdout.write(`  ok  ${RACERS} concurrent provisioners all succeeded\n`);
  process.stdout.write(`  ok  published binary runs and reports ${GITLEAKS_VERSION}\n`);
  process.stdout.write('\n2 provisioning cases passed.\n');
  return 0;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  },
);
