// @ts-check
/**
 * What the 100 ms of Delete's rename on a 400 MiB history file is (ADR-0279, the wiring's item 9, and the owner's
 * question of 2026-11-12): the rename itself, or Windows freeing the file it replaces, or a scanner reading that file.
 *
 * Four timings per round, in one process and one folder, the order rotated each round so no variant is always first:
 * - INTO A FREE NAME: a new 400 MiB file renamed to a name nothing holds;
 * - OVER THE OLD FILE: a new 400 MiB file renamed over an old 400 MiB one, as `replaceWithRetry` does;
 * - ASIDE THEN IN: the old file renamed to a side name and the new one renamed in, both synchronous with nothing
 *   between, timed together, and then the side file's removal timed alone (what would run off the main thread);
 * - OVER A SMALL FILE: a new 400 MiB file renamed over a 1 KiB one, which separates replacing a file from replacing a
 *   large one;
 * - INTO A FREE NAME, SETTLED: the first, once the new file has sat for `--settle` ms (5,000), which separates the
 *   rename from whatever follows a large file just written.
 * The files are random bytes, as sealed records are. Free memory is printed at the start and after each round.
 *
 * Its control: a rename of a 1 KiB file into a free name must read under 20 ms, or the clock or the disk is not in a
 * state where a 100 ms difference means anything.
 *
 * Usage: node scripts/research/renameOverCost.mjs [--rounds 5] [--mib 400]
 */

import { randomBytes } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { freemem, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

const option = (/** @type {string} */ name, /** @type {number} */ fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const ROUNDS = option('--rounds', 5);
const MIB = option('--mib', 400);
const mib = (/** @type {number} */ bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MiB`;

const folder = mkdtempSync(join(tmpdir(), 'monstera-rename-over-'));
const CHUNK = randomBytes(16 * 1024 * 1024);
/** @param {string} path @param {number} bytes */
function fill(path, bytes) {
  const fd = openSync(path, 'w');
  try {
    for (let written = 0; written < bytes; written += CHUNK.length) writeSync(fd, CHUNK, 0, Math.min(CHUNK.length, bytes - written));
  } finally {
    closeSync(fd);
  }
}
/** @param {() => void} run */
function timed(run) {
  const started = performance.now();
  run();
  return performance.now() - started;
}
const at = (/** @type {string} */ name) => join(folder, name);
const BIG = MIB * 1024 * 1024;
/** How long a file sits between being written and being renamed, in the settled variant. */
const SETTLE_MS = option('--settle', 5000);

/** @type {Record<string, number[]>} */
const readings = { 'into a free name': [], 'into a free name, settled': [], 'over the old file': [], 'aside then in': [], 'removing the aside file': [], 'over a small file': [] };

const variants = {
  'into a free name': () => {
    fill(at('new'), BIG);
    readings['into a free name']?.push(timed(() => renameSync(at('new'), at('free'))));
    rmSync(at('free'), { force: true });
  },
  'over the old file': () => {
    fill(at('old'), BIG);
    fill(at('new'), BIG);
    readings['over the old file']?.push(timed(() => renameSync(at('new'), at('old'))));
    rmSync(at('old'), { force: true });
  },
  'aside then in': () => {
    fill(at('old'), BIG);
    fill(at('new'), BIG);
    readings['aside then in']?.push(
      timed(() => {
        renameSync(at('old'), at('aside'));
        renameSync(at('new'), at('old'));
      }),
    );
    readings['removing the aside file']?.push(timed(() => rmSync(at('aside'), { force: true })));
    rmSync(at('old'), { force: true });
  },
  // THE FRESHNESS QUESTION (measured 2026-11-12: a rename into a free name cost 214 to 435 ms, so the old file was not
  // the cost): the same rename once the new file has sat for SETTLE_MS. Synchronous wait, so nothing else runs.
  'into a free name, settled': () => {
    fill(at('new'), BIG);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SETTLE_MS);
    readings['into a free name, settled']?.push(timed(() => renameSync(at('new'), at('free'))));
    rmSync(at('free'), { force: true });
  },
  'over a small file': () => {
    fill(at('old'), 1024);
    fill(at('new'), BIG);
    readings['over a small file']?.push(timed(() => renameSync(at('new'), at('old'))));
    rmSync(at('old'), { force: true });
  },
};

try {
  process.stdout.write(`free memory at the start: ${mib(freemem())} of ${mib(totalmem())}\n`);
  fill(at('tiny'), 1024);
  const tiny = timed(() => renameSync(at('tiny'), at('tiny-moved')));
  if (tiny >= 20) throw new Error(`a 1 KiB rename into a free name took ${tiny.toFixed(1)} ms, so a 100 ms difference cannot be read here`);
  process.stdout.write(`control: a 1 KiB rename into a free name took ${tiny.toFixed(1)} ms\n`);

  const names = /** @type {(keyof typeof variants)[]} */ (Object.keys(variants));
  for (let round = 0; round < ROUNDS; round += 1) {
    const order = [...names.slice(round % names.length), ...names.slice(0, round % names.length)];
    for (const name of order) variants[name]();
    process.stdout.write(`round ${String(round + 1)} (${order.join(' → ')}); free memory ${mib(freemem())}\n`);
  }
  for (const [name, values] of Object.entries(readings)) {
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
    process.stdout.write(`${name}: median ${median.toFixed(1)} ms (each: ${values.map((value) => value.toFixed(1)).join(', ')})\n`);
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}
