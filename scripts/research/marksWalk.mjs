// @ts-check
/**
 * The marks walk (cloud run 4, C4; ADR-0246): a watermark, headers and footers and Bates numbers added, saved, reopened,
 * edited, saved, reopened and removed in the running app with a real mouse and keyboard, each step screenshotted and
 * recorded by `liveWalk.mjs`.
 *
 *   node scripts/research/marksWalk.mjs
 *
 * The document is made here by pdf-lib, three pages of ordinary text, and the first page also carries grey turned words
 * reading CONFIDENTIAL in its OWN content: the control, a page whose text looks like a watermark and is not one. Every step
 * that changes the document is read back from the SAVED FILE by pdf-lib (`savedMarks`) and PDF.js (`savedWords`), so a
 * step that only looked right on screen does not pass.
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { PDFDocument, StandardFonts, degrees, grayscale } from '@cantoo/pdf-lib';
import { startWalk } from './liveWalk.mjs';
import { savedMarks, savedWords } from './savedPdf.mjs';

const walk = await startWalk('marks');
const { page, output, open, saveTo, command, step, finish } = walk;

const original = join(output, 'input-marks.pdf');
const added = join(output, 'marks-added.pdf');
const edited = join(output, 'marks-edited.pdf');
const removed = join(output, 'marks-removed.pdf');

const made = await PDFDocument.create();
const font = await made.embedFont(StandardFonts.Helvetica);
for (let at = 1; at <= 3; at += 1) {
  const each = made.addPage([420, 594]);
  each.drawText(`Quarterly figures, page ${String(at)}`, { font, size: 16, x: 40, y: 520 });
  // THE CONTROL: page content that resembles a watermark, which no Remove may take.
  if (at === 1) each.drawText('CONFIDENTIAL', { font, size: 48, x: 90, y: 200, rotate: degrees(45), color: grayscale(0.5), opacity: 0.3 });
}
await writeFile(original, await made.save());

/** Saves the open document as a copy at `path` and waits until it is on disk. @param {string} path */
async function saveCopy(path) {
  await saveTo(path);
  await command('Save a copy');
  await expect.poll(() => existsSync(path), { timeout: 30_000 }).toBe(true);
}

/** The kinds on each page of a saved file, sorted, and the watermark's recorded settings. @param {string} path */
async function kindsOf(path) {
  const read = await savedMarks(path);
  return read.map((each) => each.marks.map((mark) => mark.kind).sort());
}

/** @type {string[]} */
let ownAfterAdd = [];

await step('C4.1: watermark in red, a footer and Bates numbers added on every page, saved, READ BACK marked', async () => {
  await open(original);

  await command('Watermark…');
  const watermark = page.getByRole('dialog', { name: 'Watermark', exact: true });
  await watermark.getByLabel('Text', { exact: true }).fill('DRAFT');
  await watermark.getByRole('button', { name: 'Red', exact: true }).click();
  await watermark.getByRole('button', { name: 'All pages', exact: true }).click();
  await watermark.getByRole('button', { name: 'Add watermark', exact: true }).click();
  await expect(watermark).toHaveCount(0, { timeout: 30_000 });

  await command('Headers and footers…');
  const headers = page.getByRole('dialog', { name: 'Headers and footers', exact: true });
  await headers.getByLabel('Centre', { exact: true }).nth(1).fill('Page {n}');
  await headers.getByRole('button', { name: 'All pages', exact: true }).click();
  await headers.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(headers).toHaveCount(0, { timeout: 30_000 });

  await command('Bates numbering…');
  const bates = page.getByRole('dialog', { name: 'Bates numbering', exact: true });
  await bates.getByLabel('Prefix', { exact: true }).fill('EX-');
  await bates.getByRole('button', { name: 'All pages', exact: true }).click();
  await bates.getByRole('button', { name: 'Number pages', exact: true }).click();
  await expect(bates).toHaveCount(0, { timeout: 30_000 });

  await saveCopy(added);
  const kinds = await kindsOf(added);
  expect(kinds).toStrictEqual([0, 1, 2].map(() => ['Bates', 'HeaderFooter', 'Watermark']));
  const read = await savedMarks(added);
  const recorded = read[0]?.marks.find((mark) => mark.kind === 'Watermark')?.settings;
  expect(recorded).toMatchObject({ text: 'DRAFT', colour: [0.7529, 0, 0] });
  ownAfterAdd = read.map((each) => each.own);
  return { kinds, recorded };
});

await step('C4.2: the saved file REOPENED, Edit watermark… opens FILLED, the text and size changed, saved, READ BACK replaced', async () => {
  await open(added);
  await command('Edit watermark…');
  const watermark = page.getByRole('dialog', { name: 'Watermark', exact: true });
  await expect(watermark.getByLabel('Text', { exact: true })).toHaveValue('DRAFT');
  await watermark.getByLabel('Text', { exact: true }).fill('FINAL');
  await watermark.getByLabel('Size (points)', { exact: true }).fill('72');
  await watermark.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(watermark).toHaveCount(0, { timeout: 30_000 });

  await saveCopy(edited);
  const read = await savedMarks(edited);
  // ONE WATERMARK PER PAGE, the new one: a draw beside the old would leave two.
  const watermarks = read.map((each) => each.marks.filter((mark) => mark.kind === 'Watermark').map((mark) => mark.settings));
  expect(watermarks).toStrictEqual([0, 1, 2].map(() => [expect.objectContaining({ text: 'FINAL', fontSize: 72, colour: [0.7529, 0, 0] })]));
  // THE OTHER KINDS ARE UNTOUCHED by an edit of the watermark.
  expect(await kindsOf(edited)).toStrictEqual([0, 1, 2].map(() => ['Bates', 'HeaderFooter', 'Watermark']));
  return { watermarks: watermarks.map((each) => each.length) };
});

await step('C4.3: REOPENED again, all three kinds removed, saved, READ BACK with no mark and each page’s own content unchanged', async () => {
  await open(edited);
  await command('Remove watermark');
  await command('Remove headers and footers');
  await command('Remove Bates numbers');
  await saveCopy(removed);

  const read = await savedMarks(removed);
  expect(read.map((each) => each.marks)).toStrictEqual([[], [], []]);
  // THE PAGE'S OWN CONTENT, as a second reader decodes it, is what it was with the stamps on: nothing else was cut.
  expect(read.map((each) => each.own)).toStrictEqual(ownAfterAdd);
  // AND THE CONTROL: the grey turned CONFIDENTIAL that is the page's own text is still there; FINAL is not.
  const words = await savedWords(removed);
  expect(words[0]).toContain('CONFIDENTIAL');
  expect(words.join(' ')).not.toContain('FINAL');
  return { pages: read.length, controlKept: true };
});

await step('C4.4: Remove on a document with no watermark changes nothing and SAYS so', async () => {
  await command('Remove watermark');
  const notice = page.getByRole('dialog', { name: 'Marks', exact: true });
  await expect(notice).toContainText('This document has no watermark that Monstera can change or remove.');
  await page.keyboard.press('Escape');
});

await finish();
