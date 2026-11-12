// @ts-check
/**
 * What the 100 ms of Delete's rename on a 400 MiB history file is (ADR-0279, the wiring's item 9, and the owner's
 * question of 2026-11-12), measured on DELETE'S OWN SHAPE: a new file just written, renamed over an old file that has
 * sat, through the store's own `replaceWithRetry`.
 *
 * The first version of this instrument (658e14df) wrote the old file just before replacing it and timed a bare
 * `renameSync`, so it measured neither the file Delete replaces nor the call Delete makes (HHHHHHHHH-16). Here:
 * - every rename goes through the built `replaceWithRetry`, with a `rename` that counts its attempts and the codes of the
 *   ones that failed, so a retry's 40 ms pauses are seen rather than folded into a time;
 * - the OLD file is written and then left for `--settle` ms (5,000) before the round's new file is written, as the file
 *   Delete replaces has sat since the last save;
 * - the NEW file is renamed the moment it is written, as Delete's is.
 *
 * Four timings per round, the order rotated each round so no variant is always first:
 * - NEW OVER SETTLED OLD: Delete's own shape;
 * - NEW INTO A FREE NAME: the same new file with nothing to replace, so the difference is the old file's share;
 * - SETTLED NEW OVER SETTLED OLD: both have sat, so the difference from the first is the new file's share;
 * - SETTLED NEW INTO A FREE NAME.
 * The files are random bytes, as sealed records are. Free memory is printed at the start and after each round.
 *
 * Its controls, before anything is read:
 * - RESOLUTION: the clock and `timed` must read a 1 KiB rename under 20 ms and the same rename with a planted 100 ms
 *   inside it between 100 and 130 ms, so a 100 ms difference is one this instrument can see;
 * - the attempt counter must count one attempt for that 1 KiB rename, so a count of one below means one attempt.
 *
 * Usage: node scripts/research/renameOverCost.mjs [--rounds 5] [--mib 400] [--settle 5000]
 */

import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdtempSync, openSync, renameSync, rmSync, writeSync } from 'node:fs';
import { freemem, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

import { HISTORY_DELETE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

// THE BUILT RETRY IS THE SUBJECT. `settingsFile.js` is built by the same compile as `historyStore.js`, whose edge this
// checks, so a stale store is the sign of a stale retry too.
refuseStaleBuild(repoRoot(), HISTORY_DELETE, 2);
// LITERAL SPECIFIER, so `proof:electronimports` can read what this loads.
const { replaceWithRetry } = await import('../../apps/desktop/dist/settingsFile.js');

const option = (/** @type {string} */ name, /** @type {number} */ fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const ROUNDS = option('--rounds', 5);
const MIB = option('--mib', 400);
const SETTLE_MS = option('--settle', 5000);
const mib = (/** @type {number} */ bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MiB`;
const BIG = MIB * 1024 * 1024;

const folder = mkdtempSync(join(tmpdir(), 'monstera-rename-over-'));
const at = (/** @type {string} */ name) => join(folder, name);
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
/** A synchronous wait: nothing else runs in this process meanwhile. */
const sit = (/** @type {number} */ ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * `replaceWithRetry(from, to)` timed, with every attempt its `rename` made counted and each failure's code kept.
 *
 * @param {string} from @param {string} to @param {number} [planted] ms added inside the first attempt
 */
function replaced(from, to, planted = 0) {
  /** @type {string[]} */
  const failures = [];
  let attempts = 0;
  const started = performance.now();
  replaceWithRetry(from, to, (/** @type {string} */ a, /** @type {string} */ b) => {
    attempts += 1;
    if (attempts === 1 && planted > 0) sit(planted);
    try {
      renameSync(a, b);
    } catch (cause) {
      failures.push(String(/** @type {NodeJS.ErrnoException} */ (cause).code));
      throw cause;
    }
  });
  return { ms: performance.now() - started, attempts, failures };
}

/** @typedef {{ ms: number, attempts: number, failures: string[] }} Reading */
/** @type {Record<string, Reading[]>} */
const readings = {
  'new over settled old': [],
  'new into a free name': [],
  'settled new over settled old': [],
  'settled new into a free name': [],
};

/** Each variant: what is written and when, then the one timed replace. */
const variants = {
  'new over settled old': () => {
    fill(at('old'), BIG);
    sit(SETTLE_MS);
    fill(at('new'), BIG);
    readings['new over settled old']?.push(replaced(at('new'), at('old')));
  },
  'new into a free name': () => {
    fill(at('new'), BIG);
    readings['new into a free name']?.push(replaced(at('new'), at('free')));
  },
  'settled new over settled old': () => {
    fill(at('old'), BIG);
    fill(at('new'), BIG);
    sit(SETTLE_MS);
    readings['settled new over settled old']?.push(replaced(at('new'), at('old')));
  },
  'settled new into a free name': () => {
    fill(at('new'), BIG);
    sit(SETTLE_MS);
    readings['settled new into a free name']?.push(replaced(at('new'), at('free')));
  },
};
const clear = () => {
  for (const name of ['old', 'new', 'free']) if (existsSync(at(name))) rmSync(at(name));
};

try {
  process.stdout.write(`free memory at the start: ${mib(freemem())} of ${mib(totalmem())}\n`);

  // RESOLUTION: a plain 1 KiB replace, and the same with a planted 100 ms, must read apart by about that.
  fill(at('tiny'), 1024);
  const plain = replaced(at('tiny'), at('tiny-moved'));
  fill(at('tiny'), 1024);
  const marked = replaced(at('tiny'), at('tiny-moved'), 100);
  if (plain.ms >= 20 || marked.ms < 100 || marked.ms > 130) {
    throw new Error(`resolution: a 1 KiB replace read ${plain.ms.toFixed(1)} ms and with a planted 100 ms ${marked.ms.toFixed(1)} ms, so a 100 ms difference cannot be read here`);
  }
  if (plain.attempts !== 1) throw new Error(`the attempt counter read ${String(plain.attempts)} attempts for one rename, so its counts mean nothing`);
  process.stdout.write(`control: a 1 KiB replace ${plain.ms.toFixed(1)} ms, with a planted 100 ms ${marked.ms.toFixed(1)} ms, ${String(plain.attempts)} attempt\n`);

  const names = /** @type {(keyof typeof variants)[]} */ (Object.keys(variants));
  for (let round = 0; round < ROUNDS; round += 1) {
    const order = [...names.slice(round % names.length), ...names.slice(0, round % names.length)];
    for (const name of order) {
      variants[name]();
      clear();
    }
    process.stdout.write(`round ${String(round + 1)} (${order.join(' → ')}); free memory ${mib(freemem())}\n`);
  }
  for (const [name, values] of Object.entries(readings)) {
    const sorted = values.map((value) => value.ms).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
    const each = values.map((value) => `${value.ms.toFixed(1)}${value.attempts > 1 ? ` (${String(value.attempts)} attempts: ${value.failures.join(', ')})` : ''}`);
    process.stdout.write(`${name}: median ${median.toFixed(1)} ms (each: ${each.join(', ')})\n`);
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}
