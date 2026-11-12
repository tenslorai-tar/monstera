// @ts-check
/**
 * What a session's FIRST WRITE to a large history file costs `main`, now that no write may land behind a torn record
 * (the owner's answer of 2026-11-12, `appendTo` in `historyStore.ts`): that write walks the file's record heads to find
 * where the last whole one ends. It may be the guard a PDF's open records, so it is on the open's path.
 *
 * The built store, on a file of long conversations made by its own `save` (as `historyDeleteCost.mjs` makes them):
 * - FIRST WRITE: a new store (a new session) records the PDF's guard, which walks the heads;
 * - NEXT WRITE: the same store records another guard, which must read nothing;
 * - FIRST WRITE, TORN TAIL: part of a record appended to the file first, so the walk does not end at the file's end and
 *   every record is opened to find the last whole one (`wholeRecords`' second pass) before the tail is cut.
 * Each is one synchronous call on this thread, so its wall time is the time `main` is held.
 *
 * Its controls, before anything is read:
 * - RESOLUTION: `timed` must read a planted 100 ms block between 100 and 130 ms;
 * - the torn tail must be gone after its first write, so the third reading is of the walk that found it.
 *
 * Usage: node scripts/research/historyFirstWriteCost.mjs [--sizes 20,200]
 */

import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { freemem, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

import { HISTORY_DELETE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

// THE BUILT STORE IS THE SUBJECT, so a stale build would measure another write under this one's name.
refuseStaleBuild(repoRoot(), HISTORY_DELETE, 2);
// LITERAL SPECIFIERS, so `proof:electronimports` can read what this loads.
const { createHistoryStore, frame } = await import('../../apps/desktop/dist/historyStore.js');

const sizesAt = process.argv.indexOf('--sizes');
const SIZES = (sizesAt > 0 ? (process.argv[sizesAt + 1] ?? '') : '20,200').split(',').map(Number);
if (SIZES.some((size) => !Number.isInteger(size) || size < 1)) throw new Error('--sizes takes whole numbers of at least 1');

const PLACE = 'C:/Users/someone/Documents/contract.pdf';
const PLACE_KEY = 'a'.repeat(64);
const GUARD = /** @type {const} */ ({ kind: 'id', id: 'f1e2d3c4' });
const OTHER = /** @type {const} */ ({ kind: 'id', id: '99887766' });
const AT = new Date('2026-11-12T10:00:00.000Z');
/** A stand-in for `safeStorage`, which wraps the one data key and is not on this path. */
const CIPHER = {
  available: () => true,
  encrypt: (/** @type {string} */ value) => Buffer.from(value, 'utf8'),
  decrypt: (/** @type {Buffer} */ cipher) => cipher.toString('utf8'),
};
/** A LONG conversation: 32 turns at the answer's bound, about 2 MiB, ADR-0279's *long*. */
const TURN_TEXT = 65_536;
const longTurns = () =>
  Array.from({ length: 32 }, (_unused, at) => ({
    role: /** @type {'user' | 'assistant'} */ (at % 2 === 0 ? 'user' : 'assistant'),
    text: randomBytes(TURN_TEXT).toString('base64').slice(0, TURN_TEXT),
  }));
const settleAt = process.argv.indexOf('--settle');
const SETTLE_MS = settleAt > 0 ? Number(process.argv[settleAt + 1]) : 5000;
const mib = (/** @type {number} */ bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MiB`;
/** @param {() => void} run */
function timed(run) {
  const started = performance.now();
  run();
  return performance.now() - started;
}

process.stdout.write(`free memory at the start: ${mib(freemem())} of ${mib(totalmem())}\n`);
{
  const planted = timed(() => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100));
  if (planted < 100 || planted > 130) throw new Error(`a planted 100 ms block read ${planted.toFixed(1)} ms, so this clock cannot be read`);
  process.stdout.write(`control: a planted 100 ms block read ${planted.toFixed(1)} ms\n`);
}

for (const size of SIZES) {
  const folder = mkdtempSync(join(tmpdir(), 'monstera-history-first-write-'));
  try {
    const maker = createHistoryStore(folder, CIPHER);
    for (let at = 0; at < size; at += 1) maker.save(PLACE_KEY, PLACE, GUARD, null, longTurns(), `conversation ${String(at)}`, AT);
    const path = maker.pathOf(PLACE_KEY);
    const bytes = statSync(path).size;

    // JUST WRITTEN, then SETTLED: measured 2026-11-12, an append to a 400 MiB file written a moment before cost about as
    // much as the walk before it, so the file's freshness is read apart from the walk.
    const fresh = createHistoryStore(folder, CIPHER);
    const freshFirst = timed(() => fresh.recordGuard(PLACE_KEY, PLACE, GUARD));
    const freshNext = timed(() => fresh.recordGuard(PLACE_KEY, PLACE, OTHER));
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SETTLE_MS);
    const session = createHistoryStore(folder, CIPHER);
    const first = timed(() => session.recordGuard(PLACE_KEY, PLACE, GUARD));
    const next = timed(() => session.recordGuard(PLACE_KEY, PLACE, OTHER));

    const torn = Buffer.concat([frame(3, randomBytes(32), randomBytes(4096)).subarray(0, 37), randomBytes(1000)]);
    appendFileSync(path, torn);
    const mending = createHistoryStore(folder, CIPHER);
    const mended = timed(() => mending.recordGuard(PLACE_KEY, PLACE, GUARD));
    if (readFileSync(path).includes(torn)) throw new Error('the torn tail is still in the file after a first write, so the third reading is not of the walk that cuts it');

    process.stdout.write(
      `${String(size)} long conversations, ${mib(bytes)}: just written, first write ${freshFirst.toFixed(1)} ms and next ${freshNext.toFixed(1)} ms; after ${String(SETTLE_MS)} ms, first write ${first.toFixed(1)} ms and next ${next.toFixed(1)} ms; first write with a torn tail ${mended.toFixed(1)} ms; free memory ${mib(freemem())}\n`,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
