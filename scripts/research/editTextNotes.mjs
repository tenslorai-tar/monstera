// @ts-check
/**
 * Every note, label and outline state Edit text shows on a page NOBODY HAS EDITED, for each PDF in a folder: the
 * review of Edit text's messages (the owner's list of 2026-11-17) checks each one appears only where it is true, by
 * running it and not by reading the code.
 *
 *   node scripts/research/editTextNotes.mjs --folder <folder of PDFs> [--pages <n>] [--app-root <checkout>]
 *
 * NOTHING ABOUT A DOCUMENT IS PRINTED: a file is its place in the folder sorted by name, a note is the MESSAGE KEY whose
 * English text it is, and an outline is counted. For each of the first `--pages` pages (3 unless given): the outlines,
 * the outlines marked past the page, the notes the layer shows, and the note the page itself shows.
 *
 * ## The control, every run
 *
 * A note whose text matches no message is printed as UNKNOWN with its length, never dropped: a matcher that knew no
 * message would otherwise report every page silent, the reassuring answer (CLAUDE.md, item 4b). And a page whose layer
 * never appears is said, rather than read as a page with no notes.
 */

import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { appRootOption, startWalk } from './liveWalk.mjs';

/** @param {string} name */
function option(name) {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
}
// `--path` FOR ONE FILE, so a person's file is opened alone and never a folder of their other documents.
const single = option('--path');
const folder = single === undefined ? option('--folder') : dirname(single);
if (folder === undefined) throw new Error('usage: node scripts/research/editTextNotes.mjs (--folder <folder of PDFs> | --path <a PDF>) [--pages <n>]');
const pages = Number(option('--pages') ?? '3');
const files =
  single === undefined
    ? readdirSync(folder)
        .filter((name) => name.toLowerCase().endsWith('.pdf'))
        .sort()
    : [basename(single)];

/** The English text of every message, keyed back to its message: the notes are matched against these. */
const { EN } = /** @type {{ EN: Record<string, string> }} */ (await import('../../packages/ui/dist/messages/en.js'));
/** @type {Map<string, string>} */
const keyOf = new Map(Object.entries(EN).map(([key, text]) => [text.trim(), key]));
/** The message a shown text is, or UNKNOWN and its length. @param {string} text */
const named = (text) => {
  const trimmed = text.trim();
  for (const [english, key] of keyOf) {
    // A NOTE WITH ITS OFFER BESIDE IT, as the no-text note carries the recognise button: named by the message it starts with.
    if (trimmed === english || (english.length > 20 && trimmed.startsWith(english))) return key;
  }
  return `UNKNOWN(${String(trimmed.length)})`;
};

const walk = await startWalk('edit-text-notes', appRootOption(process.argv));
const { page, open, finish, command } = walk;
/** @type {Map<string, number>} */
const totals = new Map();
for (const [place, name] of files.entries()) {
  await open(join(folder, name));
  // ON THROUGH ITS COMMAND, as the text walks turn it on (`textWalkSteps.mjs`); each file opens in a tab of its own.
  if ((await page.locator('[data-text-edit-layer]:visible').count()) === 0) await command('Edit text on the page');
  const slots = page.locator('.m-page-list:visible .m-page-slot');
  const count = Math.min(pages, await slots.count());
  for (let at = 0; at < count; at += 1) {
    await slots.nth(at).scrollIntoViewIfNeeded();
    const layer = page.locator(`[data-text-edit-layer="${String(at)}"]:visible`);
    try {
      await layer.waitFor({ state: 'visible', timeout: 30_000 });
    } catch {
      process.stdout.write(`file ${String(place + 1)} page ${String(at + 1)}: NO LAYER appeared in 30 s\n`);
      continue;
    }
    // READ FIRST, then SETTLED: an outline or a note must appear (20 s at most, which a page with no text waits out),
    // then the same count twice a second apart. Two zeros before the read arrives read as a page with nothing on it:
    // measured on the first run of this script, a shifted statement's first two pages counted 0 outlines.
    const shown = () => layer.locator('[data-text-block], :scope > p').count();
    for (let waited = 0; waited < 20_000 && (await shown()) === 0; waited += 250) await page.waitForTimeout(250);
    let previous = -1;
    let outlines = -2;
    for (let tries = 0; tries < 40 && outlines !== previous; tries += 1) {
      previous = outlines;
      await page.waitForTimeout(1000);
      outlines = await layer.locator('[data-text-block]').count();
    }
    const past = await layer.locator('.m-text-block--past').count();
    const labels = await layer.locator('[data-text-block-past]').count();
    const notes = (await layer.locator(':scope > p').allInnerTexts()).map(named);
    const slotNotes = (await slots.nth(at).locator('.m-page-note').allInnerTexts()).map(named);
    for (const note of [...notes, ...slotNotes, ...(past > 0 ? ['outline-past'] : []), ...(labels > 0 ? ['label-past'] : [])]) {
      totals.set(note, (totals.get(note) ?? 0) + 1);
    }
    process.stdout.write(
      `file ${String(place + 1)} page ${String(at + 1)}: ${String(outlines)} outlines, ${String(past)} past, ${String(labels)} past labels; ` +
        `layer notes [${notes.join(', ')}]; page notes [${slotNotes.join(', ')}]\n`,
    );
  }
  await page.keyboard.press('Control+W');
  // A CLOSE THAT ASKS is answered without saving: nothing here edits, so nothing should ask.
  const dont = page.getByRole('button', { name: 'Don’t save' });
  if ((await dont.count()) > 0) await dont.click();
}
process.stdout.write(`\npages showing each, across ${String(files.length)} file(s): ${JSON.stringify(Object.fromEntries(totals))}\n`);
await finish();
