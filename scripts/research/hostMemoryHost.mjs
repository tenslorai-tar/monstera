// @ts-check
/**
 * The child of `hostMemory.mjs`: a real shell and a real contained host, holding a document whose session keeps the
 * host's private commit well above what a small document's does — a LEVEL, which is what a sampler exists to see.
 *
 * Two cells, chosen by the first argument, differing in ONE value — the shell's `hostMemorySampling`:
 *
 * - `control`: the shell's own `HOST_MEMORY_SAMPLING`. A light document, then the 64 MiB heavy one beside it, each
 *   rotated, and no host ends. It MEASURES the two levels, each read with the product sampler's own access once the
 *   document's session is held. The driver puts the kill cell's threshold halfway between.
 * - `kill`: the threshold the driver passes. The heavy document ALONE: its session holds the host above the threshold,
 *   so the shell's log must name `memory-budget`, the document must end refused (`document-poisoned`, after the two
 *   attempts ADR-0023 Decision 9a allows) rather than tried for ever, its file must be untouched, and a light document
 *   opened afterwards must be served.
 *
 * WHY A LEVEL AND NOT A SAVE: this measured a save's peak first, and on CI's runner a save that peaked at 388 MiB
 * completed under a 321 MiB threshold (runs 37135035663 and 37138133293) while the product's read of the host
 * succeeded. The whole save took about 0.36 s there (36 samples at 10 ms); a peak shorter than the sampler's 100 ms
 * interval can fall between two samples. The sampler is sized for a host that grows and stays grown — the job limit is
 * the backstop for a spike — so the proof now holds the commit up rather than catching a spike by luck.
 *
 * WHY THE KILL CELL OPENS NOTHING FIRST: a host death raises the failure count of EVERY document it held, and nothing
 * resets it (a live review finding, 2026-10-03), so a light document opened first would be poisoned beside the heavy
 * one. Opened afterwards, it shares none of the heavy one's deaths.
 *
 * Usage (under the Electron binary in Node mode, from the driver): hostMemoryHost.mjs control <report>
 *                                                                  hostMemoryHost.mjs kill <report> <kill-at-bytes>
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';

const ROOT = repoRoot();
const CELL = process.argv[2] ?? '';
const REPORT_PATH = process.argv[3] ?? '';
/** The kill cell's threshold, from the driver's measurement of the control cell. */
const KILL_AT_BYTES = Number(process.argv[4] ?? 'NaN');
/** How long an old host has to go at teardown — `hostRecoveryHost.mjs`' budget. */
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
 * @returns {Promise<{ ids: number[], settled: boolean }>}
 */
async function waitForChildren(settled, budgetMs) {
  const startedAt = Date.now();
  for (;;) {
    const ids = childProcessIds();
    if (settled(ids)) return { ids, settled: true };
    if (Date.now() - startedAt >= budgetMs) return { ids, settled: false };
    await sleep(POLL_MS);
  }
}

/** @type {ReturnType<typeof bindProbe> | null} */
let probe = null;

/** The Win32 calls the read needs, declared ONCE: koffi refuses a second struct of the same name. */
function bindProbe() {
  const koffi = createRequire(join(ROOT, 'package.json'))('koffi');
  const kernel = koffi.load('kernel32.dll');
  koffi.struct('MONSTERA_PROBE_COUNTERS', {
    cb: 'uint32',
    PageFaultCount: 'uint32',
    PeakWorkingSetSize: 'size_t',
    WorkingSetSize: 'size_t',
    QuotaPeakPagedPoolUsage: 'size_t',
    QuotaPagedPoolUsage: 'size_t',
    QuotaPeakNonPagedPoolUsage: 'size_t',
    QuotaNonPagedPoolUsage: 'size_t',
    PagefileUsage: 'size_t',
    PeakPagefileUsage: 'size_t',
    PrivateUsage: 'size_t',
  });
  return {
    koffi,
    openProcess: kernel.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)'),
    memoryInfo: kernel.func('bool K32GetProcessMemoryInfo(void *process, _Out_ MONSTERA_PROBE_COUNTERS *counters, uint32 cb)'),
    lastError: kernel.func('uint32 GetLastError()'),
    closeHandle: kernel.func('bool CloseHandle(void *handle)'),
  };
}

/**
 * Opens `pid` with the product sampler's access (PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
 * memorySamplerWorker.ts) and reads its private commit once.
 *
 * @param {number} pid
 * @returns {{ opened: boolean, read: boolean, error: number, privateBytes: number }}
 */
function readWithProductAccess(pid) {
  probe ??= bindProbe();
  const { koffi, openProcess, memoryInfo, lastError, closeHandle } = probe;
  const handle = openProcess(0x1000 | 0x0001, false, pid);
  if (handle === null || koffi.address(handle) === 0n) return { opened: false, read: false, error: lastError(), privateBytes: 0 };
  /** @type {Record<string, unknown>} */
  const counters = {};
  const read = memoryInfo(handle, counters, koffi.sizeof('MONSTERA_PROBE_COUNTERS')) === true;
  const error = read ? 0 : lastError();
  closeHandle(handle);
  return { opened: true, read, error, privateBytes: Number(counters['PrivateUsage'] ?? 0) };
}

/** @param {string} path */
function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** @param {string} relative @returns {Promise<any>} */
function built(relative) {
  return import(pathToFileURL(join(ROOT, relative)).href);
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
  if (CELL !== 'kill' && CELL !== 'control') throw new Error(`the cell must be kill or control, not "${CELL}"`);
  if (REPORT_PATH === '') throw new Error('hostMemoryHost.mjs takes the path to write its report to');
  if (CELL === 'kill' && !(KILL_AT_BYTES > 0)) throw new Error('the kill cell takes its threshold in bytes as the third argument');
  if (!('electron' in process.versions)) {
    throw new Error('hostMemoryHost.mjs must run under the Electron binary in Node mode, as the shell does');
  }

  /** @type {typeof import('../../apps/desktop/src/composition.js')} */
  const composition = await built('apps/desktop/dist/composition.js');
  /** @type {typeof import('../../apps/desktop/src/engineHostPlatform.js')} */
  const platformModule = await built('apps/desktop/dist/engineHostPlatform.js');
  /** @type {typeof import('../../apps/desktop/src/harnessComposition.js')} */
  const harnessModule = await built('apps/desktop/dist/harnessComposition.js');
  /** @type {typeof import('../../apps/desktop/src/budget.js')} */
  const budget = await built('apps/desktop/dist/budget.js');
  const { buildLargeFixture } = await built('scripts/perf/largeFixture.mjs');

  const scratch = mkdtempSync(join(tmpdir(), 'monstera-host-memory-'));
  try {
    const heavy = join(scratch, 'heavy.pdf');
    copyFileSync(buildLargeFixture({ root: ROOT, targetBytes: 64 * 1024 ** 2, pages: 4 }).path, heavy);
    const light = join(scratch, 'light.pdf');
    copyFileSync(buildLargeFixture({ root: ROOT, targetBytes: 64 * 1024, pages: 1, name: 'perf-baseline.pdf' }).path, light);
    const before = digest(heavy);
    /** What the next `document.open` picks. */
    let next = light;
    const sessionRoot = join(scratch, 'engine-sessions');
    mkdirSync(sessionRoot, { recursive: true });
    const platform = platformModule.createEngineHostPlatform(sessionRoot, {
      report: (outcome) => {
        if (!outcome.ok) process.stderr.write(`package-data check: ${outcome.error}\n`);
      },
    });
    if (platform === null) throw new Error('createEngineHostPlatform returned null, so no contained host can exist here');

    // A RECORDING LOG, so the reason a host ended is a line in the report rather than on stderr.
    /** @type {string[]} */
    const logged = [];
    // THE ONE VALUE THE CELLS DIFFER IN: the kill cell's headroom puts the threshold at KILL_AT_BYTES of commit.
    const hostMemorySampling =
      CELL === 'kill'
        ? { ...budget.HOST_MEMORY_SAMPLING, headroomBytes: budget.ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES - KILL_AT_BYTES }
        : budget.HOST_MEMORY_SAMPLING;
    const { handlers } = composition.createShellDependencies({
      ...harnessModule.harnessSurfaces('the host-memory harness'),
      appInfo: { version: '0.0.0', installChannel: 'development', userName: 'A. Tester' },
      pickDocument: () => Promise.resolve(next),
      enginePlatform: platform,
      hostMemorySampling,
      log: {
        directory: scratch,
        failures: (/** @type {{ event: string, detail: string }} */ failure) => {
          logged.push(`${failure.event}: ${failure.detail}`);
        },
        incidents: (/** @type {{ id: string, channel: string }} */ incident) => {
          logged.push(`incident ${incident.id} on ${incident.channel}`);
        },
        reveal: () => Promise.resolve(false),
        write: () => undefined,
      },
    });

    /** Opens `path` and gives back its id. @param {string} path */
    const open = async (path) => {
      next = path;
      const opened = await handlers['document.open']({});
      if (opened.ok !== true || opened.value.kind !== 'opened') throw new Error(`${path} did not open: ${JSON.stringify(opened)}`);
      return opened.value.docId;
    };
    /** One rotation, answered as ok or by its error code. @param {import('@monstera/shared').DocId} docId */
    const rotate = async (docId) => {
      try {
        const answer = await handlers['document.execute']({ docId, command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 } });
        return answer.ok === true ? 'ok' : `${answer.error.code}`;
      } catch (error) {
        return `threw:${String(error?.constructor?.name ?? 'Error')}`;
      }
    };
    /** The one engine host's commit, read with the product sampler's own access. */
    const hostCommit = () => {
      const ids = childProcessIds();
      if (ids.length !== 1) throw new Error(`expected exactly one child, the engine host, and found ${String(ids.length)}`);
      return readWithProductAccess(ids[0] ?? 0);
    };

    /** @type {Record<string, unknown>} */
    const report = { cell: CELL, killAtBytes: CELL === 'kill' ? KILL_AT_BYTES : budget.ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES - budget.HOST_MEMORY_SAMPLING.headroomBytes };
    if (CELL === 'control') {
      // THE TWO LEVELS, each read once the document's session is held, so each is a commit that STAYS — the light
      // document alone, then with the heavy one beside it. A sampler every 100 ms sees a level; it may miss a spike.
      const lightId = await open(light);
      report['lightRotated'] = await rotate(lightId);
      await sleep(1000);
      const lightLevel = hostCommit();
      const heavyId = await open(heavy);
      report['heavyRotated'] = await rotate(heavyId);
      await sleep(1000);
      const heavyLevel = hostCommit();
      report['productRead'] = heavyLevel;
      report['measured'] = { first: lightLevel.privateBytes, peak: heavyLevel.privateBytes, samples: lightLevel.read && heavyLevel.read ? 2 : 0 };
    } else {
      // THE HEAVY DOCUMENT ALONE: opening it creates its session, which holds the host above the threshold. The shell
      // tries a document's session twice and then poisons it (onDocumentOpened, ADR-0023 Decision 9a), so it is
      // asked until it answers document-poisoned or the wait runs out — never for ever.
      const heavyId = await open(heavy);
      /** @type {string[]} */
      const answers = [];
      const began = Date.now();
      while (Date.now() - began < 30_000) {
        const answer = await rotate(heavyId);
        answers.push(answer);
        if (answer === 'document-poisoned') break;
        await sleep(1000);
      }
      report['heavyAnswers'] = answers;
      // AND THEN A LIGHT DOCUMENT, opened afterwards so it has no part in the heavy one's deaths: a host serves it.
      const lightId = await open(light);
      report['lightAfter'] = await rotate(lightId);
      report['lightRotationAfter'] = await firstPageRotation(handlers, lightId);
    }
    report['logged'] = logged;
    report['heavyUntouched'] = digest(heavy) === before;
    writeFileSync(REPORT_PATH, `${JSON.stringify(report)}\n`, 'utf8');
    await teardown(scratch);
    process.exit(0);
  } catch (error) {
    await teardown(scratch);
    throw error;
  }
}

/**
 * Kills every host this harness created, waits for them to be gone, and removes the scratch directory, reporting rather
 * than throwing one that will not go.
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
    process.stderr.write(`MONSTERA_HOST_MEMORY_LEAKED ${scratch} could not be removed: ${formatError(error)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`MONSTERA_HOST_MEMORY_FAILED ${formatError(error)}\n`);
  process.exit(1);
});
