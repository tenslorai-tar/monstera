// @ts-check
/**
 * What the engine host costs before it holds a document, and how much that
 * figure MOVES between runs.
 *
 * ## Why this exists as a tracked file
 *
 * ADR-0025 carries an appended note reporting the host's fixed cost at 93.6 MB
 * against a bare-runtime control of 52.7 MB. The probe that produced those two
 * numbers was a scratchpad throwaway and no longer exists, so the figure in that
 * note could not be re-derived by anyone — including its author, one day later,
 * which is how this file came to be written. **A measurement that decides
 * something is an instrument, and an instrument that is not tracked has an
 * expiry of one session.**
 *
 * ## The question, and why one reading cannot answer it
 *
 * §9.17 gives `mupdf-host` a `base` of 128 MB. Against a fixed cost of 93.6 MB
 * that catches only a regression of 34.4 MB or more, and the argument for
 * tightening it turns on whether a tighter window is *empty* — that is, whether
 * the host's own run-to-run spread is already wider than the window. The
 * >4 MB figure that question was first weighed against was measured on `main`,
 * a different process running a different workload, so it settles nothing here.
 * This measures the host's own spread.
 *
 * ## The control, and why it is the same program
 *
 * Every reading is paired with a bare-runtime cell in the SAME run: the same
 * binary, the same Node mode, doing nothing. Subtracting it leaves the engine's
 * own share, which is the quantity §9.17 actually argues about — *"a fraction of
 * the runtime's, not a multiple of it"* — and a ratio taken against a control
 * from the same run cancels most of what a machine contributes, which an
 * absolute cannot.
 *
 * ## The resolution test, which runs BEFORE any real reading
 *
 * This is a measuring instrument, so audit item 4a applies: it must be shown to
 * report two known-different values as different before it is trusted with one
 * whose answer nobody knows. `--probe-mb` (default 8) spawns a second control
 * child that makes exactly that many megabytes resident, and the run REFUSES to
 * report unless the instrument recovers it within tolerance.
 *
 * The direction matters and is the reason the test is not merely decorative:
 * the reassuring answer here is *"the readings agree"*, and agreement is also
 * what a broken instrument returns — a reader that always reports the same
 * number, a lookup that misses and yields a default, a child that never started.
 * A spread of zero would be reported as a tight host and is indistinguishable
 * from an instrument that cannot see. So the run proves it can see a difference
 * first, and prints the evidence beside the result.
 *
 * ## Process safety
 *
 * Every child this creates is terminated on every path, including the ones
 * where a reading throws. Nothing is killed by name, by age, or by anything
 * other than the pid this process itself created — a host that merely looks old
 * has once nearly been someone else's editor.
 *
 * Usage: node scripts/research/hostFixedCost.mjs [--runs N] [--probe-mb M] [--json]
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatError } from '../lib/reportError.mjs';
import { peakWorkingSetOf } from '../perf/peakRss.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const CHILD = join(HERE, 'hostFixedCostChild.mjs');
const HOST_ENTRY = join(ROOT, 'packages', 'kernel', 'dist', 'host', 'hostEntry.js');

/** How long a child is given to settle before its working set is read. */
const SETTLE_MS = 400;

/** How long the host is given to connect before the cell is abandoned. */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * The resolution test passes if the recovered size is within this fraction of
 * the size that was actually made resident.
 *
 * Loose on purpose. The instrument only has to prove it can SEE a difference of
 * the order the decision turns on; a tight tolerance here would make the run
 * fail on ordinary allocator behaviour and teach whoever meets it to widen the
 * number, which is how a resolution test becomes a formality.
 */
const RESOLUTION_TOLERANCE = 0.4;

/** @param {string} flag @param {number} fallback @returns {number} */
function numericFlag(flag, fallback) {
  const at = process.argv.indexOf(flag);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${flag} expects a non-negative integer, got ${process.argv[at + 1]}`);
  }
  return value;
}

/**
 * The peak working set of a process this run created, read from OUTSIDE it.
 *
 * `peakWorkingSetOf` rather than a `Get-Process` call written here: what the
 * phrase *how much memory a process uses* means on Windows is `peakRss.mjs`'s
 * question, and a second spelling in this file is a second opinion about it
 * (B3a). This wrapper exists only to name the pid's provenance.
 *
 * The FIRST version of this probe read `WorkingSet64` — the current set — and
 * that is finding PPPP-1. Reading from the parent is right and unchanged; the
 * quantity was wrong, and wrong in the reassuring direction, since current is
 * never above peak and Windows trims it under pressure.
 *
 * @param {number} pid a pid THIS process spawned
 * @returns {number | null} bytes, or null if the process is already gone
 */
function peakBytes(pid) {
  return peakWorkingSetOf(pid);
}

/** @param {import('node:child_process').ChildProcess} child */
function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    child.kill();
  } catch {
    // Already gone between the check and the call. Nothing to contain.
  }
}

/** @param {number} ms */
const wait = (ms) => new Promise((settle) => setTimeout(settle, ms));

/**
 * A bare-runtime cell: the pinned binary in Node mode, holding `megabytes`
 * resident and nothing else.
 *
 * @param {string} runtime
 * @param {number} megabytes
 * @returns {Promise<{ parent: number, self: number }>} peak bytes, read both ways
 */
async function measureControl(runtime, megabytes) {
  // stdin is a live pipe rather than `ignore` because the child holds the event
  // loop open by resuming it. With `ignore` it reads EOF at once and exits, and
  // the reading would then be of a process that is already gone — which this
  // instrument reports as an error rather than as a very cheap cell, but only
  // because it checks.
  const child = spawn(runtime, [CHILD, String(megabytes)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  try {
    const ready = await new Promise((settle, fail) => {
      child.stdout.once('data', (chunk) => settle(`${chunk}`));
      child.once('error', fail);
      child.once('exit', (code) => fail(new Error(`control exited early with ${code}`)));
    });
    // `ready <residentBytes> <ownPeakBytes>` — the third field is the child's own
    // `peakRssBytes()`, kept so the parent can show the two spellings of the
    // counter agree rather than asserting that they do.
    const self = Number(`${ready}`.trim().split(/\s+/u)[2] ?? '0');
    if (!Number.isFinite(self) || self <= 0) {
      throw new Error(`the control reported no self peak: ${JSON.stringify(`${ready}`.trim())}`);
    }
    await wait(SETTLE_MS);
    const parent = peakBytes(child.pid ?? -1);
    if (parent === null) throw new Error('the control was gone before it could be read');
    return { parent, self };
  } finally {
    terminate(child);
  }
}

/**
 * The host cell: `hostEntry.js` connected to a pipe and holding no document.
 *
 * The pipe is real rather than stubbed because `hostEntry.js` exits non-zero on
 * every ending, connection failure included — a cell that measured a host which
 * had already given up would read as a very cheap host.
 *
 * @param {string} runtime
 * @param {number} index used to make the pipe name unique per cell
 * @returns {Promise<number>} working set in bytes
 */
async function measureHost(runtime, index) {
  const pipeName = `\\\\.\\pipe\\monstera-hostfixedcost-${process.pid}-${index}`;
  // An array rather than a `Socket | null` that the handler assigns: the
  // assignment happens inside a closure, so the read below narrows to `never`
  // and `tsc` rejects it. Collecting also destroys every connection rather than
  // whichever arrived last, which is the difference between cleaning up and
  // leaking all but one if the host ever reconnects.
  /** @type {import('node:net').Socket[]} */
  const accepted = [];
  const server = createServer((socket) => {
    accepted.push(socket);
  });

  await new Promise((settle, fail) => {
    server.once('error', fail);
    server.listen(pipeName, () => settle(undefined));
  });

  const child = spawn(runtime, [HOST_ENTRY, pipeName], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const connected = await Promise.race([
      new Promise((settle) => server.once('connection', () => settle(true))),
      wait(CONNECT_TIMEOUT_MS).then(() => false),
    ]);
    if (connected !== true) {
      throw new Error(
        `the host did not connect within ${CONNECT_TIMEOUT_MS}ms. A cell that reads a host ` +
          `which never connected reports a very cheap host, which is this instrument's ` +
          `reassuring answer produced by a failure.`,
      );
    }
    await wait(SETTLE_MS);
    const bytes = peakBytes(child.pid ?? -1);
    if (bytes === null) throw new Error('the host was gone before it could be read');
    return bytes;
  } finally {
    terminate(child);
    for (const socket of accepted) socket.destroy();
    server.close();
  }
}

const MB = 1024 * 1024;
/** @param {number} bytes */
const mb = (bytes) => (bytes / MB).toFixed(1);

async function main() {
  const runs = numericFlag('--runs', 10);
  const probeMb = numericFlag('--probe-mb', 8);
  const asJson = process.argv.includes('--json');

  if (runs < 2) throw new Error('--runs must be at least 2; a spread needs two readings');
  if (probeMb < 1) throw new Error('--probe-mb must be at least 1; the resolution test needs a difference');

  // `--runtime` exists because the control cell is where an unexplained 9 MB
  // sits (PPPP-1's second axis): the quantity fix moved the HOST ~20 MB and the
  // control ~0.1 MB, so whatever separates this control from the one behind
  // ADR-0025's 52.7 MB is not the counter. Which binary was measured is the next
  // candidate, and a flag makes that reproducible rather than argued.
  const runtimeAt = process.argv.indexOf('--runtime');
  const runtime = runtimeAt === -1 ? electronBinaryPath() : (process.argv[runtimeAt + 1] ?? '');
  if (!existsSync(runtime)) {
    throw new Error(`${runtime} does not exist. Run \`npm run provision:electron\` first.`);
  }
  if (!existsSync(HOST_ENTRY)) {
    throw new Error(`${HOST_ENTRY} does not exist. Run \`npm run build\` first.`);
  }

  // ---- The resolution test, before anything real is measured (item 4a) ----
  const flatCell = await measureControl(runtime, 0);
  const loadedCell = await measureControl(runtime, probeMb);
  const flat = flatCell.parent;
  const loaded = loadedCell.parent;
  const recovered = loaded - flat;
  const expected = probeMb * MB;
  const separated = Math.abs(recovered - expected) <= expected * RESOLUTION_TOLERANCE;

  // The two spellings of one counter, shown to agree rather than argued to.
  // `PeakWorkingSet64` read by the parent and `maxRSS` read by the child both
  // resolve to `PeakWorkingSetSize`; if they ever disagree, the parent-side
  // figure is not the quantity §9.17's budgets are enforced against and nothing
  // below means what it says.
  const counterGap = Math.abs(flatCell.parent - flatCell.self);
  const countersAgree = counterGap <= 2 * MB;
  if (!countersAgree) {
    process.stderr.write(
      `COUNTER CROSS-CHECK FAILED — refusing to report.\n\n` +
        `  parent, PeakWorkingSet64   ${mb(flatCell.parent)} MB\n` +
        `  child,  maxRSS             ${mb(flatCell.self)} MB\n` +
        `  difference                 ${mb(counterGap)} MB\n\n` +
        `These are meant to be one kernel figure reached two ways. A disagreement means the ` +
        `parent-side reading is not the quantity §9.17 is enforced against, which is finding ` +
        `PPPP-1 recurring in a new spelling.\n`,
    );
    process.exitCode = 1;
    return;
  }

  if (!separated) {
    process.stderr.write(
      `RESOLUTION TEST FAILED — refusing to report.\n\n` +
        `  bare runtime          ${mb(flat)} MB\n` +
        `  runtime + ${String(probeMb).padStart(3)} MB      ${mb(loaded)} MB\n` +
        `  recovered             ${mb(recovered)} MB, expected about ${probeMb}.0 MB\n\n` +
        `This instrument cannot be shown to separate two readings that differ by the amount ` +
        `the decision turns on, so any spread it reported would be indistinguishable from an ` +
        `instrument that cannot see. A spread of zero is this run's reassuring answer.\n`,
    );
    process.exitCode = 1;
    return;
  }

  // ---- The measurement ----
  /** @type {Array<{ control: number, host: number }>} */
  const cells = [];
  for (let index = 0; index < runs; index += 1) {
    const control = await measureControl(runtime, 0);
    const host = await measureHost(runtime, index);
    cells.push({ control: control.parent, host });
  }

  const hosts = cells.map((cell) => cell.host);
  const controls = cells.map((cell) => cell.control);
  const shares = cells.map((cell) => cell.host - cell.control);
  const ratios = cells.map((cell) => (cell.host - cell.control) / cell.control);

  /** @param {number[]} values */
  const spread = (values) => Math.max(...values) - Math.min(...values);
  /** @param {number[]} values */
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ runtime, runs, probeMb, resolution: { flat, loaded, recovered }, cells }, null, 2)}\n`,
    );
    return;
  }

  process.stdout.write(
    `Quantity: PEAK working set, read from the parent through peakRss.mjs.\n` +
      `  counter cross-check: parent PeakWorkingSet64 ${mb(flatCell.parent)} MB vs ` +
      `child maxRSS ${mb(flatCell.self)} MB — agree to ${mb(counterGap)} MB\n` +
      `Resolution test PASSED — the instrument separates two readings before reporting one.\n` +
      `  bare runtime ${mb(flat)} MB · +${probeMb} MB cell ${mb(loaded)} MB · recovered ${mb(recovered)} MB\n\n` +
      `${runs} paired readings, control taken in the same run as its host:\n\n` +
      `  run   control      host      engine's share    ratio\n` +
      cells
        .map(
          (cell, index) =>
            `  ${String(index + 1).padStart(3)}   ${mb(cell.control).padStart(6)} MB  ` +
            `${mb(cell.host).padStart(6)} MB   ${mb(cell.host - cell.control).padStart(6)} MB     ` +
            `${((cell.host - cell.control) / cell.control).toFixed(2)}x\n`,
        )
        .join('') +
      `\n` +
      `  host          median ${mb(median(hosts))} MB   spread ${mb(spread(hosts))} MB\n` +
      `  control       median ${mb(median(controls))} MB   spread ${mb(spread(controls))} MB\n` +
      `  engine share  median ${mb(median(shares))} MB   spread ${mb(spread(shares))} MB\n` +
      `  ratio         median ${median(ratios).toFixed(2)}x   spread ${spread(ratios).toFixed(2)}x\n\n` +
      `The host spread is what a base limit has to absorb; the ratio spread is what a ratio ` +
      `limit has to absorb. Which of the two §9.17 should carry is a B4 amendment and is not ` +
      `decided by this number.\n`,
  );
}

main().catch((error) => {
  // `formatError`, not `error.stack`: every failure here comes through `spawn`
  // or `listen`, and `Error.prototype.stack` does not include `cause` — where
  // the errno is. A pipe name already in use and a binary that will not execute
  // are the two most likely failures and are told apart by exactly that field.
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
