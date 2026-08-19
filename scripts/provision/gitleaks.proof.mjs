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

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GITLEAKS_VERSION, gitleaksBinaryPath } from './gitleaks.mjs';
import { compareContents, fileExists } from '../lib/fetchVerified.mjs';
import { formatError } from '../lib/reportError.mjs';

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

  // ---------------------------------------------------------------------------
  // Publishing decides from the destination's measured state, not from a flag.
  //
  // The shape this replaces deleted the destination when --force was passed and
  // left it alone otherwise, which got both cases backwards: a working install
  // was destroyed on request, and a BROKEN one survived every re-run that did
  // not happen to pass the flag. Recovering from a truncated binary — the exact
  // thing an interrupted download leaves behind — required knowing to pass an
  // option nothing tells you about.
  // ---------------------------------------------------------------------------

  // Control first: confirm rename-onto-an-occupied-directory really does fail,
  // because that is what made the old code throw instead of repairing. If this
  // ever stops being true, the case below passes for the wrong reason.
  const occupied = `${versionDirectory}.control-occupied`;
  await rm(occupied, { recursive: true, force: true });
  await mkdir(occupied, { recursive: true });
  await writeFile(join(occupied, 'placeholder'), 'x');
  let renameOntoOccupiedFailed = false;
  // The errno is captured, not written down: it differs across platforms and
  // the last case below compares the provisioner's own output against whatever
  // this machine actually throws.
  /** @type {string} */
  let occupiedRenameCode = '';
  try {
    await rename(occupied, versionDirectory);
  } catch (error) {
    renameOntoOccupiedFailed = true;
    occupiedRenameCode = /** @type {NodeJS.ErrnoException} */ (error).code ?? '';
  }
  await rm(occupied, { recursive: true, force: true });
  if (!renameOntoOccupiedFailed) {
    failures.push(
      'CONTROL: renaming a directory onto an occupied path was expected to fail, but it ' +
        'succeeded. The repair case below then proves nothing about compare-and-swap, because ' +
        'a plain rename would have worked all along.',
    );
  }

  // Corrupt the published binary the way a killed download does: the file is
  // present, so every existence check is satisfied, and it cannot run.
  await writeFile(binary, Buffer.from('not an executable'));
  const repair = await raceOne();
  const repaired = (await fileExists(binary)) && spawnedVersion(binary).includes(GITLEAKS_VERSION);
  if (repair.status !== 0 || !repaired) {
    failures.push(
      `a corrupted install was NOT repaired by a plain re-run (exit ${repair.status}). This is ` +
        `the state an interrupted download leaves, and it must not require --force to fix:\n` +
        repair.output,
    );
  }

  // A good install is left alone, so the fast path stays fast and the check
  // above is not passing merely because everything is always replaced.
  const before = await readdir(versionDirectory);
  const second = await raceOne();
  const after = await readdir(versionDirectory);
  if (second.status !== 0 || before.join(',') !== after.join(',')) {
    failures.push(
      `a healthy install was disturbed by a re-run (exit ${second.status}): ` +
        `${before.join(',')} became ${after.join(',')}`,
    );
  }

  // Quarantine directories are cleaned up, like staging ones.
  const leftovers = (await readdir(dirname(versionDirectory), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.name.startsWith(`${basename(versionDirectory)}.superseded`))
    .map((entry) => entry.name);
  if (leftovers.length > 0) {
    failures.push(`quarantine director${leftovers.length === 1 ? 'y' : 'ies'} survived: ${leftovers.join(', ')}`);
  }

  // ---------------------------------------------------------------------------
  // What decides the swap is content, and content is not runnability.
  //
  // `publish` used to decide by spawning the destination and asking its
  // version. That question answers `false` for two unrelated facts — "this is
  // the wrong binary" and "I could not start it just this instant" — and only
  // the first is a reason to replace anything. A scanner holding a freshly
  // published .exe open produces the second, and it was authorising a rename of
  // a directory another racer may have mapped.
  //
  // The case below is the resolution test for exactly that conflation (audit
  // item 4a): ONE input, TWO questions, and they must give DIFFERENT answers.
  // A file that cannot be started but is byte-identical to what we staged is
  // the input the old design could not represent.
  // ---------------------------------------------------------------------------
  const scratch = await mkdtemp(join(tmpdir(), 'monstera-publish-'));
  const original = join(scratch, 'original');
  const identical = join(scratch, 'identical');
  const oneByteOff = join(scratch, 'one-byte-off');
  const shorter = join(scratch, 'shorter');
  await writeFile(original, 'gitleaks pretend payload');
  await writeFile(identical, 'gitleaks pretend payload');
  await writeFile(oneByteOff, 'gitleaks pretend payloaD');
  await writeFile(shorter, 'gitleaks pretend');

  // Positive control: the input really is unstartable, on this machine, now.
  // Without it the case below could pass against a file the platform happened
  // to run, and would then be comparing two questions that agree.
  const startAttempt = spawnSync(original, ['version'], { encoding: 'utf8' });
  const cannotStart = startAttempt.error !== undefined || startAttempt.status !== 0;

  if (!cannotStart) {
    failures.push(
      `CONTROL: ${original} was expected to be unstartable and the platform ran it. The case ` +
        `below then compares two questions that agree, which is the one shape that proves ` +
        `nothing about separating them.`,
    );
  }

  const sameVerdict = await compareContents(original, identical);
  if (sameVerdict.kind !== 'same') {
    failures.push(
      `two byte-identical files compared ${sameVerdict.kind}, not same. This is the input the ` +
        `old design could not represent: unstartable, and yet exactly the binary we staged. ` +
        `Deciding by "does it run" answers no here and destroys a correct install.`,
    );
  }

  // The smallest difference that changes a decision: same length, one byte.
  // A size-only comparison passes every case above and fails this one.
  const offVerdict = await compareContents(original, oneByteOff);
  if (offVerdict.kind !== 'different') {
    failures.push(
      `two same-length files differing in one byte compared ${offVerdict.kind}, not different. ` +
        `A truncated or tampered binary of the right size would then be kept.`,
    );
  }

  const shorterVerdict = await compareContents(original, shorter);
  if (shorterVerdict.kind !== 'different') {
    failures.push(`files of different sizes compared ${shorterVerdict.kind}, not different.`);
  }

  // A failed read must not look like an answer (audit item 4b). `different`
  // here would send publish down the destructive path on no evidence at all —
  // which is the same defect one level along.
  const missingVerdict = await compareContents(original, join(scratch, 'absent'));
  if (missingVerdict.kind !== 'unreadable') {
    failures.push(
      `comparing against a missing file reported ${missingVerdict.kind}. "I could not look" and ` +
        `"they differ" license opposite actions, so folding them together reintroduces the ` +
        `defect this comparison exists to remove.`,
    );
  }

  await rm(scratch, { recursive: true, force: true });

  // ---------------------------------------------------------------------------
  // A publish failure names the errno, not merely the operation.
  //
  // `publish` attaches the failing rename as `cause`, and every top-level
  // handler under scripts/ used to print `error.stack` — which does not include
  // `cause`. So this is what a red Windows runner produced on 2026-08-19:
  //
  //   Error: Could not publish gitleaks to D:\a\…\.tools\gitleaks\8.30.1
  //       at publish (…/gitleaks.mjs:268:13)
  //
  // EPERM, EACCES, EBUSY and ENOTEMPTY are four different mechanisms with four
  // different repairs, and that text distinguishes none of them. An instrument
  // that cannot separate the things it exists to separate is audit item 4a.
  //
  // This case belongs here rather than beside the reporter's unit cases because
  // it is the only one that runs the real entry point: a passing provision
  // never prints an error, so nothing else in this repository would notice the
  // reporter regressing.
  // ---------------------------------------------------------------------------
  const preserved = `${versionDirectory}.preserved`;
  await rm(preserved, { recursive: true, force: true });
  await rename(versionDirectory, preserved);
  // Occupied, but holding no binary — so `publish` measures fileExists(binary)
  // as false and takes the plain-rename path at the bottom, which fails onto an
  // occupied destination. Deterministic on both platforms, and it is the same
  // syscall the control above just measured.
  await mkdir(versionDirectory, { recursive: true });
  await writeFile(join(versionDirectory, 'decoy'), 'x');

  const reported = await raceOne();

  // Restored before anything is asserted, so a failure here cannot leave later
  // steps in this job without a scanner.
  await rm(versionDirectory, { recursive: true, force: true });
  await rename(preserved, versionDirectory);

  if (reported.status === 0) {
    failures.push(
      'publishing onto an occupied destination was expected to fail and did not, so the errno ' +
        'case measured nothing. An empty induced failure passes every check below by having ' +
        'nothing to print.',
    );
  } else if (!reported.output.includes('Could not publish gitleaks to')) {
    failures.push(
      `the induced failure was not the publish failure this case exists to print, so whatever ` +
        `it did print says nothing about the reporter:\n${reported.output}`,
    );
  } else if (occupiedRenameCode === '' || !reported.output.includes(occupiedRenameCode)) {
    failures.push(
      `the provisioner reported a publish failure without the errno ` +
        `(expected ${occupiedRenameCode === '' ? '<none captured>' : occupiedRenameCode}):\n` +
        `${reported.output}\n` +
        `The errno is the diagnosis. Printing error.stack discards the attached cause, which is ` +
        `how a red board produced an argument instead of a measurement.`,
    );
  }

  if (failures.length > 0) {
    process.stderr.write(`\n${failures.length} provisioning proof failure(s):\n\n${failures.join('\n\n')}\n`);
    return 1;
  }

  process.stdout.write(`  ok  ${RACERS} concurrent provisioners all succeeded\n`);
  process.stdout.write(`  ok  published binary runs and reports ${GITLEAKS_VERSION}\n`);
  process.stdout.write('  ok  control renaming onto an occupied directory fails\n');
  process.stdout.write('  ok  a corrupted install is repaired without --force\n');
  process.stdout.write('  ok  a healthy install is left untouched by a re-run\n');
  process.stdout.write('  ok  no quarantine directories survive the swap\n');
  process.stdout.write('  ok  an unstartable file is still recognised as the staged bytes\n');
  process.stdout.write('  ok  a one-byte difference at equal length is recognised as different\n');
  process.stdout.write('  ok  an unreadable destination is neither same nor different\n');
  process.stdout.write(`  ok  a publish failure names the errno (${occupiedRenameCode}), not just the operation\n`);
  process.stdout.write('\n10 provisioning cases passed.\n');
  return 0;
}

/** @param {string} binary @returns {string} */
function spawnedVersion(binary) {
  const probe = spawnSync(binary, ['version'], { encoding: 'utf8' });
  return probe.error !== undefined ? '' : `${probe.stdout ?? ''}`;
}

main().then(
  (status) => process.exit(status),
  (error) => {
    process.stderr.write(`${formatError(error)}\n`);
    process.exit(1);
  },
);
