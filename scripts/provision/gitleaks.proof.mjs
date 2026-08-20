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
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  GITLEAKS_VERSION,
  gitleaksBinaryPath,
  probeOutsideStaging,
  publish,
  reportsPinnedVersion,
  transienceNote,
} from './gitleaks.mjs';
import { compareContents, fileExists } from '../lib/fetchVerified.mjs';
import { createRoster } from '../lib/passRoster.mjs';
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

/**
 * Errnos that mean "something is holding this", as distinct from "the
 * destination is in the way". ENOTEMPTY and EEXIST are deliberately absent:
 * those are states of the filesystem, and waiting does not change them.
 */
const HELD_CODES = new Set(['EPERM', 'EACCES', 'EBUSY', 'ETXTBSY']);

/** Long enough for a scanner to finish with a small file; arbitrary otherwise. */
const RETRY_AFTER_MS = 500;

/**
 * Renames, and if the platform refuses with a held-looking errno, waits and
 * tries once more — reporting which of those happened.
 *
 * **This is an instrument, not a retry policy, and the difference is the whole
 * point.** The caller fails its case either way; the second attempt buys
 * evidence and nothing else. A retry that SUCCEEDS is direct evidence of a
 * transient handle on something inside the directory — an open handle blocking
 * RENAME, this project's Part K mechanism. A retry that fails identically says
 * the cause is something else, and that a copy-then-spawn repair would not have
 * helped.
 *
 * Nothing in `gitleaks.mjs` does this. Accommodating the state is a decision
 * that has not been taken; measuring whether the state is transient is not the
 * same act, and this one goes red either way.
 *
 * @param {string} from
 * @param {string} to
 * @returns {Promise<{ ok: true, held: null } | { ok: true, held: string } | { ok: false, first: string, second: string }>}
 */
async function renameMeasuringTransience(from, to) {
  try {
    await rename(from, to);
    return { ok: true, held: null };
  } catch (error) {
    const first = /** @type {NodeJS.ErrnoException} */ (error).code ?? '';
    if (!HELD_CODES.has(first)) return { ok: false, first, second: first };

    await setTimeout(RETRY_AFTER_MS);
    try {
      await rename(from, to);
      return { ok: true, held: first };
    } catch (again) {
      return { ok: false, first, second: /** @type {NodeJS.ErrnoException} */ (again).code ?? '' };
    }
  }
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

  // Each label is recorded by the case that earns it. The roster used to be a
  // fixed block printed at the end: deleting a case left its line, and the
  // staging-survivor case below had no line at all, so the same block both
  // over- and under-reported. See scripts/lib/passRoster.mjs.
  const roster = createRoster(failures);

  let mark = roster.mark();
  results.forEach((result, index) => {
    if (result.status !== 0) {
      failures.push(`racer ${index + 1} exited ${result.status}:\n${result.output}`);
    }
  });
  roster.record(mark, `${RACERS} concurrent provisioners all succeeded`);

  mark = roster.mark();
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
  roster.record(mark, `published binary runs and reports ${GITLEAKS_VERSION}`);

  mark = roster.mark();
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
  // This case had no line in the old fixed roster at all — the same block that
  // could outlive a deleted case also silently omitted a live one.
  roster.record(mark, 'no staging directories survive a completed provision');

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
  mark = roster.mark();
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
  roster.record(mark, 'CONTROL: renaming a directory onto an occupied path fails');

  // Corrupt the published binary the way a killed download does: the file is
  // present, so every existence check is satisfied, and it cannot run.
  // ---------------------------------------------------------------------------
  // Abandoned quarantines are swept; a live owner's is not.
  //
  // `publish` names its quarantine `<version>.superseded-<pid>` and removed only
  // that exact path, so a later run computed a different pid and never touched
  // the real one. The implementation's comment claimed "the next run cleans it
  // up"; nothing did, and the leftovers case below asserted a property the code
  // merely hoped for.
  //
  // Planted BEFORE the repair case so the sweep is exercised by a publish that
  // was going to happen anyway — this costs no extra download.
  // ---------------------------------------------------------------------------
  // Certainly not running: a process started and waited for. Pid reuse between
  // reaping and the check would make the case FAIL rather than pass quietly,
  // which is the direction an unreliable fixture is allowed to be wrong in.
  const deadPid = spawnSync(process.execPath, ['--version']).pid;
  const abandoned = `${versionDirectory}.superseded-${String(deadPid)}`;
  const liveOwned = `${versionDirectory}.superseded-${String(process.pid)}`;
  for (const planted of [abandoned, liveOwned]) {
    await rm(planted, { recursive: true, force: true });
    await mkdir(planted, { recursive: true });
    await writeFile(join(planted, 'placeholder'), 'x');
  }

  mark = roster.mark();
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
  roster.record(mark, 'a corrupted install is repaired without --force');

  mark = roster.mark();
  if (await directoryExists(abandoned)) {
    failures.push(
      `${abandoned} survived a publish. Its owning process is gone, so nothing will ever ` +
        `reclaim it: the old removal named one exact path built from the CURRENT pid, which is ` +
        `a name no later run computes. Leftovers accumulate forever and the case below asserts ` +
        `a property the implementation only hoped for.`,
    );
  }
  roster.record(mark, "a quarantine abandoned by a dead process is swept by the next publish");

  // The control, and it is the hazard rather than a formality: `publish` rolls
  // back THROUGH its quarantine, so between its two renames that directory is
  // the only copy of a working tool. A sweep that took a live racer's would
  // turn a cleanup into the outage it exists to prevent.
  mark = roster.mark();
  if (!(await directoryExists(liveOwned))) {
    failures.push(
      `CONTROL: ${liveOwned} was swept while its owning process is still running. Sweeping by ` +
        `name alone deletes the directory a racer is about to restore from. A dead pid cannot ` +
        `be a running owner; a live one may be an unrelated process, and skipping it costs one ` +
        `leftover — that is the safe direction and this case is what holds it.`,
    );
  }
  await rm(liveOwned, { recursive: true, force: true });
  roster.record(mark, 'CONTROL: a quarantine owned by a LIVE process is left alone');

  mark = roster.mark();

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
  roster.record(mark, 'a healthy install is left untouched by a re-run');

  mark = roster.mark();

  // Quarantine directories are cleaned up, like staging ones.
  const leftovers = (await readdir(dirname(versionDirectory), { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.name.startsWith(`${basename(versionDirectory)}.superseded`))
    .map((entry) => entry.name);
  if (leftovers.length > 0) {
    failures.push(`quarantine director${leftovers.length === 1 ? 'y' : 'ies'} survived: ${leftovers.join(', ')}`);
  }
  roster.record(mark, 'no quarantine directories survive the swap');

  // ---------------------------------------------------------------------------
  // Nothing spawns an executable out of a directory that is about to be renamed.
  //
  // The defect these cases guard took Guards down at 93cd471 and had passed CI
  // many times before that. `provisionGitleaks` ran the STAGED binary to check
  // its version and handed the same tree to `publish` five lines later; on
  // Windows the image section outlives the process, and a directory holding a
  // file with an outstanding handle cannot be renamed. Measured from the log:
  // EPERM renaming into an ABSENT destination, and the identical tree removed
  // successfully milliseconds afterwards.
  //
  // These are deterministic on every platform, which is the point of the guard
  // — the bug they replace was intermittent and Windows-only, so every green run
  // was evidence for the wrong conclusion.
  // ---------------------------------------------------------------------------
  const binaryName = basename(binary);
  const scratchRoot = await mkdtemp(join(tmpdir(), 'monstera-spawnsite-'));

  mark = roster.mark();
  {
    const pretendStaging = join(scratchRoot, 'staging-a');
    await mkdir(pretendStaging, { recursive: true });
    await copyFile(binary, join(pretendStaging, binaryName));

    const probe = await probeOutsideStaging(join(pretendStaging, binaryName), GITLEAKS_VERSION);

    // The POSITIVE control comes first: without it, "ran from somewhere else" is
    // satisfied by a probe that ran nothing at all, which is the reassuring
    // answer a broken probe also gives.
    if (!probe.ok) {
      failures.push(
        `the version probe said no for a copy of the binary this proof just published and ran. ` +
          `Every claim below about WHERE it ran is worthless if it did not run.`,
      );
    }
    if (resolve(probe.ranFrom).startsWith(resolve(pretendStaging))) {
      failures.push(
        `the probe executed from ${probe.ranFrom}, which is inside the tree publish renames. ` +
          `That is the 93cd471 defect exactly: the spawn leaves an image-section handle on the ` +
          `directory the next step has to move.`,
      );
    }
  }
  roster.record(mark, 'the version probe runs from OUTSIDE the tree that gets renamed');

  mark = roster.mark();
  {
    // RESOLUTION for the case above. A probe that answered yes unconditionally
    // would satisfy it, and would also publish a truncated download.
    const notABinary = join(scratchRoot, 'decoy');
    await mkdir(notABinary, { recursive: true });
    await writeFile(join(notABinary, binaryName), 'this is not an executable');
    const decoy = await probeOutsideStaging(join(notABinary, binaryName), GITLEAKS_VERSION);
    if (decoy.ok) {
      failures.push(
        `the probe said yes for a file that is not an executable, so it is not measuring ` +
          `runnability and the staged-copy check is decoration.`,
      );
    }
    // The three ways `false` happens are three different repairs, and the
    // caller's message used to assert the first of them while naming a file it
    // had not executed. `could not start` is what a lost executable bit looks
    // like on POSIX — the assumption this whole design rests on.
    if (decoy.why !== 'could not start') {
      failures.push(
        `a file that cannot be executed was reported as "${decoy.why}". Copy failure, a binary ` +
          `that will not start, and a binary that starts and reports the wrong version send a ` +
          `reader to three different places; collapsing them sends everyone to the pin table.`,
      );
    }
    if (!decoy.detail.trim()) {
      failures.push(
        `the probe reported no detail for a failed spawn. The errno IS the diagnosis — that is ` +
          `why 8130551 exists, and why today's EPERM was solvable from a log at all.`,
      );
    }
  }
  roster.record(mark, 'RESOLUTION: the probe says no, and says WHICH of the three ways');

  mark = roster.mark();
  {
    // A copy that cannot happen at all: the source does not exist. Separated
    // from the case above because "I could not make a copy" and "the copy will
    // not run" are the two the old single message conflated.
    const absent = await probeOutsideStaging(join(scratchRoot, 'nope', binaryName), GITLEAKS_VERSION);
    if (absent.ok || absent.why !== 'copy failed') {
      failures.push(
        `probing a source that does not exist reported ok=${String(absent.ok)}, ` +
          `why="${absent.why}". It must name the copy step, or the failure is attributed to a ` +
          `binary nothing ever tried to run.`,
      );
    }
  }
  roster.record(mark, 'a copy that cannot be made is reported as the copy step');

  mark = roster.mark();
  {
    // ITEM 4a on the transience instrument. Only the CLEARED branch has ever
    // run — the PERSISTED branch is the one that says a retry would not have
    // helped, and an instrument that decides whether a retry is legal and has
    // never been shown to say NO is exactly the blind instrument this checklist
    // is about. Both branches, fed values differing only by the thing that
    // changes the verdict.
    const cleared = transienceNote({ code: 'EPERM', removed: true, elapsedMs: 3, tree: '/x' });
    const persisted = transienceNote({ code: 'EPERM', removed: false, elapsedMs: 3, tree: '/x' });
    const quiet = transienceNote({ code: null, removed: true, elapsedMs: 3, tree: '/x' });

    if (!cleared.includes('CLEARED') || !persisted.includes('PERSISTED')) {
      failures.push(
        `the instrument did not separate a block that cleared from one that did not:\n` +
          `  removed=true  -> ${cleared || '(nothing)'}\n  removed=false -> ${persisted || '(nothing)'}`,
      );
    }
    if (cleared === persisted) {
      failures.push(
        `both outcomes printed the same sentence, so the measurement distinguishes nothing — ` +
          `which is the failure mode of every blind instrument in this project's record.`,
      );
    }
    if (persisted.includes('external') || !persisted.includes('not the answer')) {
      failures.push(
        `the PERSISTED branch pointed at the falsification control or failed to say a retry is ` +
          `not the answer. That branch exists to STOP a retry, and it is the one nothing has ` +
          `ever executed in anger:\n  ${persisted}`,
      );
    }
    if (quiet !== '') {
      failures.push(
        `a run where nothing held anything still printed a measurement: ${quiet}. Then every ` +
          `successful provision carries a line about a block that did not happen.`,
      );
    }
  }
  roster.record(mark, 'RESOLUTION: the transience instrument says PERSISTED, not only CLEARED');

  mark = roster.mark();
  {
    // The guard itself, armed through the SAME function the product uses, so
    // this exercises the recording and the refusal rather than a test double.
    const armed = join(scratchRoot, 'armed');
    await mkdir(armed, { recursive: true });
    await copyFile(binary, join(armed, binaryName));
    reportsPinnedVersion(join(armed, binaryName), GITLEAKS_VERSION);

    const destination = join(scratchRoot, 'armed-destination');
    let refused = '';
    try {
      await publish({
        staging: armed,
        versionDirectory: destination,
        binary: join(destination, binaryName),
        force: false,
      });
    } catch (error) {
      refused = `${error instanceof Error ? error.message : String(error)}`;
    }
    if (!refused.includes('started an executable out of it')) {
      failures.push(
        `publish renamed a directory this process had spawned from, or refused it for some other ` +
          `reason: ${refused || '(it did not refuse at all)'}. The guard exists to make an ` +
          `intermittent, Windows-only EPERM into a deterministic refusal everywhere — a bug that ` +
          `only sometimes appears on one platform is one that CI reports as fine.`,
      );
    }
    await rm(destination, { recursive: true, force: true }).catch(() => undefined);
  }
  roster.record(mark, 'publish REFUSES to rename a tree this process spawned from');

  mark = roster.mark();
  {
    // CONTROL: the refusal is about the spawn, not about publishing in general.
    // Without this the case above passes for a publish that never works.
    const clean = join(scratchRoot, 'clean');
    await mkdir(clean, { recursive: true });
    await copyFile(binary, join(clean, binaryName));

    const destination = join(scratchRoot, 'clean-destination');
    let published = true;
    try {
      await publish({
        staging: clean,
        versionDirectory: destination,
        binary: join(destination, binaryName),
        force: false,
      });
    } catch (error) {
      published = false;
      failures.push(
        `CONTROL: publishing a tree nothing was spawned from failed:\n${formatError(error)}\n` +
          `The case above then proves only that publish always refuses.`,
      );
    }
    if (published && !(await fileExists(join(destination, binaryName)))) {
      failures.push(`CONTROL: publish reported success but ${destination} holds no binary.`);
    }
    await rm(destination, { recursive: true, force: true }).catch(() => undefined);
  }
  roster.record(mark, 'CONTROL: publish still works on a tree nothing was spawned from');

  await rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined);

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
  roster.record(mark, 'CONTROL: the comparison fixture really cannot be started here');

  mark = roster.mark();
  const sameVerdict = await compareContents(original, identical);
  if (sameVerdict.kind !== 'same') {
    failures.push(
      `two byte-identical files compared ${sameVerdict.kind}, not same. This is the input the ` +
        `old design could not represent: unstartable, and yet exactly the binary we staged. ` +
        `Deciding by "does it run" answers no here and destroys a correct install.`,
    );
  }
  roster.record(mark, 'an unstartable file is still recognised as the staged bytes');

  mark = roster.mark();

  // The smallest difference that changes a decision: same length, one byte.
  // A size-only comparison passes every case above and fails this one.
  const offVerdict = await compareContents(original, oneByteOff);
  if (offVerdict.kind !== 'different') {
    failures.push(
      `two same-length files differing in one byte compared ${offVerdict.kind}, not different. ` +
        `A truncated or tampered binary of the right size would then be kept.`,
    );
  }
  roster.record(mark, 'a one-byte difference at equal length is recognised as different');

  mark = roster.mark();
  const shorterVerdict = await compareContents(original, shorter);
  if (shorterVerdict.kind !== 'different') {
    failures.push(`files of different sizes compared ${shorterVerdict.kind}, not different.`);
  }
  roster.record(mark, 'files of different sizes are recognised as different');

  mark = roster.mark();

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
  roster.record(mark, 'an unreadable destination is neither same nor different');

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
  mark = roster.mark();
  const preserved = `${versionDirectory}.preserved`;
  await rm(preserved, { recursive: true, force: true });

  // The setup is INSIDE the case now. It used to be three bare statements at
  // the top level of main(), and when this first rename threw EPERM on a
  // Windows runner the whole proof died before a single roster line printed:
  // thirteen cases, no output, exit 1. Y-1 made the roster true about the run;
  // this is the same property failing through the other door, where the run
  // ends before the roster can speak at all.
  //
  // Note what this rename follows: the previous case ran the provisioner, which
  // spawned gitleaks.exe from inside this very directory. Every site that has
  // failed here is a rename of a directory that held an executable started
  // moments earlier.
  const moved = await renameMeasuringTransience(versionDirectory, preserved);

  /** @type {{ status: number, output: string }} */
  let reported = { status: 0, output: '' };
  let induced = false;

  if (!moved.ok) {
    failures.push(
      `could not move the install aside to induce a publish failure: ${moved.first} first, ` +
        `${moved.second === moved.first ? 'the same after' : `${moved.second} after`} ` +
        `${RETRY_AFTER_MS} ms.\n` +
        `MEASUREMENT: the retry did NOT succeed, so this is not a handle that clears on its ` +
        `own, and copy-then-spawn would not have prevented it.`,
    );
  } else {
    try {
      if (moved.held !== null) {
        failures.push(
          `MEASUREMENT: renaming ${versionDirectory} failed with ${moved.held} and SUCCEEDED ` +
            `${RETRY_AFTER_MS} ms later, with nothing else changed. That is a transient handle ` +
            `on something inside a directory whose executable was spawned moments earlier — an ` +
            `open handle blocking RENAME. The case fails deliberately: this is evidence, not a ` +
            `retry policy, and the repair is to spawn from somewhere the binary is not about to ` +
            `move from.`,
        );
      }

      // Occupied, but holding no binary — so `publish` measures
      // fileExists(binary) as false and takes the plain-rename path at the
      // bottom, which fails onto an occupied destination. Deterministic on both
      // platforms, and it is the same syscall the control above just measured.
      await mkdir(versionDirectory, { recursive: true });
      await writeFile(join(versionDirectory, 'decoy'), 'x');

      reported = await raceOne();
      induced = true;
    } catch (error) {
      // A throw anywhere in this body would otherwise end main() before the
      // roster prints, which is the defect above wearing different clothes: the
      // report is not false, it simply never happens. Recorded as a failure so
      // the run still says what it did.
      failures.push(`the errno case threw instead of reporting:\n${formatError(error)}`);
    } finally {
      // try/finally, not two statements in sequence. The comment here used to
      // say that restoring before asserting meant a failure could not leave
      // later steps without a scanner — true for a failure AFTER the restore,
      // and nothing at all protected a throw between the rename above and this
      // point. Had the EPERM landed one line later, .tools/gitleaks/<version>
      // would have been renamed away and every later step in that job would
      // have run without a scanner.
      await rm(versionDirectory, { recursive: true, force: true });
      const back = await renameMeasuringTransience(preserved, versionDirectory);
      if (!back.ok) {
        failures.push(
          `could not restore ${versionDirectory} from ${preserved}: ${back.first} first, ` +
            `${back.second} after ${RETRY_AFTER_MS} ms. Later steps in this job have no ` +
            `scanner, and that is a fact about the job rather than about this case.`,
        );
      } else if (back.held !== null) {
        failures.push(
          `MEASUREMENT: restoring ${versionDirectory} failed with ${back.held} and succeeded ` +
            `${RETRY_AFTER_MS} ms later — a second observation of the same transient handle.`,
        );
      }
    }
  }

  if (!induced) {
    // Nothing was measured, so nothing below may report on the reporter.
  } else if (reported.status === 0) {
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
  roster.record(
    mark,
    `a publish failure names the errno (${occupiedRenameCode}), not just the operation`,
  );

  if (failures.length > 0) {
    process.stderr.write(`\n${failures.length} provisioning proof failure(s):\n\n${failures.join('\n\n')}\n`);
    return 1;
  }

  process.stdout.write(roster.format('provisioning case'));
  return 0;
}

/**
 * `fileExists` is `stat().isFile()` and so answers false for a directory, which
 * is exactly the mistake that once made the staging-survivor case false by
 * construction. This asks the question the quarantine cases need.
 *
 * @param {string} path
 * @returns {Promise<boolean>}
 */
function directoryExists(path) {
  return stat(path)
    .then((entry) => entry.isDirectory())
    .catch(() => false);
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
