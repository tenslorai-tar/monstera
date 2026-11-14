// @ts-check
/**
 * Delete's rewrite, AS BUILT, keeps every save made while it runs (ADR-0279 Decision 7; the stage audit's
 * HHHHHHHHH-11, item 2a).
 *
 * ## Why a proof and not a case
 *
 * `historyStore.test.ts` holds the rule — a save the worker read half of is picked up from the last whole record — with
 * an IN-PROCESS rewriter whose timing the case controls, because a test must not load the package's build
 * (`testResolution.proof.mjs`). So nothing ran the shipped `workerRewriter` on the built `historyRewriteWorker.js` with a
 * save landing while that thread reads the file: the thread, its posting back, the tail main reads after it and the
 * rename were each proven apart, never together on the artefact. This runs them together.
 *
 * ## What it does
 *
 * The built store, `createHistoryStore` with NO rewriter given, so it starts the shipped worker. A file of long
 * conversations, large enough that the worker's read takes a few hundred milliseconds (ADR-0279 measured 237 to 297 ms
 * for twenty long ones), then one Delete, and a short save every few milliseconds from just before it until it answers.
 * Where in the worker's read each save lands is the machine's timing and is not observed; what is held is that saves
 * land across the whole Delete, so some land while the thread reads.
 *
 * ## Its cases and controls
 *
 * - CONTROL, of the instrument: enough saves landed while the Delete was in flight, spread from its start to its end.
 *   Without it, *every save kept* is also what a run whose saves all landed before or after would report.
 * - Every save made while it ran reads back whole, in this session and in a fresh one over the same folder.
 * - The deleted conversation is gone from both; CONTROL: a kept long conversation reads back whole in the fresh one, so
 *   a read that found nothing cannot pass as a removal.
 *
 * Usage: node scripts/proofs/historyRewriteBuilt.proof.mjs
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HISTORY_DELETE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';

const ROOT = repoRoot();
// THE BUILT STORE AND WORKER ARE THE SUBJECT, so a stale build would prove another Delete under this one's name.
refuseStaleBuild(ROOT, HISTORY_DELETE, 2);
// LITERAL SPECIFIERS, so `proof:electronimports` can read what this loads.
const { createHistoryStore } = await import('../../apps/desktop/dist/historyStore.js');

const PLACE = 'C:/Users/someone/Documents/contract.pdf';
const PLACE_KEY = 'a'.repeat(64);
const GUARD = /** @type {const} */ ({ kind: 'id', id: 'f1e2d3c4' });
const AT = new Date('2026-11-14T10:00:00.000Z');
/** A stand-in for `safeStorage`, which wraps the one data key and is not on Delete's path. */
const CIPHER = {
  available: () => true,
  encrypt: (/** @type {string} */ value) => Buffer.from(value, 'utf8'),
  decrypt: (/** @type {Buffer} */ cipher) => cipher.toString('utf8'),
};
/** Long conversations in the file: about 2 MiB each, so the worker's read is long enough to land saves inside. */
const LONG = 16;
const TURN_TEXT = 65_536;
const TURNS = 32;
/** How often a save is made while the Delete runs, in milliseconds. */
const EVERY_MS = 3;
/** The fewest saves that must land while the Delete is in flight, or the run could not see what it is for. */
const AT_LEAST_IN_FLIGHT = 10;

const longTurns = () =>
  Array.from({ length: TURNS }, (_unused, at) => ({
    role: /** @type {'user' | 'assistant'} */ (at % 2 === 0 ? 'user' : 'assistant'),
    text: randomBytes(TURN_TEXT).toString('base64').slice(0, TURN_TEXT),
  }));
/** @param {readonly { role: string; text: string }[] | undefined} turns */
const digest = (turns) => createHash('sha256').update(JSON.stringify(turns ?? null)).digest('hex');

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 4 });
/** @param {string} label @param {boolean} held @param {string} detail */
function check(label, held, detail) {
  const mark = roster.mark();
  if (!held) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

const folder = mkdtempSync(join(tmpdir(), 'monstera-history-rewrite-built-'));
try {
  const store = createHistoryStore(folder, CIPHER);
  /** @type {Map<string, string>} the long conversations, by key, to the digest of their turns */
  const kept = new Map();
  let doomed = '';
  for (let at = 0; at < LONG; at += 1) {
    const turns = longTurns();
    const { conversation } = store.save(PLACE_KEY, PLACE, GUARD, null, turns, null, AT);
    if (conversation === null) throw new Error('the setup saved nothing');
    if (at === Math.floor(LONG / 2)) doomed = conversation;
    else kept.set(conversation, digest(turns));
  }

  /** @type {{ key: string; turns: { role: 'user'; text: string }[]; inFlight: boolean; at: number }[]} */
  const saves = [];
  let pending = true;
  const started = performance.now();
  const saveOne = () => {
    const turns = [{ role: /** @type {const} */ ('user'), text: `A question asked while Delete ran, number ${String(saves.length)}` }];
    const { conversation } = store.save(PLACE_KEY, PLACE, GUARD, null, turns, null, AT);
    if (conversation === null) throw new Error('a save while Delete ran stored nothing');
    saves.push({ key: conversation, turns, inFlight: pending, at: performance.now() - started });
  };
  saveOne();
  const timer = setInterval(saveOne, EVERY_MS);
  const removed = await store.remove(PLACE_KEY, doomed);
  pending = false;
  const took = performance.now() - started;
  clearInterval(timer);
  saveOne();

  const during = saves.filter((save) => save.inFlight);
  const first = during[0]?.at ?? Infinity;
  const last = during.at(-1)?.at ?? -Infinity;
  check(
    'CONTROL: saves landed across the whole Delete, from its start to its end, so some landed while the worker read',
    removed && during.length >= AT_LEAST_IN_FLIGHT && first <= took * 0.1 && last >= took * 0.9,
    `${String(during.length)} save(s) in flight over ${took.toFixed(0)} ms, the first at ${first.toFixed(0)} ms and the ` +
      `last at ${last.toFixed(0)} ms; Delete answered ${String(removed)}. A file too small for the read to take time, or ` +
      'a timer the machine did not run, leaves nothing for the next cases to see.',
  );

  const fresh = createHistoryStore(folder, CIPHER);
  const lost = saves.filter(
    (save) => digest(store.read(PLACE_KEY, save.key)?.turns) !== digest(save.turns) || digest(fresh.read(PLACE_KEY, save.key)?.turns) !== digest(save.turns),
  );
  check(
    'every save made while the shipped worker rewrote the file reads back whole, here and in a fresh session',
    lost.length === 0,
    `${String(lost.length)} of ${String(saves.length)} save(s) lost or changed, the first made at ${(lost[0]?.at ?? 0).toFixed(0)} ms.`,
  );
  const listed = new Set(fresh.list(PLACE_KEY, GUARD).map((/** @type {{ key: string }} */ card) => card.key));
  check(
    'the deleted conversation is gone, read and listed, from this session and a fresh one',
    store.read(PLACE_KEY, doomed) === null && fresh.read(PLACE_KEY, doomed) === null && !listed.has(doomed),
    'the deleted conversation still reads or is listed.',
  );
  const changed = [...kept].filter(([key, was]) => digest(fresh.read(PLACE_KEY, key)?.turns) !== was || !listed.has(key));
  check(
    'CONTROL: every long conversation kept reads back whole and is listed in the fresh session',
    changed.length === 0 && listed.size === kept.size + saves.length,
    `${String(changed.length)} kept conversation(s) changed or unlisted; ${String(listed.size)} listed for ` +
      `${String(kept.size + saves.length)} kept.`,
  );

  process.stdout.write(
    `\n  the built store's Delete: ${took.toFixed(0)} ms over ${String(LONG)} long conversations, ` +
      `${String(during.length)} save(s) made while it ran\n\n`,
  );
} finally {
  rmSync(folder, { recursive: true, force: true });
}

process.stdout.write(
  failures.length > 0
    ? `\n${String(failures.length)} built history rewrite case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
    : roster.format('built history rewrite case'),
);
process.exitCode = failures.length === 0 ? 0 : 1;
