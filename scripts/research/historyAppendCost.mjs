// @ts-check
/**
 * Where an append to a large history file spends its time (ADR-0279's correction of 2026-11-12: twice in three runs an
 * append to a 400 MiB file that read nothing took 539 and 863 ms, against about 3 ms otherwise). Every save to a large
 * file makes that append on `main`, so the question is which step: the open, the write or the close.
 *
 * A 400 MiB file of long conversations made by the built store's own `save`, then `--rounds` (20) appends of one
 * 1 KiB record, each split into the four calls `appendFileSync` makes between them (`statSync` as `appendTo` does,
 * `openSync(path, 'a')`, `writeSync`, `closeSync`), each timed apart, with `--gap` ms (500) between appends. Then the
 * same on a 1 KiB file, which separates the file's size from the calls. Free memory is printed at the start and the end.
 *
 * Its control: a planted 100 ms block must read between 100 and 130 ms.
 *
 * Usage: node scripts/research/historyAppendCost.mjs [--rounds 20] [--gap 500]
 */

import { randomBytes } from 'node:crypto';
import { closeSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { freemem, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

import { HISTORY_DELETE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

refuseStaleBuild(repoRoot(), HISTORY_DELETE, 2);
// LITERAL SPECIFIER, so `proof:electronimports` can read what this loads.
const { createHistoryStore } = await import('../../apps/desktop/dist/historyStore.js');

const option = (/** @type {string} */ name, /** @type {number} */ fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const ROUNDS = option('--rounds', 20);
const GAP_MS = option('--gap', 500);
const mib = (/** @type {number} */ bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MiB`;
const sit = (/** @type {number} */ ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
/** @param {() => unknown} run */
function timed(run) {
  const started = performance.now();
  run();
  return performance.now() - started;
}
const CIPHER = {
  available: () => true,
  encrypt: (/** @type {string} */ value) => Buffer.from(value, 'utf8'),
  decrypt: (/** @type {Buffer} */ cipher) => cipher.toString('utf8'),
};
const longTurns = () =>
  Array.from({ length: 32 }, (_unused, at) => ({
    role: /** @type {'user' | 'assistant'} */ (at % 2 === 0 ? 'user' : 'assistant'),
    text: randomBytes(65_536).toString('base64').slice(0, 65_536),
  }));

/** @param {string} path */
function appends(path) {
  /** @type {{ stat: number, open: number, write: number, close: number }[]} */
  const readings = [];
  const record = randomBytes(1024);
  for (let round = 0; round < ROUNDS; round += 1) {
    sit(GAP_MS);
    /** @type {number} */
    let fd = -1;
    const stat = timed(() => statSync(path));
    const open = timed(() => {
      fd = openSync(path, 'a');
    });
    const write = timed(() => writeSync(fd, record));
    const close = timed(() => closeSync(fd));
    readings.push({ stat, open, write, close });
  }
  return readings;
}
/** @param {string} label @param {{ stat: number, open: number, write: number, close: number }[]} readings */
function report(label, readings) {
  for (const step of /** @type {const} */ (['stat', 'open', 'write', 'close'])) {
    const values = readings.map((reading) => reading[step]);
    const sorted = [...values].sort((a, b) => a - b);
    const over = values.filter((value) => value >= 50).length;
    process.stdout.write(
      `${label}, ${step}: median ${(sorted[Math.floor(sorted.length / 2)] ?? Number.NaN).toFixed(2)} ms, worst ${(sorted.at(-1) ?? Number.NaN).toFixed(1)} ms, ${String(over)} of ${String(values.length)} at 50 ms or more\n`,
    );
  }
}

process.stdout.write(`free memory at the start: ${mib(freemem())} of ${mib(totalmem())}\n`);
{
  const planted = timed(() => sit(100));
  if (planted < 100 || planted > 130) throw new Error(`a planted 100 ms block read ${planted.toFixed(1)} ms, so this clock cannot be read`);
  process.stdout.write(`control: a planted 100 ms block read ${planted.toFixed(1)} ms\n`);
}

const folder = mkdtempSync(join(tmpdir(), 'monstera-history-append-'));
try {
  const store = createHistoryStore(folder, CIPHER);
  for (let at = 0; at < 200; at += 1) store.save('a'.repeat(64), 'C:/x.pdf', { kind: 'id', id: 'f1' }, null, longTurns(), null, new Date());
  const large = store.pathOf('a'.repeat(64));
  process.stdout.write(`the large file: ${mib(statSync(large).size)}\n`);
  report('400 MiB file', appends(large));
  const small = join(folder, 'small');
  writeFileSync(small, randomBytes(1024));
  report('1 KiB file', appends(small));
  process.stdout.write(`free memory at the end: ${mib(freemem())}\n`);
} finally {
  rmSync(folder, { recursive: true, force: true });
}
