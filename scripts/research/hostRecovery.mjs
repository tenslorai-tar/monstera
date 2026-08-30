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

const missingBuilt = BUILT.filter((relative) => !existsSync(join(ROOT, relative)));
const runnable =
  process.platform === 'win32' && existsSync(ELECTRON_BINARY) && missingBuilt.length === 0;

if (!runnable) {
  const why =
    process.platform !== 'win32'
      ? `The engine host is a Win32 AppContainer process (ADR-0022), so there is nothing ` +
        `degraded to run on ${process.platform}.`
      : !existsSync(ELECTRON_BINARY)
        ? `The pinned Electron binary is absent. Run \`npm run provision:electron\`.`
        : `Not built: ${missingBuilt.join(', ')}. Run \`npm run build\`.`;

  if (REQUIRE_CONTAINMENT) {
    process.stderr.write(
      `hostRecovery: --require-containment was passed and this run cannot create a contained ` +
        `host.\n  ${why}\n\n  A job that passes this flag is asserting that it CAN look. ` +
        `Reporting unverifiable there would make every later run's silence worthless.\n`,
    );
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `UNVERIFIABLE — ${String(CASES.length)} case(s) could not be evaluated here:\n` +
        `${CASES.map((label) => `  ??  ${label}\n`).join('')}\n` +
        `  ${why}\n\n` +
        `  This is COULD NOT LOOK, and it is not the same as looked and found nothing. The ` +
        `Windows containment jobs pass --require-containment, which turns this into a failure.\n`,
    );
  }
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

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} host-recovery case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('host-recovery case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}
