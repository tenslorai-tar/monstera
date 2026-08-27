// @ts-check
/**
 * Does ADR-0027's grant actually let a contained host START — and is the grant
 * what makes the difference?
 *
 * ## The claim this exists to test, and why it was not already tested
 *
 * ADR-0027 rests on one prediction: the pinned Electron binary carries no
 * `ALL APPLICATION PACKAGES` ACE, an AppContainer's access check is
 * CONJUNCTIVE, therefore a contained host cannot execute the image — and
 * granting that principal fixes it. The first half is measured (`icacls` on the
 * binary, 2026-08-27, with `kernel32.dll` as the positive control). **The second
 * half was a prediction and nothing had run against it.** Four ACEs are on this
 * machine and no contained process had ever been started while they were there.
 *
 * `lowboxSpike.mjs` does start contained cells, and it is not this measurement:
 * it grants **its own container's SID**. ADR-0027 grants
 * `ALL APPLICATION PACKAGES` instead, deliberately — production reaches the
 * runtime through MSIX inheritance granting exactly that principal, so granting
 * the same one leaves *how the ACE arrived* as the only difference between the
 * two configurations. That substitution of principal is the untested step, and
 * a spike run says nothing about it.
 *
 * ## One variable: the grant
 *
 * | cell | grants | expected |
 * |---|---|---|
 * | `revoked`  | none — `ALL APPLICATION PACKAGES` removed from the set | must NOT reach its own code |
 * | `granted`  | the four ADR-0027 paths | must reach its own code |
 *
 * Same shipped surface, same container profile, same executable, same program.
 * Everything else is held fixed, so a difference is attributable to the grant.
 *
 * **The revoked cell is first, and the order is the mechanism rather than a
 * convention.** This machine is left granted by `provision:grants`, so a single
 * positive reading cannot separate *the grant works* from *it would have worked
 * anyway* — refusal and impossibility produce the same observation. Revoking
 * first is what builds the input from something that WOULD succeed if the guard
 * were absent, which is the only shape that separates them.
 *
 * ## The child is the REAL entry, and its own refusal is the marker
 *
 * `commandArguments[0]` is `packages/kernel/dist/host/hostEntry.js` — the
 * program the factory will name — started with **no pipe name**. `pipeNameFrom`
 * throws in that case by design, so an entry that reaches its own code writes a
 * recognisable diagnostic to the stderr handle this parent opened and inherited
 * to it.
 *
 * That buys two things a purpose-built child would have cost:
 *
 *   - **no harness grant.** A child script of our own would have to live
 *     somewhere the container can read, and granting a scratch directory to make
 *     the experiment run would put a fifth path into the very set under test.
 *     The diagnostic handle is opened by THIS process and inherited, so the
 *     child needs no rights on the log either.
 *   - **no substitution.** A probe that starts a different program answers a
 *     different question. The measurement is about the program the wiring will
 *     name.
 *
 * ## THREE outcomes, not two, because the middle one is the interesting one
 *
 *   `create-failed`  `CreateProcessW` refused. The token could not execute the
 *                    image at all — ADR-0027's predicted failure.
 *   `no-program`     the process started and never reached its own program. The
 *                    runtime is reachable and something else is not, which means
 *                    the grant set is INCOMPLETE rather than wrong.
 *   `ran`            the entry reached `pipeNameFrom` and refused. The grant set
 *                    is sufficient for a start.
 *
 * Folding `no-program` into a failure would report ADR-0027's prediction
 * confirmed for a cell that actually contradicts its completeness.
 *
 * **AND `no-program` CARRIES A STAGE, because without one this instrument
 * reported its own blindness as a finding.** Its first two-cell run put both
 * contained cells in that bucket and printed *the grant changed nothing
 * observable* — while the logs plainly showed one dying in Chromium's ICU
 * initialisation and the other in node's module loader. The bucket was too
 * coarse to hold the difference, so an absent distinction read exactly like an
 * empty one. The stage is derived from which layer wrote the diagnostic, and the
 * verdict compares outcome AND stage.
 *
 * **The two contained cells ARE this instrument's resolution test** (audit item
 * 4a): they are the smallest difference that could change the decision — one ACE
 * present or absent on four paths — and it reports them as different stages. The
 * uncontained cell is its positive control (item 4b), and it refuses rather than
 * reporting when it does not run.
 *
 * ## What this does NOT measure
 *
 * That the host WORKS contained — it is given no pipe, so it serves nothing.
 * That is the wiring's measurement and comes after. And production containment:
 * granted here, inherited there. Premise P1 is untouched by anything below.
 *
 * Usage: node scripts/research/containedStart.mjs
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { apply, inspect } from '../provision/containerGrants.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BUILT_SURFACE = join(REPO_ROOT, 'apps', 'desktop', 'dist', 'win32HostSurface.js');
const HOST_ENTRY = join(REPO_ROOT, 'packages', 'kernel', 'dist', 'host', 'hostEntry.js');

/**
 * One profile for both cells. Reusing it is what keeps the container identical
 * across them; a per-cell name would vary the SID as well as the grant.
 */
const CONTAINER = 'monstera-contained-start';

if (process.platform !== 'win32') {
  process.stderr.write('containedStart: Win32 only; this platform has no AppContainer.\n');
  process.exit(69);
}

const surfaceModule = await import(pathToFileURL(BUILT_SURFACE).href).catch(
  (/** @type {unknown} */ cause) => {
    process.stderr.write(
      `containedStart: could not import ${BUILT_SURFACE}. This reads the BUILD, so ` +
        `\`npm run typecheck\` must have run. ${String(cause)}\n`,
    );
    process.exit(70);
  },
);

/**
 * @typedef {{
 *   createSuspended: () => { ok: true, value: { pid: number, process: unknown, thread: unknown } }
 *     | { ok: false, error: string },
 *   resume: (thread: unknown) => number | null,
 *   terminate: (target: unknown) => void,
 *   close: (handle: unknown) => void,
 * }} Surface
 */

/** @type {(config: unknown) => Surface} */
const createWin32HostSurface = surfaceModule.createWin32HostSurface;

const scratch = mkdtempSync(join(tmpdir(), 'monstera-contained-start-'));

/**
 * The entry's own refusal, quoted from `hostEntry.ts` rather than paraphrased.
 *
 * Matching on a fragment of the message the program itself throws is what makes
 * `ran` mean *this program reached its own code*, and not *something wrote
 * something*.
 */
const REACHED_OWN_CODE = 'started with no pipe name';

/**
 * Which layer wrote the diagnostic, which is what separates two failures that
 * are both "the process started and our program did not".
 *
 * The markers are each layer's own: Chromium logs `[…:ERROR:file.cc:line]`, and
 * node's CJS loader says `Cannot find module` — which it also says for a file it
 * cannot READ, and that ambiguity is what the uncontained control resolves.
 *
 * @param {string} log
 * @returns {string}
 */
function stageOf(log) {
  if (log.includes(REACHED_OWN_CODE)) return 'entry';
  if (/Cannot find module|ERR_MODULE_NOT_FOUND/u.test(log)) return 'module-resolution';
  if (/:ERROR:[^\s]+\.cc:\d+/u.test(log)) return 'runtime-init';
  if (log.trim().length === 0) return 'nothing-written';
  return 'unclassified';
}

/**
 * @typedef {{
 *   cell: string, outcome: string, stage: string, detail: string, pid?: number
 * }} Cell
 */

/** @param {number} ms */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Runs one cell and classifies it. Nothing here grants or revokes: the caller
 * owns the variable, so a cell cannot silently arrange its own answer.
 *
 * @param {string} cell
 * @param {boolean} contained
 * @returns {Cell}
 */
function run(cell, contained) {
  const logPath = join(scratch, `${cell}.log`);
  const surface = createWin32HostSurface({
    executablePath: electronBinaryPath(),
    commandArguments: [HOST_ENTRY],
    // INSIDE THE GRANT SET ON PURPOSE. A working directory of our own would be
    // a second path whose rights differ between the cells, and then a refusal
    // could be attributed to either. The Electron root varies with the one
    // variable this file has, so it adds no axis.
    workingDirectory: dirname(electronBinaryPath()),
    containerName: contained ? CONTAINER : null,
    diagnosticPath: logPath,
  });

  const created = surface.createSuspended();
  if (!created.ok) {
    return { cell, outcome: 'create-failed', stage: 'create-process', detail: created.error };
  }
  const { pid, process: handle, thread } = created.value;
  surface.resume(thread);

  // The child writes through a handle THIS process opened, so waiting on the
  // file's content is waiting on the child rather than on a directory the
  // container would have to be able to reach.
  const deadline = Date.now() + 20_000;
  let log = '';
  // FIRST CONTENT IS NOT THE WHOLE DIAGNOSTIC. Node writes an uncaught throw as
  // a header, a source line and only then the message, so breaking on the first
  // non-empty read would classify the entry's own refusal as `no-program` on
  // whichever poll happened to land between the two writes. Content starts a
  // short settle window instead; the marker still breaks immediately.
  /** @type {number | null} */
  let settleBy = null;
  while (Date.now() < deadline) {
    try {
      log = readFileSync(logPath, 'utf8');
    } catch {
      // The parent created it with OPEN_ALWAYS before the child existed, so a
      // read failing here is a sharing race and not an absent file.
      log = '';
    }
    if (log.includes(REACHED_OWN_CODE)) break;
    if (log.trim().length > 0) {
      settleBy ??= Date.now() + 1_000;
      if (Date.now() >= settleBy) break;
    }
    sleep(100);
  }

  surface.terminate(handle);
  surface.close(thread);
  surface.close(handle);

  const detail = log.trim().split('\n').slice(0, 6).join('\n');
  const stage = stageOf(log);
  if (stage === 'entry') return { cell, outcome: 'ran', stage, detail, pid };
  if (stage === 'nothing-written') {
    return {
      cell,
      outcome: 'silent',
      stage,
      detail: 'the process was created and wrote nothing before the deadline',
      pid,
    };
  }
  return { cell, outcome: 'no-program', stage, detail, pid };
}

/** @param {string} label */
function reportGrantState(label) {
  process.stdout.write(`\nACLs, ${label}:\n`);
  for (const state of inspect()) {
    const said = state.present === null ? state.note : state.present ? 'granted' : 'NOT granted';
    process.stdout.write(`  ${said.padEnd(15)} ${state.path}\n`);
  }
}

/**
 * @param {boolean} revoke
 * @returns {void}
 */
function setGrants(revoke) {
  const { lines, failed } = apply({ revoke });
  process.stdout.write(lines.join('\n') + (lines.length > 0 ? '\n' : ''));
  if (failed.length > 0) {
    // A cell run against an ACL that did not reach its intended state measures
    // an unknown machine, so this refuses rather than reporting.
    throw new Error(
      `the ${revoke ? 'revoke' : 'grant'} did not take on ${String(failed.length)} path(s):\n  ` +
        failed.join('\n  '),
    );
  }
}

process.stdout.write(
  `electron:  ${electronBinaryPath()}\nprogram:   ${HOST_ENTRY}\ncontainer: ${CONTAINER}\n`,
);

/** @type {Cell | null} */
let uncontained = null;
/** @type {Cell | null} */
let revoked = null;
/** @type {Cell | null} */
let granted = null;
/** @type {string | null} */
let aborted = null;

try {
  // THE POSITIVE CONTROL, FIRST AND UNCONTAINED. `Cannot find module` is what
  // node says for a path it cannot READ as well as for one that is not there,
  // so a contained cell reporting it proves nothing on its own — a stale build
  // path produces the identical line. This cell removes containment and keeps
  // everything else, so it must reach the entry's own refusal. If it does not,
  // the program or the surface is what is broken and no verdict below is worth
  // reading.
  process.stdout.write('\n--- the uncontained control: this program MUST run ---\n');
  uncontained = run('uncontained', false);
  if (uncontained.outcome !== 'ran') {
    throw new Error(
      `the uncontained control did not reach the entry's own code (${uncontained.outcome}).\n` +
        `  ${uncontained.detail}\n` +
        `  Nothing about containment may be concluded from a program that does not run without it.`,
    );
  }

  process.stdout.write('\n--- revoking, so a success below cannot be inherited state ---\n');
  setGrants(true);
  reportGrantState('after the revoke');
  revoked = run('revoked', true);

  process.stdout.write('\n--- granting ---\n');
  setGrants(false);
  reportGrantState('after the grant');
  granted = run('granted', true);
} catch (cause) {
  aborted = cause instanceof Error ? cause.message : String(cause);
} finally {
  // THE MACHINE IS RESTORED ON EVERY PATH, including the one where a cell threw.
  // Leaving it revoked is the safe direction and it is not the honest one: the
  // next contained run would fail for a reason this file caused and nothing
  // would say so.
  process.stdout.write('\n--- restoring the machine to granted ---\n');
  try {
    setGrants(false);
  } catch (cause) {
    process.stdout.write(
      `\nCOULD NOT RESTORE THE GRANTS: ${cause instanceof Error ? cause.message : String(cause)}\n` +
        `Run \`npm run provision:grants\` by hand before anything else uses a contained host.\n`,
    );
  }
  reportGrantState('as this run leaves them');
}

for (const result of [uncontained, revoked, granted]) {
  if (result !== null) process.stdout.write(`\n${JSON.stringify(result, null, 2)}\n`);
}

if (aborted !== null) {
  process.stdout.write(`\nABORTED — ${aborted}\nNo verdict.\n`);
  process.exit(1);
}

// EVERY CELL OR NO VERDICT. A refusal with no matching success is not evidence
// of containment; it is evidence of a machine where nothing starts.
if (uncontained === null || revoked === null || granted === null) {
  process.stdout.write('\nA cell did not run. No verdict.\n');
  process.exit(1);
}

/**
 * Three verdicts, and the middle one is the reason this is not a boolean.
 *
 * `INSUFFICIENT` is a real reading rather than a softened failure: the two
 * contained cells failing at DIFFERENT points is what proves the grant did
 * something and that this instrument can tell the two ACL states apart. Both
 * cells failing at the SAME point is the shape a blind instrument produces, and
 * it is reported as UNREADABLE. Neither exits zero.
 */
const separated = revoked.outcome !== granted.outcome || revoked.stage !== granted.stage;
const verdict =
  revoked.outcome !== 'ran' && granted.outcome === 'ran'
    ? `OBTAINED — the contained host does not reach its own code without the grant ` +
      `(${revoked.outcome} at ${revoked.stage}) and does with it`
    : separated
      ? `INSUFFICIENT — the grant moves the failure (${revoked.stage} -> ${granted.stage}) ` +
        `and does not produce a start. The set is missing something the program needs.`
      : `UNREADABLE — both contained cells failed identically (${revoked.outcome} at ` +
        `${revoked.stage}), so the grant changed nothing this run can observe.`;

process.stdout.write(`\nADR-0027's grant, through the shipped surface: ${verdict}\n`);
process.exitCode = verdict.startsWith('OBTAINED') ? 0 : 1;

try {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
} catch (cause) {
  // A failure to tidy is a could-not-clean, never a measurement failure, so it
  // is reported after the verdict and never touches the exit code.
  process.stdout.write(`\ncould not remove ${scratch}: ${String(cause)}\n`);
}
