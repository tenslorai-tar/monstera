// @ts-check
/**
 * The child of `hostRecovery.mjs`: a real shell, a real contained host, killed.
 *
 * ## Why this is a separate process
 *
 * `createEngineHostPlatform` mints the host's executable path through
 * `electronBinaryOfThisProcess()`, which refuses any process that is not the
 * Electron binary — B5 rather than a comment, so that a host cannot be created
 * pointing at the wrong runtime. This file therefore runs under
 * `electron.exe` with `ELECTRON_RUN_AS_NODE=1`, which is Node mode: no window,
 * no GPU process, and `process.versions.electron` set.
 *
 * **Node mode is why it lives here and not under `apps/desktop/src/`**
 * ([ADR-0024](../../docs/DECISIONS/0024-execution-mode-is-a-placement-axis.md)).
 * It reaches the shell's own modules the way `scripts/perf/roleMupdfHost.mjs`
 * does, by importing the built artefacts by path.
 *
 * ## What it is for
 *
 * `docs/FEATURES.md` has owed, for as long as retention has existed, *that a
 * killed host actually recovers, asserted against a running process*. Every
 * case that exercises `onEngineHostEnded` injects `rebuild` and `reopen`, so
 * what is proven is the ordering — that the entries are queued in the lane,
 * that a closed document is skipped, that a deliberate shutdown does not
 * rebuild. None of them establishes that a real host, killed, is replaced by a
 * real host that a real command then reaches.
 *
 * ## The two kills, and why the second one is what makes the first mean
 * something
 *
 * One death recovers; two poison the document (ADR-0023 Decision 9a). A shell
 * that poisoned on the first death would pass a *recovery* case written only as
 * "the command eventually failed", and a shell that never poisoned would pass
 * one written only as "the command eventually succeeded". Asserting both ends
 * is what separates the implemented rule from either constant.
 *
 * ## Recovery is observed as a NEW CHILD, not as a retry succeeding
 *
 * After the kill this waits for a **different** process to appear as this
 * process's child, and only then sends one command. Retrying the command until
 * it worked would prove something weaker — that a retry eventually lands — and
 * would race the document's lane, since the reopen is queued by the failure
 * sink rather than by the caller. A new host appearing with nothing asked of it
 * is the recovery itself.
 *
 * ## Identifying the host
 *
 * By enumerating this process's children and requiring **exactly one**. In Node
 * mode this process spawns nothing else, so zero means no host was ever created
 * and two means this cannot tell which one to kill — both are refusals rather
 * than a guess. That requirement is the positive control: a kill aimed at
 * nothing would otherwise read exactly like a kill the shell recovered from.
 *
 * Usage: not directly. `node scripts/research/hostRecovery.mjs`.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';

const ROOT = repoRoot();

/**
 * Where the report goes, given by the driver.
 *
 * A FILE AND NOT STDOUT, and the reason is a measurement rather than a taste.
 * The engine host is created with inherited handles, so it holds this process's
 * stdout — and `spawnSync` waits for the pipe to close as well as for the child
 * to exit. Written to stdout, the report arrived and the driver then sat until
 * its 180-second timeout waiting for a grandchild it does not know about, which
 * reads as a hang in the harness rather than as a live host.
 */
const REPORT_PATH = process.argv[2] ?? '';

/**
 * How long a new host has to appear after its predecessor was killed.
 *
 * **Derived rather than picked.** `engineHostConnection.ts` gives a host ten
 * seconds to connect, a bound it justifies from ten measured starts of 698ms to
 * 1370ms on this machine. Recovery is that same start plus the death being
 * noticed, so this is that bound with one second of slack and nothing else in
 * it. A larger number here would not measure recovery; it would measure how
 * long this harness is willing to wait for something that is not coming.
 */
const REBUILD_BUDGET_MS = 11_000;

/** How long the killed host has to disappear from the child list. */
const DEATH_BUDGET_MS = 5_000;

/**
 * How often the child list is re-read while waiting.
 *
 * Each read spawns `powershell.exe`, which costs more than the loop does, so a
 * tighter interval would measure this harness's own process creation rather
 * than the shell's recovery.
 */
const POLL_MS = 250;

/**
 * This process's child process ids.
 *
 * Through `Get-CimInstance` rather than a native call: this is a diagnostic in
 * a harness, not a mechanism the product depends on, and a koffi binding here
 * would be a third opinion about process enumeration for no gain.
 *
 * @returns {number[]}
 */
function childProcessIds() {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      // `ProcessId<>$PID` EXCLUDES THE ENUMERATOR ITSELF. Asking Windows for
      // this process's children from inside a child of this process returns
      // that child too, so every reading came back with one more than the truth
      // — measured as `found 2 (13856, 14640)` with exactly one host running.
      // Excluded by identity rather than by image name, because a filter on
      // `powershell.exe` would also hide a host that happened to be one.
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${String(process.pid)}" | ` +
        `Where-Object { $_.ProcessId -ne $PID } | Select-Object -ExpandProperty ProcessId`,
    ],
    { encoding: 'utf8', timeout: 20_000 },
  );
  if (result.error !== undefined) {
    throw new Error('could not enumerate this process’s children', { cause: result.error });
  }
  return `${result.stdout}`
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Waits until this process's children satisfy `settled`, or the budget expires.
 *
 * @param {(ids: number[]) => boolean} settled
 * @param {number} budgetMs
 * @returns {Promise<{ ids: number[], waitedMs: number, settled: boolean }>}
 */
async function waitForChildren(settled, budgetMs) {
  const startedAt = Date.now();
  for (;;) {
    const ids = childProcessIds();
    const waitedMs = Date.now() - startedAt;
    if (settled(ids)) return { ids, waitedMs, settled: true };
    if (waitedMs >= budgetMs) return { ids, waitedMs, settled: false };
    await sleep(POLL_MS);
  }
}

/** @param {string} relative @returns {Promise<any>} */
function built(relative) {
  return import(pathToFileURL(join(ROOT, relative)).href);
}

/**
 * @param {any} handlers
 * @param {string} docId
 * @returns {Promise<{ ok: boolean, code: string | null }>}
 */
async function rotate(handlers, docId) {
  // A THROW IS AN OBSERVATION, not a reason to abandon the run. Every failure
  // this harness is about arrives as a refusal the renderer could render, so a
  // rejection escaping the boundary is itself something to report — and a
  // harness that died here would produce no report at all, which reads to the
  // driver as a hang rather than as a result.
  try {
    const answer = await handlers['document.execute']({
      docId,
      command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
    });
    return { ok: answer.ok === true, code: answer.ok === true ? null : `${answer.error.code}` };
  } catch (error) {
    return { ok: false, code: `threw:${String(error?.constructor?.name ?? 'Error')}` };
  }
}

async function main() {
  if (REPORT_PATH === '') {
    throw new Error(
      'hostRecoveryHost.mjs takes the path to write its report to as its one argument. Without ' +
        'one it would run the whole experiment and have nowhere to say what happened.',
    );
  }
  if (!('electron' in process.versions)) {
    throw new Error(
      'hostRecoveryHost.mjs must run under the Electron binary in Node mode. ' +
        '`createEngineHostPlatform` refuses any other process, so a run from plain node would ' +
        'fail inside the shell rather than here, where the reason is legible.',
    );
  }

  const composition = await built('apps/desktop/dist/composition.js');
  const platformModule = await built('apps/desktop/dist/engineHostPlatform.js');
  const settingsModule = await built('apps/desktop/dist/settingsFile.js');
  const { buildLargeFixture } = await built('scripts/perf/largeFixture.mjs');

  const scratch = mkdtempSync(join(tmpdir(), 'monstera-host-recovery-'));
  try {
    // The document the host opens. A real PDF, because the ENGINE parses it —
    // main never does, so any bytes satisfy the shell and none satisfy MuPDF.
    const source = buildLargeFixture({
      root: ROOT,
      targetBytes: 64 * 1024,
      pages: 1,
      name: 'perf-baseline.pdf',
    }).path;
    const document = join(scratch, 'recovered.pdf');
    copyFileSync(source, document);

    const sessionRoot = join(scratch, 'engine-sessions');
    mkdirSync(sessionRoot, { recursive: true });
    const platform = platformModule.createEngineHostPlatform(sessionRoot);
    if (platform === null) {
      throw new Error(
        'createEngineHostPlatform returned null, so no contained host can exist here. The ' +
          'driver is supposed to have refused this run before spawning us.',
      );
    }

    const { handlers } = composition.createShellDependencies(
      { version: '0.0.0', installChannel: 'development' },
      () => Promise.resolve(document),
      settingsModule.createEphemeralSettings(),
      platform,
    );

    const opened = await handlers['document.open']({});
    if (opened.ok !== true || opened.value.kind !== 'opened') {
      throw new Error(`the document did not open: ${JSON.stringify(opened)}`);
    }
    const docId = `${opened.value.docId}`;

    // FIRST COMMAND, and it is what establishes that a host is running at all.
    // Everything below is about what happens to a WORKING host when it dies,
    // and a harness that killed a process the shell had already given up on
    // would report recovery from nothing.
    const first = await rotate(handlers, docId);

    const before = childProcessIds();
    if (before.length !== 1) {
      throw new Error(
        `expected exactly one child process — the engine host — and found ${String(before.length)} ` +
          `(${before.join(', ') || 'none'}). Zero means no host was created, so a kill would ` +
          `hit nothing and the recovery below would be recovery from an event that never ` +
          `happened. Two means this cannot tell which process is the host.`,
      );
    }
    const firstPid = before[0] ?? 0;

    // THE KILL. `process.kill` is TerminateProcess on Windows, which is a death
    // the shell did not ask for — `close()` would take the deliberate-shutdown
    // path, and Decision 8 distinguishes the two precisely so that one rebuilds
    // and the other does not.
    process.kill(firstPid);
    const died = await waitForChildren((ids) => !ids.includes(firstPid), DEATH_BUDGET_MS);

    // Recovery observed as a NEW child, with nothing asked of the shell.
    const rebuilt = await waitForChildren(
      (ids) => ids.some((id) => id !== firstPid),
      REBUILD_BUDGET_MS,
    );
    const secondPid = rebuilt.ids.find((id) => id !== firstPid) ?? 0;

    const afterFirstDeath = await rotate(handlers, docId);

    // THE SECOND DEATH, which is the other end of Decision 9a. Skipped only if
    // there is nothing to kill, and that case is reported rather than passed
    // over — a shell that never rebuilt would arrive here with no child and
    // must not look like one that recovered and was killed again.
    /** @type {{ ok: boolean, code: string | null } | null} */
    let afterSecondDeath = null;
    let secondKillHit = false;
    if (secondPid > 0) {
      secondKillHit = true;
      process.kill(secondPid);
      await waitForChildren((ids) => !ids.includes(secondPid), DEATH_BUDGET_MS);
      // A poisoned document is not rebuilt for, so there is no new child to
      // wait for here. The wait is for the shell to have NOTICED, which is the
      // same event the first death's wait observed.
      await sleep(POLL_MS * 5);
      afterSecondDeath = await rotate(handlers, docId);
    }

    const report = JSON.stringify({
      childrenBeforeKill: before.length,
      firstPid,
      firstCommand: first,
      died: died.settled,
      diedAfterMs: died.waitedMs,
      rebuilt: rebuilt.settled,
      rebuiltAfterMs: rebuilt.waitedMs,
      secondPid,
      afterFirstDeath,
      secondKillHit,
      afterSecondDeath,
    });

    // THE REPORT FIRST, because everything after it is cleanup and cleanup can
    // fail. It used to come second and the run before it was `rmSync` — which
    // threw EPERM the day the shell started giving each host a diagnostic file
    // in the session root, because a LIVE host holds that file through an
    // inherited handle. The experiment had finished and produced nothing.
    writeFileSync(REPORT_PATH, `${report}\n`, 'utf8');

    // KILL WHAT WE OPENED. Any host still running is a process this harness
    // created, holding the stdio handles it inherited from us — and a driver
    // spawning this one waits on those, so a surviving grandchild turns a
    // finished experiment into a timeout in the caller. Killing them here is
    // cleanup rather than part of the measurement: the report is already
    // written, and every case the driver asserts is decided by then.
    for (const id of childProcessIds()) {
      try {
        process.kill(id);
      } catch {
        // Already gone, which is the ordinary case for the host we killed.
      }
    }

    // WAIT FOR THEM TO BE GONE, rather than for a retry to outlast them.
    // `process.kill` asks; the handles are released when the process actually
    // exits, and `rmSync`'s retries ride out a handle being closed, not a
    // process that is still running. Measured: without this the removal below
    // throws EPERM on the session root, because a live host holds its
    // diagnostic file there through an inherited handle.
    await waitForChildren((ids) => ids.length === 0, DEATH_BUDGET_MS);

    // AND THE DIRECTORY LAST. Its failure is reported and not thrown: the
    // report is already on disk and every case the driver asserts is decided,
    // so a leaked temp directory must not turn a finished experiment into no
    // result at all. It is named, because a leak nobody mentions is one nobody
    // fixes.
    try {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (error) {
      process.stderr.write(
        `MONSTERA_HOST_RECOVERY_LEAKED ${scratch} could not be removed: ${formatError(error)}\n`,
      );
    }

    // EXIT EXPLICITLY. The shell holds a reader worker, a stop event and a pipe
    // instance whose lifetimes are the application's, so this process does not
    // end on its own — and a harness that never exits reads to the driver as a
    // hang rather than as a result.
    process.exit(0);
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    throw error;
  }
}

main().catch((error) => {
  // THROUGH THE OWNER. `Error.prototype.stack` does not include `cause`, and the
  // cause's errno is usually the diagnosis here — a refused spawn, a pipe that
  // was not there. `check:stackowner` refuses any other reader.
  process.stderr.write(`MONSTERA_HOST_RECOVERY_FAILED ${formatError(error)}\n`);
  process.exitCode = 1;
});
