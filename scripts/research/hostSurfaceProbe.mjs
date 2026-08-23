// @ts-check
/**
 * Does the SHIPPED Win32 surface create a real process, contain it, and resume
 * it — measured against the kernel rather than against a fake?
 *
 * `apps/desktop/src/engineHostFactory.test.ts` proves Decision 8's ORDERING
 * exhaustively against an injected surface, and proves nothing about whether the
 * calls behind that surface work. This closes the other half. Every member here
 * is the one shipped code will call, imported from the build.
 *
 * ## The pair is the point
 *
 * Two cells, differing in ONE variable: the job. Both take the same creation
 * route, the same executable, the same child.
 *
 *   job    — create suspended, create job, apply limits, assign, read
 *            membership, resume. The child must run and must be REFUSED a spawn.
 *   no-job — the same, with no job of ours. The child must run and must be
 *            ALLOWED a spawn.
 *
 * A refusal on its own is worthless: it cannot be told apart from a child that
 * never started, or from a machine where spawning fails anyway. The no-job cell
 * is what makes the refusal evidence. This is WW-1's per-property variant matrix
 * with the route held fixed, run against shipped code instead of the spike.
 *
 * ## What this does NOT measure, said plainly
 *
 * The container. `containerName` is `null` in both cells, so neither is
 * contained and nothing here says anything about invariant 25 (a), (c) or (d).
 * A contained cell needs the five development ACL grants the spike makes by
 * hand — a checkout under a user profile grants application packages nothing —
 * and that belongs with RR-3, which moves the whole four-property matrix onto a
 * proof. What is measured here is (b), plus the fact that the ordering runs at
 * all outside a unit test.
 *
 * Usage: node scripts/research/hostSurfaceProbe.mjs
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const BUILT_SURFACE = join(REPO_ROOT, 'apps', 'desktop', 'dist', 'win32HostSurface.js');
const CHILD = join(HERE, 'hostSurfaceProbeChild.mjs');

if (process.platform !== 'win32') {
  // Not a skip that reads like a pass. This instrument has one platform and
  // says so with a non-zero exit, because "did not run" and "ran and found
  // nothing wrong" must not share an output.
  process.stderr.write('hostSurfaceProbe: Win32 only; this platform has no AppContainer.\n');
  process.exit(69);
}

const surfaceModule = await import(pathToFileURL(BUILT_SURFACE).href).catch(
  (/** @type {unknown} */ cause) => {
    process.stderr.write(
      `hostSurfaceProbe: could not import ${BUILT_SURFACE}. ` +
        `This probe reads the BUILD rather than the source, so \`npm run typecheck\` ` +
        `must have run. ${String(cause)}\n`,
    );
    process.exit(70);
  },
);

/**
 * The surface's shape, declared here rather than imported from the build.
 *
 * A JSDoc import of `apps/desktop/dist/win32HostSurface.js` would make
 * `npm run typecheck` depend on that build already existing, which is a
 * different thing from this probe depending on it at run time — the probe says
 * so and exits 70, while a typecheck would simply fail on a clean checkout.
 *
 * This is a structural description of a boundary a research probe crosses, not
 * a second definition of the interface: the members are checked by calling
 * them, and the run above is what says whether the description was right.
 *
 * @typedef {'in-job' | 'not-in-job' | 'could-not-read'} JobMembership
 * @typedef {{
 *   createSuspended: () => { ok: true, value: { pid: number, process: unknown, thread: unknown } }
 *     | { ok: false, error: string },
 *   createJob: () => unknown,
 *   applyLimits: (job: unknown, bytes: number) => boolean,
 *   assignToJob: (job: unknown, target: unknown) => boolean,
 *   readJobMembership: (target: unknown, job: unknown) => JobMembership,
 *   resume: (thread: unknown) => number | null,
 *   terminate: (target: unknown) => void,
 *   close: (handle: unknown) => void,
 * }} Surface
 */

/** @type {(config: unknown) => Surface} */
const createWin32HostSurface = surfaceModule.createWin32HostSurface;

const scratch = mkdtempSync(join(tmpdir(), 'monstera-host-surface-'));

/**
 * §9.17's absolute cap for `mupdf-host` is what the shipped factory passes. A
 * smaller number here would be this file having an opinion about the budget,
 * which is the shape ADR-0023 §2 forbids — so the value is read from the one
 * module that reads the invariant.
 */
const { assertableBudget, memoryBudgets } = await import(
  pathToFileURL(join(REPO_ROOT, 'scripts', 'lib', 'memoryBudgets.mjs')).href
);
const PROCESS_MEMORY_LIMIT = assertableBudget(memoryBudgets(), 'mupdf-host').absoluteBytes;

/**
 * One cell. Everything is identical across the two except `withJob`.
 *
 * @param {string} cell
 * @param {boolean} withJob
 */
function run(cell, withJob) {
  const reportPath = join(scratch, `${cell}.json`);
  const logPath = join(scratch, `${cell}.log`);
  const surface = createWin32HostSurface({
    executablePath: process.execPath,
    commandArguments: [CHILD, reportPath],
    workingDirectory: scratch,
    containerName: null,
    diagnosticPath: logPath,
  });

  /**
   * @type {{
   *   cell: string, withJob: boolean, pid?: number, outcome?: string, detail?: string,
   *   jobCreated?: boolean, limitsApplied?: boolean, assigned?: boolean,
   *   membership?: string, previousSuspendCount?: number | null,
   *   child?: unknown, diagnostics?: string,
   * }}
   */
  const observed = { cell, withJob };

  const created = surface.createSuspended();
  if (!created.ok) {
    observed.outcome = 'create-failed';
    observed.detail = created.error;
    return observed;
  }
  const { pid, process: handle, thread } = created.value;
  observed.pid = pid;

  let job = null;
  if (withJob) {
    job = surface.createJob();
    observed.jobCreated = job !== null;
    if (job !== null) {
      observed.limitsApplied = surface.applyLimits(job, PROCESS_MEMORY_LIMIT);
      observed.assigned = surface.assignToJob(job, handle);
      observed.membership = surface.readJobMembership(handle, job);
    }
  } else {
    observed.membership = 'NO JOB (variant)';
  }

  observed.previousSuspendCount = surface.resume(thread);

  // Waiting on the report file rather than on the process: the child writes it
  // last, so its presence means the child reached the end. A process handle
  // going signalled would also be satisfied by a child that died on line one.
  const deadline = Date.now() + 20_000;
  /** @type {unknown} */
  let childReport = null;
  while (Date.now() < deadline) {
    try {
      childReport = JSON.parse(readFileSync(reportPath, 'utf8'));
      break;
    } catch {
      // Not yet written. The only way out of this loop is the file appearing or
      // the deadline passing, and the deadline is reported as its own outcome.
    }
  }
  observed.child = childReport ?? 'NO REPORT — the child never reached its last line';

  try {
    observed.diagnostics = readFileSync(logPath, 'utf8').trim();
  } catch {
    observed.diagnostics = '';
  }

  surface.terminate(handle);
  surface.close(thread);
  surface.close(handle);
  if (job !== null) surface.close(job);
  return observed;
}

mkdirSync(scratch, { recursive: true });
{
  const results = [run('job', true), run('no-job', false)];
  for (const result of results) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }

  // THE DIFFERENTIAL, printed as a verdict rather than left for a reader to
  // compute. Both halves are required: a refusal with no matching success is
  // indistinguishable from a machine that cannot spawn at all.
  // Both cells or no verdict. An absent cell would otherwise reach the
  // comparison as `undefined` and print UNREADABLE, which is the right word for
  // the wrong reason — "the cell did not run" is not "the cells disagreed".
  const withJob = results[0];
  const withoutJob = results[1];
  if (withJob === undefined || withoutJob === undefined) {
    process.stdout.write(`\nOnly ${String(results.length)} cell(s) ran. No verdict.\n`);
    process.exit(1);
  }
  const refused = /** @type {{ spawn?: string }} */ (withJob.child)?.spawn;
  const allowed = /** @type {{ spawn?: string }} */ (withoutJob.child)?.spawn;
  const verdict =
    refused === 'refused' && allowed === 'allowed'
      ? 'OBTAINED — no process creation, and the same host WITHOUT the job spawns freely'
      : `UNREADABLE — job cell spawn=${String(refused)}, no-job cell spawn=${String(allowed)}`;
  process.stdout.write(`\ninvariant 25(b) through the shipped surface: ${verdict}\n`);
  process.exitCode = verdict.startsWith('OBTAINED') ? 0 : 1;
}

/**
 * CLEANUP CANNOT CHANGE THE VERDICT, and this shape is here because the first
 * version let it.
 *
 * The teardown was a `finally` around the measurement, and a resolution run
 * with `ActiveProcessLimit` removed left a grandchild holding the scratch
 * directory. `rmSync` threw `EPERM`, the stack trace buried the verdict line,
 * and the exit code stopped meaning what the verdict said. It happened to agree
 * that time — both wanted 1 — which is exactly how this survives review.
 *
 * A failure to tidy up is a *could-not-clean*, not a *measurement failed*. It is
 * reported on its own line, after the verdict, and it never touches
 * `process.exitCode`.
 *
 * THE RETRIES ARE NOT A BUMPED TIMEOUT, and the mechanism is why. The child
 * holds the diagnostic log as its stdout and stderr, and `TerminateProcess` is
 * asynchronous — it queues the termination and returns, so the kernel releases
 * that file handle some time after our call. There is no state to poll from
 * here: waiting on the process needs `WaitForSingleObject`, which is not part of
 * host creation and does not belong in the surface. So the wait is bounded, the
 * remaining failure is reported honestly, and the directory is under TEMP where
 * a leftover costs nothing. Observed to fire on roughly one run in three.
 */
try {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
} catch (cause) {
  process.stdout.write(
    `\ncould not remove ${scratch}: ${String(cause)}\n` +
      `The verdict above stands; something the probe started is still holding it.\n`,
  );
}
