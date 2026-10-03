// @ts-check
/**
 * The child of `hostDeadline.mjs`: a real shell, a real contained host, FROZEN in the middle of a call.
 *
 * A host whose thread is suspended answers nothing, which is what a host looping inside a document looks like from
 * `main` — the call was sent and no answer comes. `NtSuspendProcess` makes that happen on demand, without a test
 * channel in the shipped host and without a document crafted to loop. It is a harness's fault injection from outside,
 * as `hostRecoveryHost.mjs`' `process.kill` is.
 *
 * Two cells, chosen by the first argument, differing in ONE value — the shell's `hostCallDeadline`:
 *
 * - `deadline`: a 4 s floor. The frozen call must end within the deadline, a new host appear, and the document answer
 *   a command again with what it held.
 * - `control`: a 10-minute floor, the same freeze. The call must still be waiting when the deadline cell's would long
 *   have ended — which is the wedge the deadline exists to end, reproduced.
 *
 * Usage (under the Electron binary in Node mode, from the driver): hostDeadlineHost.mjs <deadline|control> <report>
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';

const ROOT = repoRoot();
const CELL = process.argv[2] ?? '';
const REPORT_PATH = process.argv[3] ?? '';
/** The deadline cell's floor, and how long either cell watches the frozen call. */
const SHORT_FLOOR_MS = 4_000;
const LONG_FLOOR_MS = 600_000;
const WATCH_MS = 20_000;
/** How long a new host has to appear, and an old one to go — `hostRecoveryHost.mjs`' budgets. */
const REBUILD_BUDGET_MS = 11_000;
const DEATH_BUDGET_MS = 5_000;
const POLL_MS = 250;

/**
 * This process's child process ids, as `hostRecoveryHost.mjs` reads them (its comment has the reasons).
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
      `Get-CimInstance Win32_Process -Filter "ParentProcessId=${String(process.pid)}" | ` +
        `Where-Object { $_.ProcessId -ne $PID } | Select-Object -ExpandProperty ProcessId`,
    ],
    { encoding: 'utf8', timeout: 20_000 },
  );
  if (result.error !== undefined) throw new Error('could not enumerate this process’s children', { cause: result.error });
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

/**
 * Suspends every thread of `pid`. A harness's fault injection: `NtSuspendProcess` is what a debugger's break does.
 *
 * @param {number} pid
 */
function freeze(pid) {
  const koffi = createRequire(join(ROOT, 'package.json'))('koffi');
  const kernel32 = koffi.load('kernel32.dll');
  const ntdll = koffi.load('ntdll.dll');
  const openProcess = kernel32.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)');
  const suspend = ntdll.func('int32 NtSuspendProcess(void *process)');
  const closeHandle = kernel32.func('bool CloseHandle(void *handle)');
  const PROCESS_SUSPEND_RESUME = 0x0800;
  const handle = openProcess(PROCESS_SUSPEND_RESUME, false, pid);
  if (koffi.address(handle) === 0n) throw new Error(`OpenProcess refused the host ${String(pid)}`);
  const status = suspend(handle);
  closeHandle(handle);
  if (status !== 0) throw new Error(`NtSuspendProcess answered 0x${(status >>> 0).toString(16)}`);
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

/**
 * @param {any} handlers
 * @param {string} docId
 * @returns {Promise<number | string>}
 */
async function firstPageRotation(handlers, docId) {
  try {
    const model = await handlers['document.viewModel']({ docId, pages: [0] });
    return model.ok === true ? Number(model.value.rotations[0]) : `refused:${String(model.error.code)}`;
  } catch (error) {
    return `threw:${String(error?.constructor?.name ?? 'Error')}`;
  }
}

async function main() {
  if (CELL !== 'deadline' && CELL !== 'control') throw new Error(`the cell must be deadline or control, not "${CELL}"`);
  if (REPORT_PATH === '') throw new Error('hostDeadlineHost.mjs takes the path to write its report to');
  if (!('electron' in process.versions)) {
    throw new Error('hostDeadlineHost.mjs must run under the Electron binary in Node mode, as the shell does');
  }

  /** @type {typeof import('../../apps/desktop/src/composition.js')} */
  const composition = await built('apps/desktop/dist/composition.js');
  /** @type {typeof import('../../apps/desktop/src/engineHostPlatform.js')} */
  const platformModule = await built('apps/desktop/dist/engineHostPlatform.js');
  /** @type {typeof import('../../apps/desktop/src/harnessComposition.js')} */
  const harnessModule = await built('apps/desktop/dist/harnessComposition.js');
  const { buildLargeFixture } = await built('scripts/perf/largeFixture.mjs');

  const scratch = mkdtempSync(join(tmpdir(), 'monstera-host-deadline-'));
  try {
    const source = buildLargeFixture({ root: ROOT, targetBytes: 64 * 1024, pages: 1, name: 'perf-baseline.pdf' }).path;
    const document = join(scratch, 'frozen.pdf');
    copyFileSync(source, document);
    const sessionRoot = join(scratch, 'engine-sessions');
    mkdirSync(sessionRoot, { recursive: true });
    const platform = platformModule.createEngineHostPlatform(sessionRoot, {
      report: (outcome) => {
        if (!outcome.ok) process.stderr.write(`package-data check: ${outcome.error}\n`);
      },
    });
    if (platform === null) throw new Error('createEngineHostPlatform returned null, so no contained host can exist here');

    // THE ONE VALUE THE CELLS DIFFER IN. No document bytes count toward it (`msPerMiB: 0`), so the deadline is the
    // floor exactly and the timing below can be read against it.
    const floorMs = CELL === 'deadline' ? SHORT_FLOOR_MS : LONG_FLOOR_MS;
    const { handlers } = composition.createShellDependencies({
      ...harnessModule.harnessSurfaces('the host-deadline harness'),
      appInfo: { version: '0.0.0', installChannel: 'development', userName: 'A. Tester' },
      pickDocument: () => Promise.resolve(document),
      enginePlatform: platform,
      hostCallDeadline: { floorMs, msPerMiB: 0 },
    });

    const opened = await handlers['document.open']({});
    if (opened.ok !== true || opened.value.kind !== 'opened') throw new Error(`the document did not open: ${JSON.stringify(opened)}`);
    const docId = `${opened.value.docId}`;

    const first = await rotate(handlers, docId);
    const before = childProcessIds();
    if (before.length !== 1) throw new Error(`expected exactly one child, the engine host, and found ${String(before.length)}`);
    const frozenPid = before[0] ?? 0;

    // THE FREEZE, then a call into it: from `main` this is a host that was sent a call and answers nothing.
    freeze(frozenPid);
    const sentAt = Date.now();
    /** @type {{ ok: boolean, code: string | null } | null} */
    let frozenCall = null;
    let settledAfterMs = -1;
    const call = rotate(handlers, docId).then((outcome) => {
      frozenCall = outcome;
      settledAfterMs = Date.now() - sentAt;
    });
    await Promise.race([call, sleep(WATCH_MS)]);
    const stillWaitingAfterWatch = frozenCall === null;

    /** @type {{ settled: boolean, waitedMs: number }} */
    let oldGone = { settled: false, waitedMs: 0 };
    /** @type {{ settled: boolean, waitedMs: number, ids: number[] }} */
    let rebuilt = { settled: false, waitedMs: 0, ids: [] };
    /** @type {number | string | null} */
    let rotationAfter = null;
    /** @type {{ ok: boolean, code: string | null } | null} */
    let afterRecovery = null;
    if (CELL === 'deadline') {
      oldGone = await waitForChildren((ids) => !ids.includes(frozenPid), DEATH_BUDGET_MS);
      rebuilt = await waitForChildren((ids) => ids.some((id) => id !== frozenPid), REBUILD_BUDGET_MS);
      afterRecovery = await rotate(handlers, docId);
      rotationAfter = await firstPageRotation(handlers, docId);
    }

    writeFileSync(
      REPORT_PATH,
      `${JSON.stringify({
        cell: CELL,
        floorMs,
        firstCommand: first,
        frozenPid,
        frozenCall,
        settledAfterMs,
        stillWaitingAfterWatch,
        watchMs: WATCH_MS,
        oldGone: oldGone.settled,
        rebuilt: rebuilt.settled,
        newPid: rebuilt.ids.find((id) => id !== frozenPid) ?? 0,
        afterRecovery,
        rotationAfter,
      })}\n`,
      'utf8',
    );
    await teardown(scratch);
    process.exit(0);
  } catch (error) {
    await teardown(scratch);
    throw error;
  }
}

/**
 * Kills every host this harness created — a frozen one included, which TerminateProcess ends as it ends any other —
 * waits for them to be gone, and removes the scratch directory, reporting rather than throwing one that will not go.
 *
 * @param {string} scratch
 */
async function teardown(scratch) {
  for (const id of childProcessIds()) {
    try {
      process.kill(id);
    } catch {
      // Already gone.
    }
  }
  await waitForChildren((ids) => ids.length === 0, DEATH_BUDGET_MS);
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    process.stderr.write(`MONSTERA_HOST_DEADLINE_LEAKED ${scratch} could not be removed: ${formatError(error)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`MONSTERA_HOST_DEADLINE_FAILED ${formatError(error)}\n`);
  process.exit(1);
});
