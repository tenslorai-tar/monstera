// @ts-check
/**
 * What Delete one costs on a large history file, and whether it holds `main` (ADR-0279, the owner's answers, Decision 7
 * and the wiring's item 9): the built store, `createHistoryStore`, with its own worker rewriter, on files of long
 * conversations made by its own `save`. No AI service is called and no conversation is real.
 *
 * Two readings per Delete: its wall time, and the longest the main thread went without running a timer while it ran
 * (a 5 ms interval's worst gap). A rewrite on a worker leaves the gap near a timer's period; one on the main thread makes
 * the gap about as long as the rewrite.
 *
 * NOT `monitorEventLoopDelay`: measured 2026-11-12, it reported a maximum of 16 ms across the main-thread control's
 * 3,552 ms block, so it is blind to one long block, which is the thing asked. The tick gap read that block as 3,552 ms.
 *
 * Its controls, before anything is reported:
 * - a planted 500 ms block on the main thread must read as a gap of at least 450 ms, or the gap reading is blind;
 * - the same Delete through a rewriter that runs ON the main thread (`runHistoryRewrite`, the worker's own function)
 *   must read a gap well past the worker's, or the reading cannot tell the two apart, which is the question;
 * - the deleted conversation must be in no record of the file afterwards, and a kept one must still be there.
 *
 * Usage: node scripts/research/historyDeleteCost.mjs [--sizes 20,200]
 */

import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { freemem, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

import { HISTORY_DELETE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

const ROOT = repoRoot();
// THE BUILT STORE AND WORKER ARE THE SUBJECT, so a stale build would measure another Delete under this one's name.
refuseStaleBuild(ROOT, HISTORY_DELETE, 2);
// LITERAL SPECIFIERS, so `proof:electronimports` can read what this loads.
const { createHistoryStore } = await import('../../apps/desktop/dist/historyStore.js');
const { workerRewriter } = await import('../../apps/desktop/dist/historyRewriter.js');
const { runHistoryRewrite } = await import('../../packages/nodemode/dist/index.js');

const sizesAt = process.argv.indexOf('--sizes');
const SIZES = (sizesAt > 0 ? (process.argv[sizesAt + 1] ?? '') : '20,200').split(',').map(Number);
if (SIZES.some((size) => !Number.isInteger(size) || size < 3)) throw new Error('--sizes takes whole numbers of at least 3');

const PLACE = 'C:/Users/someone/Documents/contract.pdf';
const PLACE_KEY = 'a'.repeat(64);
const GUARD = /** @type {const} */ ({ kind: 'id', id: 'f1e2d3c4' });
const AT = new Date('2026-11-12T10:00:00.000Z');
/** A stand-in for `safeStorage`, which wraps the one data key and is not on Delete's path. */
const CIPHER = {
  available: () => true,
  encrypt: (/** @type {string} */ value) => Buffer.from(value, 'utf8'),
  decrypt: (/** @type {Buffer} */ cipher) => cipher.toString('utf8'),
};
/** A LONG conversation: 32 turns at the answer's bound, about 2 MiB, ADR-0279's *long* (20 of them were 40 MB). */
const TURN_TEXT = 65_536;
const TURNS = 32;
const longTurns = () =>
  Array.from({ length: TURNS }, (_unused, at) => ({
    role: /** @type {'user' | 'assistant'} */ (at % 2 === 0 ? 'user' : 'assistant'),
    text: randomBytes(TURN_TEXT).toString('base64').slice(0, TURN_TEXT),
  }));

const mib = (/** @type {number} */ bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MiB`;

/**
 * Runs `work` while reading the main thread's worst gap between 5 ms timer ticks and the event-loop delay maximum.
 *
 * @param {() => Promise<unknown>} work
 */
async function underWatch(work) {
  let last = performance.now();
  let worstGap = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    worstGap = Math.max(worstGap, now - last);
    last = now;
  }, 5);
  const started = performance.now();
  const answer = await work();
  const wall = performance.now() - started;
  // ONE MORE TICK after the work, so a block at its very end is counted rather than left between the last two reads.
  await new Promise((resolve) => setTimeout(resolve, 20));
  clearInterval(tick);
  return { answer, wall, worstGap };
}

process.stdout.write(`free memory at the start: ${mib(freemem())} of ${mib(totalmem())}\n`);

// THE GAP READING'S CONTROL: a planted 500 ms block must read as one.
{
  const planted = await underWatch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    const until = performance.now() + 500;
    while (performance.now() < until) {
      // the planted block
    }
  });
  if (planted.worstGap < 450) throw new Error(`a planted 500 ms block read as a worst gap of ${planted.worstGap.toFixed(0)} ms, so the gap reading is blind`);
  process.stdout.write(`control: a planted 500 ms block read as a ${planted.worstGap.toFixed(0)} ms gap\n`);
}

/** @param {number} size @param {'worker' | 'main thread'} where */
async function deleteOnce(size, where) {
  const folder = mkdtempSync(join(tmpdir(), 'monstera-history-delete-'));
  try {
    const rewriter = where === 'worker' ? workerRewriter() : (/** @type {any} */ data) => Promise.resolve(runHistoryRewrite(data));
    const store = createHistoryStore(folder, CIPHER, undefined, rewriter);
    /** @type {string[]} */
    const keys = [];
    for (let at = 0; at < size; at += 1) {
      const { conversation } = store.save(PLACE_KEY, PLACE, GUARD, null, longTurns(), `conversation ${String(at)}`, AT);
      if (conversation === null) throw new Error('a long conversation was not saved');
      keys.push(conversation);
    }
    const path = store.pathOf(PLACE_KEY);
    const bytes = statSync(path).size;
    const gone = keys[Math.floor(size / 2)] ?? '';
    const kept = keys[0] ?? '';
    const reading = await underWatch(() => store.remove(PLACE_KEY, gone));
    const left = store.conversationsIn(path);
    if (reading.answer !== true || left.includes(gone) || !left.includes(kept) || left.length !== size - 1) {
      throw new Error(`Delete on ${String(size)} did not remove exactly the one: answered ${String(reading.answer)}, ${String(left.length)} left, removed one present ${String(left.includes(gone))}, kept one present ${String(left.includes(kept))}`);
    }
    return { bytes, ...reading };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

for (const size of SIZES) {
  const worker = await deleteOnce(size, 'worker');
  const inThread = await deleteOnce(size, 'main thread');
  const again = await deleteOnce(size, 'worker');
  for (const [label, reading] of /** @type {const} */ ([['worker', worker], ['main thread (control)', inThread], ['worker, again', again]])) {
    process.stdout.write(
      `${String(size)} long conversations, ${mib(reading.bytes)}, ${label}: Delete ${reading.wall.toFixed(0)} ms; main thread's worst gap ${reading.worstGap.toFixed(0)} ms\n`,
    );
  }
  // THE COMPARISON'S CONTROL: on the main thread the gap must be most of the rewrite, or the two cannot be told apart.
  if (inThread.worstGap < Math.max(200, 4 * Math.max(worker.worstGap, again.worstGap))) {
    throw new Error(`on ${String(size)} the main-thread rewrite's gap (${inThread.worstGap.toFixed(0)} ms) is not well past the worker's (${worker.worstGap.toFixed(0)}, ${again.worstGap.toFixed(0)} ms), so this reading cannot tell them apart`);
  }
}
