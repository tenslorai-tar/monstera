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
import { rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GITLEAKS_VERSION, gitleaksBinaryPath } from './gitleaks.mjs';
import { fileExists } from '../lib/fetchVerified.mjs';

const RACERS = 3;
const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = resolve(HERE, '..', '..', '.tools');

/**
 * @returns {Promise<{ status: number, output: string }>}
 */
function raceOne() {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [resolve(HERE, 'gitleaks.mjs')], { encoding: 'utf8' });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('close', (status) => resolveRun({ status: status ?? 1, output }));
  });
}

async function main() {
  // Cold start: without this every racer takes the already-provisioned fast
  // path and the race the proof exists to test never happens.
  await rm(TOOLS, { recursive: true, force: true });

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
    const probe = await new Promise((resolveProbe) => {
      const child = spawn(binary, ['version'], { encoding: 'utf8' });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.on('error', () => resolveProbe(''));
      child.on('close', () => resolveProbe(out));
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
  const leftovers = `${dirname(binary)}.staging`;
  if (await fileExists(leftovers)) failures.push(`staging directory survived: ${leftovers}`);

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
