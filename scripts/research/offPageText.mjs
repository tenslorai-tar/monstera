// @ts-check
/**
 * Whether each reader of a page's text reads text lying wholly OFF the page: Edit text's blocks (PDFium's runs, which
 * Translate reads too), Find, word count and the text layer (MuPDF's structured text, which select and copy, Ask AI's
 * page text and export read too). Run in the application, through the channels each surface asks.
 *
 *   node scripts/research/offPageText.mjs --path <a PDF> [--app-root <checkout>]
 *
 * NOTHING ABOUT THE DOCUMENT'S WORDS IS PRINTED: a word chosen to search for is chosen by this script and never shown,
 * and every reading is a count. Written for a statement whose maker draws the whole statement on every page, shifted,
 * with the page edge hiding the rest (Fix 2 of the owner's list of 2026-11-17).
 *
 * ## What is counted, a page at a time
 *
 * - **Edit text's blocks**: how many, how many lie wholly outside the page's box, and how many cross an edge.
 * - **Find**: a word drawn only off the page, searched for; a reader that reads off the page finds it.
 * - **Word count** against the words of Edit text's blocks on the page and off it.
 * - **The text layer**: its words, against the same.
 *
 * ## The control, every page
 *
 * A word from the text ON the page is searched for too, and must be found: a search that found nothing at all would
 * read exactly like a reader that leaves off-page text out (CLAUDE.md, item 4b). A page with no word that is only off
 * the page says so rather than reporting a clean search.
 */

import { readFileSync } from 'node:fs';

import * as mupdf from 'mupdf';

import { appRootOption, startWalk } from './liveWalk.mjs';

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}
const given = option('--path');
if (given === undefined) throw new Error('usage: node scripts/research/offPageText.mjs --path <a PDF> [--app-root <checkout>]');
const path = given;

/** Each page's box, in PDF space, from MuPDF: the box the page shows. */
const boxes = (() => {
  const document = mupdf.Document.openDocument(readFileSync(path), 'application/pdf');
  /** @type {[number, number, number, number][]} */
  const all = [];
  for (let at = 0; at < document.countPages(); at += 1) {
    const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = document.loadPage(at).getBounds();
    all.push([x0, y0, x1, y1]);
  }
  return all;
})();

const walk = await startWalk('off-page-text', appRootOption(process.argv));
const { page, open, finish } = walk;
await open(path);
const docId = await page.locator('[data-tab-select][aria-current="true"]').first().getAttribute('data-tab-select');
if (docId === null) throw new Error('no document tab is current');

/** @param {string} channel @param {Record<string, unknown>} params @returns {Promise<any>} */
const ask = (channel, params) =>
  page.evaluate(
    ([name, input]) => /** @type {{ monstera: { invoke: (c: string, p: unknown) => Promise<unknown> } }} */ (/** @type {unknown} */ (globalThis)).monstera.invoke(name, input),
    /** @type {const} */ ([channel, params]),
  );

/** The words of a string, as a person counts them. @param {string} text */
const wordsOf = (text) => text.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '');

let failures = 0;
for (let at = 0; at < boxes.length; at += 1) {
  const [px0, py0, px1, py1] = boxes[at] ?? [0, 0, 0, 0];
  /** @type {{ box: { x0: number, y0: number, x1: number, y1: number }, lines: { runs: { text: string }[] }[] }[]} */
  const blocks = [];
  for (let from = /** @type {number | null} */ (0); from !== null; ) {
    const answer = await ask('document.textBlocks', { docId, page: at, from });
    if (answer?.ok !== true) throw new Error(`textBlocks refused on page ${String(at + 1)}: ${JSON.stringify(answer).slice(0, 120)}`);
    blocks.push(...answer.value.blocks);
    from = answer.value.next;
  }
  const off = blocks.filter(({ box }) => box.x1 <= px0 || box.x0 >= px1 || box.y1 <= py0 || box.y0 >= py1);
  const crossing = blocks.filter((block) => !off.includes(block)).filter(({ box }) => box.x0 < px0 || box.y0 < py0 || box.x1 > px1 || box.y1 > py1);
  const textOf = (/** @type {typeof blocks} */ some) => some.flatMap((block) => block.lines.flatMap((line) => line.runs.map((run) => run.text))).join(' ');
  const onWords = wordsOf(textOf(blocks.filter((block) => !off.includes(block))));
  const offWords = wordsOf(textOf(off));
  const onSet = new Set(onWords.map((word) => word.toLowerCase()));
  // A WORD DRAWN ONLY OFF THE PAGE, and one drawn on it, chosen here and never printed.
  const offOnly = offWords.find((word) => word.length >= 5 && /^\p{L}+$/u.test(word) && !onSet.has(word.toLowerCase()));
  const onWord = onWords.find((word) => word.length >= 4 && /^\p{L}+$/u.test(word));
  const search = async (/** @type {string} */ query) => {
    const answer = await ask('document.searchPage', { docId, page: at, query, limit: 50, caseSensitive: false, wholeWord: true });
    return answer?.ok === true ? answer.value.matches.length : -1;
  };
  const foundOn = onWord === undefined ? -1 : await search(onWord);
  const foundOff = offOnly === undefined ? null : await search(offOnly);
  const count = await ask('document.pageWordCount', { docId, page: at });
  const layer = await ask('document.pageTextLayer', { docId, page: at, limit: 2048 });
  const layerWords = layer?.ok === true ? wordsOf(layer.value.lines.map((/** @type {{ text: string }} */ line) => line.text).join(' ')).length : -1;
  if (onWord !== undefined && foundOn < 1) {
    process.stdout.write(`page ${String(at + 1)}: CONTROL FAILED, a word on the page was not found (${String(foundOn)}), so Find's reading here says nothing\n`);
    failures += 1;
    continue;
  }
  process.stdout.write(
    `page ${String(at + 1)}: Edit text ${String(blocks.length)} blocks, ${String(off.length)} wholly off the page, ${String(crossing.length)} crossing an edge; ` +
      `words on ${String(onWords.length)}, off ${String(offWords.length)}; ` +
      `word count ${String(count?.ok === true ? count.value.words : -1)}; text layer ${String(layerWords)} words; ` +
      `Find: on-page word ${String(foundOn)} match(es), ${foundOff === null ? 'no word only off the page' : `off-page word ${String(foundOff)} match(es)`}\n`,
  );
}
await finish();
process.exitCode = failures === 0 ? 0 : 1;
