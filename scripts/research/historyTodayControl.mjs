// @ts-check
/**
 * ADR-0279's CONTROL: today's single `chat-history.json` (`createChatHistory`, the shipped code from apps/desktop/dist),
 * measured with the cipher it is HANDED. It imports no Electron: `historyPerPdf.mjs` runs it inside the pinned Electron
 * binary's main process and passes `safeStorage`, so every entry is sealed with Windows DPAPI as the application seals it.
 * Each figure is the median of five; the store is seeded by writing its file directly (seeding by `save` would rewrite
 * the whole file once per entry).
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { HISTORY_STORE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';

/**
 * @typedef {{ available: () => boolean, encrypt: (value: string) => Buffer, decrypt: (blob: Buffer) => string }} Cipher
 * @typedef {{ role: 'user' | 'assistant', text: string }} Turn
 */

const key = () => randomBytes(32).toString('hex');

/**
 * A made-up conversation of `questions` questions and their answers; `long` puts every answer at `MAX_ANSWER_TEXT`
 * (65,536 characters). The one builder both processes use, so the control and the shape measure the same words.
 * @param {number} questions @param {boolean} long @returns {Turn[]}
 */
export function conversationOf(questions, long) {
  return Array.from({ length: questions * 2 }, (_, at) =>
    at % 2 === 0
      ? { role: /** @type {const} */ ('user'), text: `Question ${String(at / 2 + 1)} about this page?` }
      : { role: /** @type {const} */ ('assistant'), text: long ? 'a'.repeat(65_536) : 'A short answer of a sentence or two, as most are.' },
  );
}
/** @param {number[]} values */
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;
/** @param {() => void} run */
const time = (run) => {
  const started = performance.now();
  run();
  return performance.now() - started;
};

/**
 * @param {{ work: string, cipher: Cipher, short: Turn[], long: Turn[], say: (line: string) => void }} input
 */
export async function measureToday({ work, cipher, short, long, say }) {
  // THE BUILT STORE IS THE SUBJECT, so a stale build would measure yesterday's under today's name.
  refuseStaleBuild(repoRoot(), HISTORY_STORE, 2);
  // A LITERAL SPECIFIER, so `proof:electronimports` can read what this loads: today's shipped store.
  const { createChatHistory, CHAT_HISTORY_FILE } = await import('../../apps/desktop/dist/chatHistory.js');
  const directory = join(work, 'today');
  /** @param {Turn[]} turns @param {string} name */
  const blob = (turns, name) => cipher.encrypt(JSON.stringify({ v: 2, name, savedAt: new Date().toISOString(), turns })).toString('base64');
  /** `others` PDFs of one short conversation each, and `own` conversations of `ownTurns` on the measured PDF. @param {number} others @param {number} own @param {Turn[]} ownTurns */
  const seed = (others, own, ownTurns) => {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
    /** @type {Record<string, string>} */
    const entries = {};
    /** @type {Record<string, string[]>} */
    const files = {};
    const order = [];
    const shortBlob = blob(short, 'other.pdf');
    for (let at = 0; at < others; at += 1) {
      const file = key();
      const conversation = key();
      entries[conversation] = shortBlob;
      files[file] = [conversation];
      order.push(file);
    }
    const measured = key();
    const ownBlob = blob(ownTurns, 'measured.pdf');
    const keys = Array.from({ length: own }, () => key());
    for (const conversation of keys) entries[conversation] = ownBlob;
    files[measured] = keys;
    order.push(measured);
    writeFileSync(join(directory, CHAT_HISTORY_FILE), `${JSON.stringify({ order, files, entries }, null, 2)}\n`);
    return { measured, first: keys[0] ?? null, store: createChatHistory(directory, cipher, Number.POSITIVE_INFINITY) };
  };
  const size = () => statSync(join(directory, CHAT_HISTORY_FILE)).size;
  const MB = 1024 * 1024;

  say('TODAY (control), one chat-history.json, real safeStorage:');
  for (const others of [1, 200, 10_000]) {
    const { measured, store } = seed(others, 1, short);
    const took = median(Array.from({ length: 5 }, () => time(() => store.load(measured))));
    say(`  opening a PDF with ${String(others)} other PDF(s) saved: ${(size() / MB).toFixed(2)} MB of history read, ${took.toFixed(1)} ms`);
  }
  for (const others of [1, 200, 10_000]) {
    const { measured, first, store } = seed(others, 1, short);
    const took = median(Array.from({ length: 5 }, () => time(() => store.save(measured, first, long, 'measured.pdf', new Date()))));
    say(`  one save (a long conversation) with ${String(others)} other PDF(s) saved: ${took.toFixed(1)} ms`);
  }
  for (const [label, turns] of /** @type {[string, Turn[]][]} */ ([['short', short], ['long', long]])) {
    const { measured, first, store } = seed(0, 20, turns);
    const saveTook = median(Array.from({ length: 5 }, () => time(() => store.save(measured, first, turns, 'measured.pdf', new Date()))));
    store.list();
    const listTook = median(Array.from({ length: 5 }, () => time(() => store.list())));
    say(`  20 ${label} conversations on the PDF (today's cap): one save ${saveTook.toFixed(1)} ms; History ${listTook.toFixed(1)} ms; 200 and 1,000 are over the cap`);
  }
}
