// @ts-check
/**
 * The child of `hostMemory.mjs`: a real shell and a real contained host, saving a document whose save raises the host's
 * private commit past a threshold the open stays under.
 *
 * Measured 2026-10-03 on the 64 MiB picture fixture, two runs, the host's PrivateUsage read from a worker thread: about
 * 255 MiB once the document is open, and a peak of 387–388 MiB while it is saved. So a sampler that kills at
 * {@link KILL_AT_BYTES} lets the open through and must end the save — about 65 MiB of margin on either side.
 *
 * Two cells, chosen by the first argument, differing in ONE value — the shell's `hostMemorySampling`:
 *
 * - `kill`: the threshold at 320 MiB. The save must fail, the shell's log must name `memory-budget`, the file on disk
 *   must be untouched, a new host must appear, and the document must answer with the rotation it held.
 * - `control`: the shell's own `HOST_MEMORY_SAMPLING`. The same save completes and no host ends — so the first cell's
 *   ending is the sampler's, not something else that a 388 MiB save would meet anyway.
 *
 * Usage (under the Electron binary in Node mode, from the driver): hostMemoryHost.mjs <kill|control> <report>
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';

const ROOT = repoRoot();
const CELL = process.argv[2] ?? '';
const REPORT_PATH = process.argv[3] ?? '';
/** Between the open's ~255 MiB and the save's ~388 MiB (measured; the header has the figures). */
const KILL_AT_BYTES = 320 * 1024 * 1024;
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
    const source = buildLargeFixture({ root: ROOT, targetBytes: 64 * 1024 ** 2, pages: 4 }).path;
    const document = join(scratch, 'heavy.pdf');
    copyFileSync(source, document);
    const before = digest(document);
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
      pickDocument: () => Promise.resolve(document),
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

    const opened = await handlers['document.open']({});
    if (opened.ok !== true || opened.value.kind !== 'opened') throw new Error(`the document did not open: ${JSON.stringify(opened)}`);
    const docId = opened.value.docId;
    // A rotation, so the save has something to write; then the save, which is where the commit rises.
    const rotated = await handlers['document.execute']({ docId, command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 } });
    const hostsBefore = childProcessIds();
    if (hostsBefore.length !== 1) throw new Error(`expected exactly one child, the engine host, and found ${String(hostsBefore.length)}`);
    const firstHost = hostsBefore[0] ?? 0;

    /** @type {{ ok: boolean, code: string | null }} */
    let saved;
    try {
      const answer = await handlers['document.save']({ docId, breakSignatures: false });
      saved = { ok: answer.ok === true, code: answer.ok === true ? null : `${answer.error.code}` };
    } catch (error) {
      saved = { ok: false, code: `threw:${String(error?.constructor?.name ?? 'Error')}` };
    }

    const firstGone = await waitForChildren((ids) => !ids.includes(firstHost), CELL === 'kill' ? DEATH_BUDGET_MS : 0);
    /** @type {{ ids: number[], settled: boolean }} */
    let rebuilt = { ids: [], settled: false };
    if (CELL === 'kill') rebuilt = await waitForChildren((ids) => ids.some((id) => id !== firstHost), REBUILD_BUDGET_MS);
    const rotationAfter = await firstPageRotation(handlers, docId);

    writeFileSync(
      REPORT_PATH,
      `${JSON.stringify({
        cell: CELL,
        killAtBytes: CELL === 'kill' ? KILL_AT_BYTES : budget.ENGINE_HOST_PROCESS_MEMORY_LIMIT_BYTES - budget.HOST_MEMORY_SAMPLING.headroomBytes,
        rotated: rotated?.ok === true,
        saved,
        logged,
        fileUntouched: digest(document) === before,
        firstHostGone: firstGone.settled,
        newHost: rebuilt.ids.find((id) => id !== firstHost) ?? 0,
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
