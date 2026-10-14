// @ts-check
/**
 * Twelve everyday text edits, walked through the running application and each read back twice: on screen, from the open
 * editor and the page's blocks, and from the saved file by readers that did not write it (pdf-lib for the fonts and the
 * content, PDF.js for the words). The owner's A8 (2026-10-14): the Windows session runs this before every MSIX, and a
 * failed step blocks the build.
 *
 * The steps are the ones a person takes without thinking, and every one of them has failed in a build somebody shipped
 * or nearly shipped: the editor changing the look of a serif page (A1), a delete refused (A2a), a font change refused or
 * its line breaks lost (A2d, A4), spaces squeezed (A6), an editor that covers the line below (A5), a form label that
 * wraps (A7). Each step asserts what only the correct behaviour produces, so a step that passes on a broken build is a
 * finding against this walk.
 *
 * ## The fixtures are built here, every run
 *
 * - a serif page in compact fonts: a bold lead-in over bare CFF programs whose descriptors state no weight
 *   (`compactSerifPage`, the shape A1 keys on);
 * - a serif page in a word processor's shape: subset Type 0 fonts with no `cmap`, a bold lead-in and a superscript,
 *   from the bundled Tinos (`producerSubsetFixture.ts`, the page N14 builds from Carlito);
 * - an everyday page in the standard fonts: a heading, a three-line paragraph, a line of small print just below it, and
 *   a one-line form label beside a text field.
 *
 * Nothing a person wrote is read: both pages are made from words in this file.
 *
 *   node scripts/research/textRegressionWalk.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { PDFDocument, PDFName, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { expect as defaultExpect } from '@playwright/test';

import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { root, startWalk } from './liveWalk.mjs';
import { savedContent, savedFonts, savedWords } from './savedPdf.mjs';
import { tabMarks, textSteps } from './textWalkSteps.mjs';

// THE PRODUCER'S PAGE, fresh or refused, beside the shell's own edges `startWalk` checks.
refuseStaleBuild(root, [['packages/kernel/src/producerSubsetFixture.ts', 'packages/kernel/dist/producerSubsetFixture.js', 'tsc']], 1);

// AN EDIT IS WRITTEN BEFORE ITS EDITOR CLOSES (3 to 4.5 s on the 13 KB sample, textWalk's reading of 2026-10-12).
const expect = defaultExpect.configure({ timeout: 30_000 });

/** The everyday page's words, in this file's own words. */
const EVERYDAY = {
  heading: 'Regression page heading',
  lines: ['Every walk step reads its own words back', 'from the saved file, by a reader that did', 'not write them, and checks the screen too.'],
  below: 'Small print right below the paragraph.',
  label: 'Name:',
};

/** An installed font every Windows has, for the steps that choose one. */
const INSTALLED = 'Georgia';

/** The serif page's line: a bold lead-in and a regular sentence, in this file's own words. */
const SERIF = { lead: 'Findings.', body: ' The serif page keeps its look while edited.' };

/**
 * A SERIF PAGE AS A PRODUCER THAT WRITES COMPACT FONTS SETS ONE (the owner's A1): a bold lead-in and a regular sentence,
 * each a simple font over a bare CFF program (`FontFile3 /Type1C`, PDFium's Foxit Serif and Serif Bold from pdf.js'
 * standard fonts), WinAnsi, and a descriptor that states the serif flag and a stem width but NO weight — the shape that
 * run 3's fixture (a TrueType program, `FontWeight 700`) could not fail on. Foxit Serif is metric-compatible with Times,
 * so the widths are Times', from pdf-lib's own metrics.
 */
async function compactSerifPage() {
  const document = await PDFDocument.create();
  const context = document.context;
  const page = document.addPage([612, 792]);
  const standard = join(dirname(createRequire(join(root, 'package.json')).resolve('pdfjs-dist/package.json')), 'standard_fonts');
  /** @param {string} file @param {string} name @param {import('@cantoo/pdf-lib').PDFFont} metrics @param {boolean} bold */
  const simple = async (file, name, metrics, bold) => {
    const program = context.register(context.flateStream(await readFile(join(standard, file)), { Subtype: 'Type1C' }));
    const descriptor = context.register(
      context.obj({
        Type: 'FontDescriptor',
        FontName: PDFName.of(name),
        // SERIF (2) AND NONSYMBOLIC (32), a stem width, and no FontWeight: the weight is the program's and the name's.
        Flags: 34,
        FontBBox: [-168, -218, 1000, 898],
        ItalicAngle: 0,
        Ascent: 891,
        Descent: -216,
        CapHeight: 662,
        StemV: bold ? 136 : 80,
        FontFile3: program,
      }),
    );
    const widths = [];
    for (let code = 32; code <= 126; code += 1) widths.push(Math.round(metrics.widthOfTextAtSize(String.fromCharCode(code), 1000)));
    return context.register(
      context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: PDFName.of(name), FirstChar: 32, LastChar: 126, Widths: widths, Encoding: 'WinAnsiEncoding', FontDescriptor: descriptor }),
    );
  };
  const boldMetrics = await document.embedFont(StandardFonts.TimesRomanBold);
  const romanMetrics = await document.embedFont(StandardFonts.TimesRoman);
  page.node.setFontDictionary(PDFName.of('FL'), await simple('FoxitSerifBold.pfb', 'FoxitSerif-Bold', boldMetrics, true));
  page.node.setFontDictionary(PDFName.of('FB'), await simple('FoxitSerif.pfb', 'FoxitSerif', romanMetrics, false));
  const lead = boldMetrics.widthOfTextAtSize(SERIF.lead, 12);
  const literal = (/** @type {string} */ text) => PDFString.of(text).toString();
  const content = ['BT', '/FL 12 Tf', '72 700 Td', `${literal(SERIF.lead)} Tj`, 'ET', 'BT', '/FB 12 Tf', `${(72 + lead).toFixed(2)} 700 Td`, `${literal(SERIF.body)} Tj`, 'ET'].join('\n');
  page.node.set(PDFName.of('Contents'), context.register(context.flateStream(new TextEncoder().encode(content))));
  return document.save({ useObjectStreams: false });
}

/** The everyday page: a heading, a three-line paragraph, a line just below it in another font, and a form label. */
async function everydayPage() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const bold = await document.embedFont(StandardFonts.TimesRomanBold);
  const roman = await document.embedFont(StandardFonts.TimesRoman);
  const sans = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(EVERYDAY.heading, { x: 72, y: 720, size: 16, font: bold });
  EVERYDAY.lines.forEach((line, at) => page.drawText(line, { x: 72, y: 690 - at * 14.4, size: 12, font: roman }));
  // ONE LINE PITCH BELOW the paragraph's last baseline, in another face and size, so it is a block of its own that an
  // editor growing downward would cover.
  page.drawText(EVERYDAY.below, { x: 72, y: 690 - 3 * 14.4 - 4, size: 9, font: sans });
  page.drawText(EVERYDAY.label, { x: 72, y: 560, size: 10, font: sans });
  document.getForm().createTextField('name').addToPage(page, { x: 110, y: 555, width: 190, height: 18 });
  return document.save({ useObjectStreams: false });
}

const walk = await startWalk('text-regression');
const { page, output, open, section, step, finish } = walk;
const { editor, panel, ensureEditText, clickPage, chooseFont, savedCopy } = textSteps(walk);

// LITERAL SPECIFIERS, so `proof:electronimports` can read what this loads.
const { buildProducerSubsetPdf } = await import('../../packages/kernel/dist/producerSubsetFixture.js');
const { fontsDirectory } = await import('../provision/fonts.mjs');
const fonts = fontsDirectory(root);
const serif = join(output, 'serif-subsets.pdf');
await writeFile(
  serif,
  await buildProducerSubsetPdf(await readFile(join(fonts, 'Tinos-Regular.ttf')), await readFile(join(fonts, 'Tinos-Bold.ttf')), { regular: 'Tinos', bold: 'Tinos-Bold' }),
);
const compactSerif = join(output, 'serif-compact.pdf');
await writeFile(compactSerif, await compactSerifPage());
const everyday = join(output, 'everyday.pdf');
await writeFile(everyday, await everydayPage());

/** The page's block whose words begin `start`, by the label its outline carries. @param {string} start */
const block = (start) => page.getByRole('button', { name: new RegExp(`^Edit “${start.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'u') }).first();

/** Opens the block whose words begin `start`, the caret at its end. @param {string} start */
async function openBlock(start) {
  await ensureEditText();
  const box = await block(start).boundingBox();
  if (box === null) throw new Error(`no block beginning “${start}” on the page`);
  await page.mouse.click(box.x + box.width - 3, box.y + box.height - Math.min(6, box.height / 2));
  await expect(editor()).toBeFocused();
  await page.keyboard.press('Control+End');
  return box;
}

/** Every refusal or warning the open editor shows, worded: none is the expectation of every step here. */
const problems = () => page.locator('.m-text-editor-problem').allInnerTexts();

/** Ends the editor with a press away, and requires that it ended with nothing refused. */
async function commit() {
  await clickPage(20, 20);
  const said = await problems();
  expect(said, 'the editor refused or warned at the press away').toStrictEqual([]);
  await expect(editor()).toHaveCount(0);
}

/**
 * Each run of the open editor: its words, whether it is drawn in a face the editor loaded from the page (`data-run-font`
 * naming one, and the browser's own `fonts.check` answering that the family is loaded), and its computed family and weight.
 */
async function runsDrawn() {
  return editor()
    .locator('.m-text-editor__run')
    .evaluateAll((spans) =>
      spans.map((span) => {
        const view = span.ownerDocument.defaultView;
        const computed = view?.getComputedStyle(span);
        const family = (computed?.fontFamily ?? '').split(',')[0]?.trim().replaceAll('"', '') ?? '';
        return {
          text: span.textContent ?? '',
          runFont: span.getAttribute('data-run-font'),
          family,
          loaded: family !== '' && span.ownerDocument.fonts.check(`12px "${family}"`),
          weight: computed?.fontWeight ?? '',
        };
      }),
    );
}

/** PDF.js's text items on a saved file's first page, with their baselines. @param {string} path */
async function savedItems(path) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: false });
  const items = (await (await (await task.promise).getPage(1)).getTextContent()).items.flatMap((item) =>
    'str' in item && item.str.trim() !== '' ? [{ str: item.str, y: Math.round(item.transform[5] * 10) / 10 }] : [],
  );
  await task.destroy();
  return items;
}

/** The distinct baselines the paragraph's words sit on in a saved file. @param {string} path */
async function paragraphBaselines(path) {
  const words = new Set(EVERYDAY.lines.join(' ').split(' '));
  const items = await savedItems(path);
  return [...new Set(items.filter((item) => item.str.split(/\s+/u).some((word) => words.has(word))).map((item) => item.y))].sort((a, b) => b - a);
}

await step('1. a serif page with a bold lead-in keeps its look while the block is open, and after an edit', async () => {
  await section('Edit');
  await open(compactSerif);
  await section('Edit');
  await openBlock(SERIF.lead);
  // EVERY RUN IN THE PAGE'S OWN FACE, loaded: a run left in the editor's kind of face is the sans the owner saw.
  /** @param {Awaited<ReturnType<typeof runsDrawn>>} runs */
  const own = (runs) => runs.every((run) => (run.runFont ?? '').startsWith('m-run-') && run.loaded);
  await expect.poll(async () => own(await runsDrawn()), { timeout: 15_000 }).toBe(true);
  const before = await runsDrawn();
  // THE LEAD-IN STILL BOLD: the page states no weight, so this is the program's and the name's.
  expect(before[0]?.weight, JSON.stringify(before)).toBe('700');
  await page.keyboard.type(' set');
  const after = await runsDrawn();
  expect(own(after), JSON.stringify(after)).toBe(true);
  await commit();
  const saved = await savedCopy('01-serif.pdf');
  const words = (await savedWords(saved))[0] ?? '';
  expect(words).toContain('edited. set');
  const named = await savedFonts(saved);
  expect(named.some((name) => name.endsWith('FoxitSerif-Bold')), JSON.stringify(named)).toBe(true);
  return { drawn: before, fontsNamed: named };
});

await step('2. delete only, on a word processor’s subsets: Backspace takes letters away and nothing is refused', async () => {
  await open(serif);
  await section('Edit');
  await openBlock('Results.');
  for (let at = 0; at < 4; at += 1) await page.keyboard.press('Backspace');
  expect(await problems()).toStrictEqual([]);
  await commit();
  const words = ((await savedWords(await savedCopy('02-deleted.pdf')))[0] ?? '').trim();
  expect(words.endsWith('sample tes'), words).toBe(true);
  return { words };
});

await step('3. typing letters the font has: no refusal, the words saved', async () => {
  await openBlock('Results.');
  await page.keyboard.type(' test');
  expect(await problems()).toStrictEqual([]);
  await commit();
  const words = (await savedWords(await savedCopy('03-typed.pdf')))[0] ?? '';
  expect(words).toContain('sample tes test');
  return { words };
});

await step('4. Enter breaks a line where it is pressed, and the break is saved', async () => {
  await open(everyday);
  await section('Edit');
  await openBlock('Every walk step');
  await page.keyboard.press('Control+Home');
  for (let at = 0; at < 3; at += 1) await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.press('Enter');
  await commit();
  const items = await savedItems(await savedCopy('04-enter.pdf'));
  const first = items.find((item) => item.str.includes('Every walk'));
  const second = items.find((item) => item.str.includes('reads its'));
  expect(first, JSON.stringify(items)).toBeDefined();
  expect(second, JSON.stringify(items)).toBeDefined();
  // ON TWO LINES: the second line's baseline below the first's.
  expect(second?.y ?? 0).toBeLessThan((first?.y ?? 0) - 1);
  return { first, second };
});

await step('5. two spaces typed stay two spaces, on screen and in the saved file', async () => {
  await openBlock('Every walk step');
  await page.keyboard.type(' two  spaces');
  expect(await editor().innerText()).toContain('two  spaces');
  await commit();
  const words = (await savedWords(await savedCopy('05-spaces.pdf')))[0] ?? '';
  expect(words).toMatch(/two {2}spaces/u);
  // ON REOPENING, still two.
  await openBlock('Every walk step');
  const shown = await editor().innerText();
  await commit();
  expect(shown).toContain('two  spaces');
  return { words };
});

await step('6. Tab is one tab, marked in the saved content', async () => {
  const before = tabMarks(await savedContent(await savedCopy('06-before.pdf')));
  await openBlock('Every walk step');
  await page.keyboard.press('Tab');
  await page.keyboard.type('tabbed');
  await commit();
  const saved = await savedCopy('06-tab.pdf');
  const after = tabMarks(await savedContent(saved));
  expect(after).toBe(before + 1);
  expect((await savedWords(saved))[0] ?? '').toContain('tabbed');
  return { before, after };
});

await step(`7. choosing ${INSTALLED} for the paragraph shows it, keeps its lines, and a press away writes it`, async () => {
  const before = await paragraphBaselines(await savedCopy('07-before.pdf'));
  await openBlock('Every walk step');
  await page.keyboard.press('Control+A');
  const samples = await chooseFont(INSTALLED);
  expect(samples.every((sample) => sample.problem === null), JSON.stringify(samples)).toBe(true);
  // SHOWN in the block and named by the picker (A3).
  await expect(panel().getByRole('button', { name: /^Font:/u })).toHaveAccessibleName(new RegExp(INSTALLED, 'u'));
  const drawn = await runsDrawn();
  expect(drawn.every((run) => run.family === INSTALLED && run.loaded), JSON.stringify(drawn)).toBe(true);
  await commit();
  const saved = await savedCopy('07-font.pdf');
  expect((await savedFonts(saved)).some((name) => name.includes(INSTALLED))).toBe(true);
  // ITS LINES KEPT (A4): as many baselines as before.
  const after = await paragraphBaselines(saved);
  expect(after.length).toBe(before.length);
  return { before, after, samples };
});

await step(`8. ${INSTALLED} chosen with nothing typed: not refused, and the words unchanged`, async () => {
  await openBlock(EVERYDAY.below.slice(0, 15));
  await page.keyboard.press('Control+A');
  const samples = await chooseFont(INSTALLED);
  expect(samples.every((sample) => sample.problem === null), JSON.stringify(samples)).toBe(true);
  await commit();
  const saved = await savedCopy('08-font-only.pdf');
  expect((await savedWords(saved))[0] ?? '').toContain(EVERYDAY.below);
  return { samples };
});

await step('9. the same line edited twice across a save and reopen: the second edit is a delete, and is not refused', async () => {
  const first = await savedCopy('09-first.pdf');
  await open(first);
  await section('Edit');
  // THE SERIF PAGE AS STEP 3 SAVED IT: words this app wrote are now part of the page the editor opens.
  await openBlock('Results.');
  await page.keyboard.press('Backspace');
  expect(await problems()).toStrictEqual([]);
  await commit();
  const words = ((await savedWords(await savedCopy('09-second.pdf')))[0] ?? '').trim();
  expect(words.endsWith('sample tes tes'), words).toBe(true);
  return { words };
});

await step('10. a block with a line just below: the open editor keeps the page’s line spacing and does not cover it', async () => {
  await open(everyday);
  await section('Edit');
  await ensureEditText();
  const below = await block(EVERYDAY.below.slice(0, 15)).boundingBox();
  const outline = await openBlock('Every walk step');
  const shown = await editor().boundingBox();
  if (below === null || shown === null) throw new Error('no box for the editor or the line below');
  await commit();
  // THE EDITOR WHERE THE BLOCK IS, no taller (A5), and above the line below it.
  expect(shown.y + shown.height, JSON.stringify({ shown, below })).toBeLessThanOrEqual(below.y + 1);
  expect(shown.height).toBeLessThanOrEqual(outline.height + 2);
  return { outline, shown, below };
});

await step('11. a one-line form label stays one line, at the label’s place, while it is edited', async () => {
  const label = await openBlock(EVERYDAY.label);
  const shown = await editor().boundingBox();
  if (shown === null) throw new Error('no box for the editor');
  // AT THE LABEL'S PLACE (A7: measured 4 to 5 px low).
  expect(Math.abs(shown.y - label.y), JSON.stringify({ shown, label })).toBeLessThanOrEqual(1.5);
  await page.keyboard.type(' (full)');
  const grown = await editor().boundingBox();
  if (grown === null) throw new Error('no box for the editor');
  // STILL ONE LINE: wider, not taller.
  expect(grown.height, JSON.stringify({ shown, grown })).toBeLessThanOrEqual(shown.height + 1);
  await commit();
  const words = (await savedWords(await savedCopy('11-label.pdf')))[0] ?? '';
  expect(words).toContain('Name: (full)');
  return { label, shown, grown };
});

await step('12. Undo takes the label’s edit back and Redo puts it again, on the page and in the saved file', async () => {
  await page.keyboard.press('Control+Z');
  await expect(block('Name: (full)')).toHaveCount(0);
  await expect(block(EVERYDAY.label)).toHaveCount(1);
  const undone = (await savedWords(await savedCopy('12-undone.pdf')))[0] ?? '';
  expect(undone).not.toContain('(full)');
  await page.keyboard.press('Control+Y');
  await expect(block('Name: (full)')).toHaveCount(1);
  const redone = (await savedWords(await savedCopy('12-redone.pdf')))[0] ?? '';
  expect(redone).toContain('Name: (full)');
  return { undone: undone.slice(0, 80), redone: redone.slice(0, 80) };
});

await finish();
