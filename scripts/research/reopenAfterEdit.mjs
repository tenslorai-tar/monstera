// @ts-check
/**
 * Whether a block reopened straight after an edit shows the edit, and whether ending it again keeps the edit — the
 * question text-regression step 5 raised on 2026-10-16: the words it typed were in the copy saved after the edit, the
 * reopened editor showed the paragraph without them, and after a press away the page showed them nowhere.
 *
 * Every read is of the app's own output: the editor's words, the version on screen, and two copies saved through the
 * app, read by MuPDF keeping spaces (`savedPdf.mjs`). Prints one JSON line per step and a verdict.
 *
 * Usage: node scripts/research/reopenAfterEdit.mjs
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import { expect } from '@playwright/test';

import { startWalk, writesDone, writesIdle } from './liveWalk.mjs';
import { savedTextKeepingSpaces } from './savedPdf.mjs';
import { textSteps } from './textWalkSteps.mjs';

const LINES = ['Every walk step reads its own words back from the saved', 'file, by a reader that did not write them,', 'and checks the screen too.'];

// THE TEXT REGRESSION WALK'S EVERYDAY PAGE, element for element: a heading, the paragraph, small print one pitch below
// it, and a labelled form field — the page on which step 5's reopen showed the paragraph without its edit.
const made = await PDFDocument.create();
const roman = await made.embedFont(StandardFonts.TimesRoman);
const bold = await made.embedFont(StandardFonts.TimesRomanBold);
const sans = await made.embedFont(StandardFonts.Helvetica);
const sheet = made.addPage([612, 792]);
sheet.drawText('Regression page heading', { x: 72, y: 720, size: 16, font: bold });
LINES.forEach((line, at) => sheet.drawText(line, { x: 72, y: 690 - at * 14.4, size: 12, font: roman }));
sheet.drawText('Small print right below the paragraph.', { x: 72, y: 690 - 3 * 14.4 - 4, size: 9, font: sans });
sheet.drawText('Name:', { x: 72, y: 560, size: 10, font: sans });
made.getForm().createTextField('name').addToPage(sheet, { x: 110, y: 555, width: 190, height: 18 });

const walk = await startWalk('reopen-after-edit');
const { page, output, open, section, step, finish } = walk;
const { editor, ensureEditText, clickPage, savedCopy } = textSteps(walk);
const path = join(output, 'paragraph.pdf');
await writeFile(path, await made.save());

const block = () => page.getByRole('button', { name: /^Edit “Every walk step/u }).first();
/** @param {string} label @param {Record<string, unknown>} facts */
const report = (label, facts) => process.stdout.write(`${JSON.stringify({ label, ...facts })}\n`);
const words = (/** @type {string} */ text) => text.replaceAll(/\s+/gu, ' ').trim();

async function openAtEnd() {
  await ensureEditText();
  const box = await block().boundingBox();
  if (box === null) throw new Error('no block');
  await page.mouse.click(box.x + box.width - 3, box.y + box.height - Math.min(6, box.height / 2));
  await expect(editor()).toBeFocused();
  await page.keyboard.press('Control+End');
}

// THE WALK'S SESSION BEFORE STEP 5: another copy of the same page open in a tab of its own, edited with an Enter, as step 4
// left it. The same words on two pages in two tabs is the case where a read could be answered for the wrong one.
await step('another copy of the page, in its own tab, has a line broken (text-regression step 4)', async () => {
  const other = join(output, 'other.pdf');
  await writeFile(other, await made.save());
  await open(other);
  await section('Edit');
  await openAtEnd();
  await page.keyboard.press('Control+Home');
  for (let at = 0; at < 3; at += 1) await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.press('Enter');
  await clickPage(20, 20);
  await expect(editor()).toHaveCount(0, { timeout: 30_000 });
});

await step('type at the end, end with a press away, save a copy, reopen, press away, save again', async () => {
  await open(path);
  await section('Edit');
  await openAtEnd();
  await page.keyboard.type(' two  spaces');
  const typed = await editor().innerText();
  await clickPage(20, 20);
  await expect(editor()).toHaveCount(0, { timeout: 30_000 });
  const first = await savedTextKeepingSpaces(await savedCopy('after-edit.pdf'));
  report('after the edit', { editor: words(typed), saved: words(first) });
  // REOPENED AT ONCE, as the walk did; and again after every write has landed, as the control.
  const before = await writesDone(page);
  await openAtEnd();
  const reopened = await editor().innerText();
  await clickPage(20, 20);
  await expect(editor()).toHaveCount(0, { timeout: 30_000 });
  await writesIdle(page);
  const second = await savedTextKeepingSpaces(await savedCopy('after-reopen.pdf'));
  report('after the reopen', { editor: words(reopened), saved: words(second), writesDuringReopen: (await writesDone(page)) - before });
  const kept = words(second).includes('two spaces');
  return { typedSaved: words(first).includes('two spaces'), reopenedShowed: words(reopened).includes('two spaces'), keptAfterReopen: kept };
});

await finish();
