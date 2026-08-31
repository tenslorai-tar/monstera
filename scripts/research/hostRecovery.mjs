// @ts-check
/**
 * Does a killed engine host actually recover, against a running process?
 *
 * ## The clause this closes
 *
 * `DocumentService` holds the canonical bytes so that a dead host can be
 * replaced without losing the user's edits, and `onEngineHostEnded` queues a
 * reopen in each surviving document's lane. Both have cases; **every one of
 * them injects the rebuild.** What they establish is the ordering — the entries
 * are queued before the first await, a closed document is skipped, a deliberate
 * shutdown does not rebuild. None of them establishes that a real host, killed,
 * is replaced by a real host that a real command then reaches. Retention makes
 * recovery possible; it is not evidence that it works.
 *
 * ## The branch this has on two sides, and why that is the whole risk
 *
 * This cell needs a contained host, so it runs on Windows with the pinned
 * Electron binary and the built shell, and reports **UNVERIFIABLE** everywhere
 * else. That is ZZ-1's shape exactly: a check keyed on provisioning has a
 * developed-in side that is richer than the runner's, and the richer side is
 * the one that hides the defect.
 *
 * So the two sides are separated rather than trusted:
 *
 * - without the runtime, this prints `UNVERIFIABLE` and names the cases it
 *   could not evaluate. *Could not look* is not *looked and found nothing.*
 * - `--require-containment` turns that into a hard failure, and it is what the
 *   Windows containment jobs pass. A job that could silently stop running this
 *   would report the reassuring answer for ever.
 *
 * The pin is **mandatory under `--require-containment`** rather than defaulted,
 * for the reason `lowboxSpike.mjs`'s spawn pin is: a job cannot opt out of an
 * assertion by omission.
 *
 * ## What it does not cover
 *
 * The host is killed from outside. A host that dies of its own accord — a job
 * object memory breach, a crash inside MuPDF — reaches the same transport
 * ending, and this does not distinguish them; `hostTransport.ts`'s cases do.
 * What this adds is that the ending is produced by a process that really
 * stopped existing, rather than by a fake reporting one.
 *
 * Usage: node scripts/research/hostRecovery.mjs [--require-containment]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { inspect } from '../provision/containerGrants.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const ROOT = repoRoot();
const CHILD = join(ROOT, 'scripts', 'research', 'hostRecoveryHost.mjs');
const ELECTRON_BINARY = electronBinaryPath(ROOT);

/** Built artefacts the child imports by path. Absent means "not built here". */
const BUILT = [
  'apps/desktop/dist/composition.js',
  'apps/desktop/dist/engineHostPlatform.js',
  'apps/desktop/dist/settingsFile.js',
  'packages/kernel/dist/host/hostEntry.js',
];

const REQUIRE_CONTAINMENT = process.argv.includes('--require-containment');

/**
 * The cases, named — so that the unverifiable branch can say which ones it did
 * not evaluate, and so the count below is an independent claim rather than a
 * derivation from the `check()` calls it governs.
 *
 * A list authored here goes red when a case stops running; a count computed
 * from the checks themselves would agree with any deletion (audit item 4c).
 */
const CASES = [
  'exactly one child process existed, so the kill had a target',
  'the first command reached the host',
  'the killed host stopped existing',
  'a NEW host appeared with nothing asked of the shell',
  'and a command after the first death SUCCEEDS',
  'CONTROL: the second death POISONS rather than rebuilding for ever',
  'CONTROL: and the harness process itself exited CLEANLY',
];

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: CASES.length });

/** @param {string} name @param {boolean} condition @param {string} detail */
function check(name, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, name);
}

/**
 * The container grants this needs, checked rather than discovered.
 *
 * **THE FAILURE THIS CONVERTS NAMES THE WRONG SUBSYSTEM.** A contained host
 * whose token cannot read the Electron runtime is created, dies loading its own
 * ICU data, and never connects — so every caller reports *"the host started and
 * did not reach its pipe"*, which sends the reader to the pipe. Measured twice:
 * once on a machine whose grants an `npm ci` had cleared, and once inside a
 * `npm run local` sweep that left exactly `.tools/electron/<version>` revoked
 * while the other nine paths stood.
 *
 * The host's own diagnostic is where the real answer is, and
 * `createEngineHostPlatform` passes `diagnosticPath: null` — so in the shipped
 * app there is no evidence at all. That is raised as owed on the row for the
 * composition root creating the host, rather than fixed here: a shipped
 * diagnostic is a file in a directory the host was handed.
 *
 * A missing grant is a machine state, not a defect in anything this asserts, so
 * it is refused by name with the command that repairs it.
 *
 * @returns {string[]} the paths the container cannot read
 */
function ungrantedPaths() {
  if (process.platform !== 'win32') return [];
  return inspect({ root: ROOT })
    .filter((entry) => entry.present === false)
    .map((entry) => entry.path);
}

const missingBuilt = BUILT.filter((relative) => !existsSync(join(ROOT, relative)));
const ungranted = process.platform === 'win32' ? ungrantedPaths() : [];
const runnable =
  process.platform === 'win32' &&
  existsSync(ELECTRON_BINARY) &&
  missingBuilt.length === 0 &&
  ungranted.length === 0;

if (!runnable) {
  const why =
    process.platform !== 'win32'
      ? `The engine host is a Win32 AppContainer process (ADR-0022), so there is nothing ` +
        `degraded to run on ${process.platform}.`
      : !existsSync(ELECTRON_BINARY)
        ? `The pinned Electron binary is absent. Run \`npm run provision:electron\`.`
        : missingBuilt.length > 0
          ? `Not built: ${missingBuilt.join(', ')}. Run \`npm run build\`.`
          : `The container cannot read ${String(ungranted.length)} of its granted path(s), so a ` +
            `contained host would be created and die loading its own runtime data — reported ` +
            `by everything downstream as a host that did not reach its pipe.\n  ` +
            `${ungranted.join('\n  ')}\n  Run \`npm run provision:grants\`.`;

  // THROUGH THE OWNER, and this file is why the rule needed a caller rather
  // than a paragraph.
  //
  // It printed its own `UNVERIFIABLE — N case(s)…`, which reads correctly to a
  // person and is invisible to `npm run local`: the harness keys on the token
  // `unverifiable.mjs` exports — a newline, two spaces, the word, two spaces —
  // and a second spelling of it is a second opinion about what that module says
  // (B3a). MEASURED 2026-08-31: in one sweep this exited 0 in **1.74s** against
  // 20.1s for a real run, because the container grant on the Electron tree had
  // gone, and the run was recorded as **passed** — `bytes: null`, the pass
  // branch. The proof of the range's headline claim was counted as green while
  // it measured nothing.
  exitUnverifiable({
    required: REQUIRE_CONTAINMENT,
    subject: 'engine host recovery',
    why:
      `${String(CASES.length)} case(s) could not be evaluated:\n` +
      `${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ${why}`,
    flag: '--require-containment',
  });
} else {
  // THE REPORT COMES BACK IN A FILE AND THE CHILD'S STDIO IS INHERITED.
  // Piping it back was the obvious shape and it hangs: the engine host is
  // created with inherited handles, so it holds the child's stdout, and
  // `spawnSync` waits for that pipe to close as well as for the child to exit.
  // Measured — the report arrived and the driver then sat for its full 180
  // seconds waiting on a grandchild it does not know exists.
  const scratch = mkdtempSync(join(tmpdir(), 'monstera-host-recovery-driver-'));
  const reportPath = join(scratch, 'report.json');
  /** @type {any} */
  let seen;
  /**
   * How the harness process itself ended.
   *
   * Declared here rather than beside the spawn because the case that reads it
   * runs after the `finally` that removes the scratch. Undefined until the
   * spawn assigns it: a default of `{ status: 0 }` would be the passing value,
   * so a path that never reached the assignment would report the answer this
   * case exists to doubt.
   *
   * @type {{ status: number | null, signal: string | null } | undefined}
   */
  let exited;
  try {
    const result = spawnSync(ELECTRON_BINARY, [CHILD, reportPath], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 180_000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    if (result.error !== undefined) {
      throw new Error(`could not run ${CHILD} under ${ELECTRON_BINARY}`, { cause: result.error });
    }
    exited = { status: result.status, signal: result.signal };
    if (!existsSync(reportPath)) {
      throw new Error(
        `the harness wrote no report (exit ${String(result.status)}). Its own diagnostics are ` +
          `above, on this process's stderr: a line beginning MONSTERA_HOST_RECOVERY_FAILED is ` +
          `the harness refusing, and none at all means it was killed or never started.`,
      );
    }
    seen = JSON.parse(readFileSync(reportPath, 'utf8'));
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  check(
    'exactly one child process existed, so the kill had a target',
    seen.childrenBeforeKill === 1 && seen.firstPid > 0,
    `saw ${String(seen.childrenBeforeKill)} child process(es). Zero would make every case below ` +
      `a recovery from an event that never happened, which is the reassuring answer this cell ` +
      `is most at risk of producing.`,
  );

  check(
    'the first command reached the host',
    seen.firstCommand?.ok === true,
    `the first rotate answered ${JSON.stringify(seen.firstCommand)}. A host that was already ` +
      `unreachable makes the kill meaningless.`,
  );

  check(
    'the killed host stopped existing',
    seen.died === true,
    `the process was still a child of the harness ${String(seen.diedAfterMs)}ms after ` +
      `TerminateProcess. Nothing below is about recovery if the host is still running.`,
  );

  check(
    'a NEW host appeared with nothing asked of the shell',
    seen.rebuilt === true && seen.secondPid > 0 && seen.secondPid !== seen.firstPid,
    `first pid ${String(seen.firstPid)}, second ${String(seen.secondPid)}, after ` +
      `${String(seen.rebuiltAfterMs)}ms. The harness sends no command between the kill and this ` +
      `observation, so a new process here is the recovery itself rather than a retry landing.`,
  );

  check(
    'and a command after the first death SUCCEEDS',
    seen.afterFirstDeath?.ok === true,
    `the rotate after the first death answered ${JSON.stringify(seen.afterFirstDeath)}. The ` +
      `document's bytes are main's, so the new session is opened from them and the command ` +
      `reaches it — that is what retention is for.`,
  );

  check(
    'CONTROL: the second death POISONS rather than rebuilding for ever',
    seen.secondKillHit === true && seen.afterSecondDeath?.code === 'document-poisoned',
    `the rotate after the second death answered ${JSON.stringify(seen.afterSecondDeath)} ` +
      `(second kill ${seen.secondKillHit === true ? 'hit' : 'HAD NO TARGET'}). ADR-0023 ` +
      `Decision 9a stops at one rebuild per document, and without this a shell that never ` +
      `poisoned would pass every case above — as would one that poisoned immediately, against ` +
      `the case above this.`,
  );

  // THE SUBJECT'S OWN EXIT, and it is the assertion this file did not have.
  //
  // Every case above is decided from a report FILE the harness writes before it
  // finishes, so a subject that dies afterwards produces a complete report and
  // six green cases. Measured 2026-08-31: it exited **134** — SIGABRT, from
  // `FATAL ERROR: Error::ThrowAsJavaScriptException napi_throw` at the reader
  // worker's `GetOverlappedResult` — while reporting everything as fine. The
  // driver's only statement about the process was that the file existed.
  //
  // That is the checklist's *"an artefact whose failure is announced on a
  // channel nobody subscribes to is unproven, however many checks read it"*,
  // one layer out: there the channel was Electron's `preload-error`, here it is
  // an exit code.
  check(
    CASES[6] ?? '',
    exited !== undefined && exited.status === 0 && exited.signal === null,
    `the harness exited ${String(exited?.status)}${
      exited?.signal == null ? '' : ` on ${exited.signal}`
    } after writing a complete report. 134 is SIGABRT and was what a reader ` +
      `thread waking inside a closing environment produced; the fix was to wait for the hosts ` +
      `to be GONE before exiting rather than to kill them and go. Read the harness's stderr ` +
      `above — a FATAL ERROR line names the call that aborted.`,
  );

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} host-recovery case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('host-recovery case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
