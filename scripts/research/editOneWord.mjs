// @ts-check
/**
 * One letter typed into one block of a page with Edit text, saved as a copy, and the copy's every line compared with
 * the original's: the lines on the page and the lines off it, as MuPDF reads the content with no clip. The owner's Fix 2
 * of 2026-11-17: an edit to a visible word must change only that word, and the text off the page must stay as it was.
 *
 *   node scripts/research/editOneWord.mjs --path <a PDF> --save <a path to save the copy at> [--page <n>] [--app-root <checkout>]
 *
 * NOTHING ABOUT THE DOCUMENT IS PRINTED: counts of lines, each page's. The copy is written where `--save` says and
 * removed when the comparison is done, since it carries the document's words.
 *
 * ## What is compared
 *
 * For each page, the lines MuPDF reads with `clip=no` (every line the content draws, off the page as well), in order:
 * how many there were, how many are the same, how many differ, and how many of those lie off the page. A passing edit
 * differs in exactly one line, on the page, and in no line off it.
 *
 * ## The control
 *
 * The comparison must find the one line the edit changed: a comparison that found no difference at all would read like
 * an edit that kept everything, and it is refused as one that did not see the edit.
 */

import { readFileSync, rmSync } from 'node:fs';

import * as mupdf from 'mupdf';

import { appRootOption, startWalk } from './liveWalk.mjs';
import { textSteps } from './textWalkSteps.mjs';

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}
const path = option('--path');
const save = option('--save');
const pageNumber = Number(option('--page') ?? '1');
if (path === undefined || save === undefined) throw new Error('usage: node scripts/research/editOneWord.mjs --path <a PDF> --save <path> [--page <n>]');

/**
 * Each page's lines, as MuPDF reads every line the content draws, and whether each lies off the page.
 * @param {Uint8Array} bytes
 * @returns {{ text: string, off: boolean }[][]}
 */
function linesOf(bytes) {
  const document = mupdf.Document.openDocument(bytes, 'application/pdf');
  /** @type {{ text: string, off: boolean }[][]} */
  const pages = [];
  for (let at = 0; at < document.countPages(); at += 1) {
    const page = document.loadPage(at);
    const [px0 = 0, py0 = 0, px1 = 0, py1 = 0] = page.getBounds();
    /** @type {{ text: string, off: boolean }[]} */
    const lines = [];
    let current = '';
    /** @type {number[]} */
    let box = [0, 0, 0, 0];
    page.toStructuredText('clip=no').walk({
      beginLine: (bbox) => {
        current = '';
        box = [...bbox];
      },
      onChar: (character) => {
        current += character;
      },
      endLine: () => {
        const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = box;
        lines.push({ text: current, off: x1 <= px0 || x0 >= px1 || y1 <= py0 || y0 >= py1 });
      },
    });
    pages.push(lines);
  }
  return pages;
}

const before = linesOf(readFileSync(path));
const walk = await startWalk('edit-one-word', appRootOption(process.argv));
const steps = textSteps(walk);
await walk.open(path);
// ON THROUGH ITS COMMAND: a document just opened shows the Home tab, where the ribbon's toggle is not.
if ((await walk.page.locator('[data-text-edit-layer]:visible').count()) === 0) await walk.command('Edit text on the page');
const layer = walk.page.locator(`[data-text-edit-layer="${String(pageNumber - 1)}"]:visible`);
await walk.page.locator('.m-page-list:visible .m-page-slot').nth(pageNumber - 1).scrollIntoViewIfNeeded();
const outlines = layer.locator('[data-text-block]');
for (let waited = 0; waited < 30_000 && (await outlines.count()) === 0; waited += 250) await walk.page.waitForTimeout(250);
// A BLOCK IN THE MIDDLE OF THE PAGE'S LIST, the letter typed where the press puts the caret.
const block = outlines.nth(Math.floor((await outlines.count()) / 2));
await steps.openBlock(block, 'middle');
await walk.page.keyboard.type('Z');
const problems = await steps.pressAway();
await walk.saveTo(save);
await walk.command('Save a copy…');
for (let waited = 0; waited < 60_000; waited += 500) {
  try {
    readFileSync(save);
    break;
  } catch {
    await walk.page.waitForTimeout(500);
  }
}
await walk.finish();

const after = linesOf(readFileSync(save));
rmSync(save, { force: true });
/**
 * The lines of `from` not in `to`, counted as a multiset: a comparison by place read every line after a wrapped one as
 * changed (page 3 of the first run: one line more after the edit, 67 counted as differing).
 * @template {{ text: string }} L
 * @param {L[]} from @param {{ text: string }[]} to
 * @returns {L[]}
 */
const missingFrom = (from, to) => {
  /** @type {Map<string, number>} */
  const left = new Map();
  for (const line of to) left.set(line.text, (left.get(line.text) ?? 0) + 1);
  return from.filter((line) => {
    const count = left.get(line.text) ?? 0;
    if (count === 0) return true;
    left.set(line.text, count - 1);
    return false;
  });
};
let changed = 0;
let changedOff = 0;
for (let at = 0; at < before.length; at += 1) {
  const was = before[at] ?? [];
  const now = after[at] ?? [];
  const lost = missingFrom(was, now);
  const gained = missingFrom(now, was);
  const lostOff = lost.filter((line) => line.off).length;
  changed += lost.length;
  changedOff += lostOff;
  process.stdout.write(
    `page ${String(at + 1)}: ${String(was.length)} lines before (${String(was.filter((line) => line.off).length)} off the page), ${String(now.length)} after; ` +
      `${String(lost.length)} line(s) no longer there, ${String(gained.length)} new; ${String(lostOff)} of those gone were off the page\n`,
  );
}
process.stdout.write(`the editor said: ${problems.length === 0 ? 'nothing' : `${String(problems.length)} note(s)`}\n`);
if (changed === 0) {
  process.stdout.write('CONTROL FAILED: no line differs, so the comparison did not see the edit\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`${changed === 1 && changedOff === 0 ? 'ONLY THE EDITED LINE CHANGED' : 'MORE CHANGED THAN THE EDITED LINE'}: ${String(changed)} line(s), ${String(changedOff)} off the page\n`);
  process.exitCode = changed === 1 && changedOff === 0 ? 0 : 1;
}
