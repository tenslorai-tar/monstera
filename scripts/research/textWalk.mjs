// @ts-check
/**
 * The text walk (CLOUD-BUNDLE, the text spec's ACCEPTANCE WALK): editing words in the running app with a real mouse and
 * keyboard on Windows, each step screenshotted and recorded by `liveWalk.mjs`.
 *
 *   node scripts/research/textWalk.mjs [path/to/sample5.pdf] [path/to/Handwritten table.pdf]
 *
 * The documents default to `_review/test-files/sample5.pdf` and `Desktop\Handwritten table.pdf`. Each is copied before
 * anything opens it, and the copies are what the app writes to. What a step writes is read back from the SAVED FILE by
 * a second reader: PDF.js for the words, pdf-lib for the fonts the pages name, so a step that only looked right on
 * screen does not pass.
 *
 * Steps 1 to 7 are the bundle's walk; step 8 is the owner's CJK check (answer 3 of 2026-10-11): Chinese and Japanese
 * typed with Add text, saved, and read back as their own letters rather than missing-character boxes, with the font that
 * drew them named, so whether this Windows install leaves a CJK gap is a measurement and not a guess. Steps 10 to 14 walk
 * what the second cloud round built (ADR-0228): the formatting set, Tab, the document's fonts in the picker, and a text
 * box styled word by word while typed and set in a real font, each read back from the saved file. Steps 15 to 19 walk
 * the third round (Part D) as the owner's N10 left it: no Format group in the ribbon, the words formatted from the
 * Properties panel and Ctrl+B instead, a dashed text box border (E4), and the one font picker in the
 * Watermark and Insert from Markdown windows (D1), read back from one saved file. Step N14 opens a word processor's page
 * of subset fonts built here and reads the editor's drawn fonts, bold and superscript, then the written file's rise.
 */
import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect as defaultExpect } from '@playwright/test';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString, StandardFonts } from '@cantoo/pdf-lib';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { boxSettled, root, startWalk, writesDone, writesIdle, writesLanded } from './liveWalk.mjs';
import { savedContent, savedFonts, savedWords } from './savedPdf.mjs';
import { tabMarks, textSteps } from './textWalkSteps.mjs';

// THE PRODUCER'S PAGE THE N14 STEP BUILDS, fresh or refused, beside the shell's own edges `startWalk` checks.
refuseStaleBuild(root, [['packages/kernel/src/producerSubsetFixture.ts', 'packages/kernel/dist/producerSubsetFixture.js', 'tsc']], 1);

const sample = process.argv[2] ?? join(root, '_review/test-files/sample5.pdf');
const handwritten = process.argv[3] ?? join(homedir(), 'Desktop', 'Handwritten table.pdf');
if (!existsSync(sample)) throw new Error(`No document at ${sample}. Pass the path to sample5.pdf.`);

// AN EDIT IS WRITTEN BEFORE ITS EDITOR CLOSES: measured 2026-10-12 on the 13 KB sample, the editor stays up, marked busy,
// for 3 to 4.5 s after a click away, so the default 5 s wait on an expectation is too short and 30 s is what a step gets.
const expect = defaultExpect.configure({ timeout: 30_000 });

const walk = await startWalk('text');
const { app, page, output, copyOf, open, saveTo, command, section, pressOn, step, finish } = walk;
const document = await copyOf(sample);

/**
 * A SECOND COPY OF THE SAME FILE UNDER A NAME OF ITS OWN. `copyOf` names its copy after its source, so a second copy of
 * the sample is the first copy's path: it overwrites the file the app has open, and opening it opens nothing new, so the
 * step that asked for a fresh document walks the old one with its edits still on it.
 * @param {string} name
 * @param {string} source
 */
async function distinctCopy(name, source) {
  const staged = join(output, name);
  await copyFile(source, staged);
  return copyOf(staged);
}

/**
 * A press INSIDE a box the walk drew, at `dx`, `dy` from where the drawing offsets start (the page's left edge, and its top
 * or the top of the document area if the page is scrolled under the ribbon), which selects it: a text box is not one of
 * the annotation layer's marks (that layer draws the kinds that have a renderer there), so it has no element to ask for.
 * @param {number} dx
 * @param {number} dy
 */
async function pressDrawn(dx, dy) {
  // THE SELECT TOOL FIRST: the Text box tool stays armed after a box is drawn, and a press with it armed draws, not selects.
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  const box = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (box === null) throw new Error('the page is not on screen');
  await page.mouse.click(box.x + dx, Math.max(box.y, 240) + dy);
}

const steps = textSteps(walk);
const { editor, panel, ensureEditText, clickPage, savedCopy } = steps;
/** What the editor said while each font choice landed, newest last (W2). */
/** @type {{ family: string, samples: import('./textWalkSteps.mjs').EditorSample[] }[]} */
const fontChoiceSamples = [];
/** @param {string} family */
const chooseFont = async (family) => {
  fontChoiceSamples.push({ family, samples: await steps.chooseFont(family) });
};

await step('1. Edit text: a click between two letters, typing, Backspace twice, Shift+Ctrl+Left, Ctrl+B lights Bold', async () => {
  await open(document);
  await section('Edit');
  await ensureEditText();
  const block = page.locator('[data-text-block]').nth(1);
  const box = await block.boundingBox();
  if (box === null) throw new Error('no second block on the first page');
  // BETWEEN TWO LETTERS in the middle of the paragraph, not at its end.
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(8, box.height / 2));
  await expect(editor()).toBeFocused();
  await page.keyboard.type(' walked');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Control+Shift+ArrowLeft');
  await page.keyboard.press('Control+B');
  await expect(panel().getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  return { typedInto: (await editor().innerText()).slice(0, 80) };
});

await step('2. the word in Calibri 14 and blue from the Properties panel, then the whole paragraph centred', async () => {
  await chooseFont('Calibri');
  const size = panel().getByRole('spinbutton', { name: 'Size in points' });
  await size.fill('14');
  await size.press('Enter');
  await panel().getByRole('button', { name: 'Blue' }).first().click();
  await expect(editor()).toBeFocused();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+E');
  const picked = await panel().getByRole('button', { name: /^Font:/u }).getAttribute('aria-label');
  return { font: picked };
});

await step('3. a click away writes it; one Ctrl+Z undoes steps 1 and 2 together, and Ctrl+Y redoes them', async () => {
  const writing = await writesDone(page);
  await clickPage(20, 20);
  await expect(editor()).toHaveCount(0);
  // EACH IS A COMMAND THAT REWRITES THE DOCUMENT (a write takes 3 to 5 s here, measured 2026-10-12), so the second key
  // waits for the first to LAND, as a hand does; sent together they left a later Add text editor open for good. Three
  // 6 s sleeps stood for these three waits (GGGGGGGG-3).
  await writesLanded(page, writing);
  const undoing = await writesDone(page);
  await page.keyboard.press('Control+Z');
  await writesLanded(page, undoing);
  const redoing = await writesDone(page);
  await page.keyboard.press('Control+Y');
  await writesLanded(page, redoing);
});

await step('4. Add text: two lines typed on a blank area, ended with Escape, and the words kept', async () => {
  await command('Add text');
  const surface = page.locator('[data-text-add-surface]').first();
  const box = await surface.boundingBox();
  if (box === null) throw new Error('no add surface');
  // N11: THE I-BEAM over the empty page, where a press puts the words.
  await expect(surface).toHaveCSS('cursor', 'text');
  // 78% DOWN THE PAGE: at 85% or lower on this 180-degree page the typed words were dropped when the editor ended
  // (measured 2026-10-12: kept at 78%, lost at 85% and 89%), reported as an app finding.
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.78);
  await expect(editor()).toBeFocused();
  await page.keyboard.type('Added by the walk, line one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('and line two');
  // ESCAPE IS THE EDITOR'S OWN WAY OUT ("Press Esc when you are done"). The font is NOT chosen here: a font chosen in an
  // Add text editor leaves it open for good (the last step walks that on its own, since an editor that cannot be ended
  // would take every step after it).
  await page.keyboard.press('Escape');
  await expect(editor()).toHaveCount(0);
  await expect(page.getByText('Added by the walk', { exact: false })).not.toHaveCount(0);
});

await step('4b. Add text ended with a CLICK AWAY on the page, and the words are in the saved file (DDDDDDDD-6)', async () => {
  // THE OTHER WAY OUT, which step 4 stopped walking when it took Escape: a person presses somewhere else on the page.
  if ((await page.getByRole('button', { name: 'Add text', exact: true }).first().getAttribute('aria-pressed')) !== 'true') {
    await command('Add text');
  }
  const surface = page.locator('[data-text-add-surface]').first();
  const box = await surface.boundingBox();
  if (box === null) throw new Error('no add surface');
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.7);
  await expect(editor()).toBeFocused();
  await page.keyboard.type('Ended by a click away');
  // THE CLICK AWAY, near the page's top and away from the words, as the walk pressed it before 1efcda50; the write it
  // ends with is waited for by its count, not by a sleep.
  const before = await writesDone(page);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.05);
  await writesLanded(page, before);
  // A PRESS ON THE PAGE WITH ADD TEXT ON may open an empty editor where it landed; one with nothing typed writes nothing.
  if ((await editor().count()) > 0) {
    await page.keyboard.press('Escape');
    await expect(editor()).toHaveCount(0);
  }
  const saved = join(output, '04b-click-away.pdf');
  await saveTo(saved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(saved), { timeout: 20_000 }).toBe(true);
  // READ BACK by PDF.js from the saved file, not from the screen.
  const words = (await savedWords(saved)).join(' ');
  expect(words, words.slice(0, 400)).toContain('Ended by a click away');
  return { kept: true };
});

await step('5. a text box from the Comment tab: drawn, typed, Arial 11, a blue border and a light fill; Text and Box shown', async () => {
  await section('Comment');
  await command('Text box');
  const surface = page.getByLabel('Draw on page 1');
  const box = await surface.boundingBox();
  if (box === null) throw new Error('no drawing surface');
  // ON SCREEN: the surface is as tall as the page and the page may be scrolled, so offsets from its top can be above the
  // document area, where a drag reaches the ribbon and draws nothing.
  const top = Math.max(box.y, 240);
  await page.mouse.move(box.x + 80, top + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, top + 120, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.type('A comment in a box');
  await page.keyboard.press('Escape');
  await pressDrawn(150, 80);
  const properties = page.getByRole('complementary', { name: 'Properties' });
  await expect(properties.getByRole('group', { name: 'Text', exact: true })).toBeVisible();
  await expect(properties.getByRole('group', { name: 'Box', exact: true })).toBeVisible();
  await properties.getByRole('button', { name: /^Font:/u }).click();
  // A TEXT BOX IS SET IN ANY FONT since K2 (ADR-0228 Decision 3): Arial is offered there, and chosen.
  const offered = await properties.locator('[data-font-choice]').evaluateAll((each) => each.map((node) => node.getAttribute('data-font-choice')));
  await properties.getByRole('combobox', { name: 'Search fonts' }).fill('Arial');
  await properties.getByRole('combobox', { name: 'Search fonts' }).press('Enter');
  return { textBoxFontsOffered: offered.length, arialOffered: offered.includes('Arial') };
});

const saved = join(output, 'walked.pdf');
await step('6. saved, closed and reopened: the words are there, editable, findable, in the fonts the pages name', async () => {
  await saveTo(saved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(saved), { timeout: 30_000 }).toBe(true);
  const words = await savedWords(saved);
  const fonts = await savedFonts(saved);
  await open(saved);
  await command('Find');
  await page.keyboard.type('line two');
  await page.keyboard.press('Enter');
  return {
    addedTextSaved: words.some((text) => text.includes('Added by the walk')),
    secondLineSaved: words.some((text) => text.includes('line two')),
    fontsNamed: fonts,
  };
});

await step('7. the font picker: the document’s fonts, Recent and this computer’s by name alone (N12); "cal" finds Calibri and Cambria', async () => {
  await section('Edit');
  await ensureEditText();
  await page.locator('[data-text-block]').first().click();
  await panel().getByRole('button', { name: /^Font:/u }).click();
  const groups = await panel().getByRole('listbox').getByRole('group').evaluateAll((each) => each.map((node) => node.getAttribute('aria-labelledby')));
  // JUST FONTS (N12): every option reads as its name and nothing else, on this computer's real list. Step 19 reads back
  // the Times New Roman step 15 picks from it.
  const described = await panel()
    .getByRole('option')
    .evaluateAll((each) => each.filter((node) => node.textContent !== node.getAttribute('data-font-choice')).map((node) => node.textContent));
  expect(described).toStrictEqual([]);
  await panel().getByRole('combobox', { name: 'Search fonts' }).fill('cal');
  const found = await panel().locator('[data-font-choice]').evaluateAll((each) => each.map((node) => node.getAttribute('data-font-choice')));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  return { groups: groups.length, calFinds: found };
});

const cjk = await distinctCopy('cjk-source.pdf', sample);
await step('8. CJK (the owner’s check): Chinese and Japanese typed with Add text are saved as their letters, and the font is named', async () => {
  await open(cjk);
  await section('Edit');
  await command('Add text');
  const surface = page.locator('[data-text-add-surface]').first();
  const box = await surface.boundingBox();
  if (box === null) throw new Error('no add surface');
  // 73% DOWN THE PAGE, which is on screen in a fresh window: a press at 85% or lower is outside the window or, on this
  // 180-degree page, near enough its edge that the words were dropped (measured 2026-10-12: kept at 78%, lost at 85%).
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.73);
  await expect(editor()).toBeFocused();
  await page.keyboard.insertText('汉字测试 日本語のテキスト');
  await page.keyboard.press('Escape');
  await expect(editor()).toHaveCount(0);
  const cjkSaved = join(output, 'cjk.pdf');
  await saveTo(cjkSaved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(cjkSaved), { timeout: 30_000 }).toBe(true);
  const words = (await savedWords(cjkSaved)).join(' ');
  // A CHARACTER NO FONT HAS is kept as text and drawn as a box (ADR-0174), so the text alone cannot say there was no gap;
  // the screenshot shows the boxes, and the fonts named say which face drew the letters, if one did.
  return { chineseKept: words.includes('汉字测试'), japaneseKept: words.includes('日本語'), fontsNamed: await savedFonts(cjkSaved) };
});

if (existsSync(handwritten)) {
  const scan = await copyOf(handwritten);
  await step('9. Handwritten table.pdf: Recognise from Edit text’s note, then a word edited on the recognised page', async () => {
    await open(scan);
    await section('Edit');
    await ensureEditText();
    // W7: THE PAGE'S NOTE ("This page is a picture, ...") OFFERS RECOGNITION in Edit text. Measured 2026-10-12 on this scan
    // it was a paragraph and nothing else, and this step went round it through Tools > OCR pages.
    await page.locator('[data-page-note] button').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // THE BUTTON TAKES A PRESS once the dialog has read what it needs (a 2 s sleep stood for this).
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Recognise', exact: true })).toBeEnabled({ timeout: 30_000 });
    await page.getByRole('dialog').getByRole('button', { name: 'Recognise', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 120_000 }).catch(() => undefined);
    await section('Edit');
    await ensureEditText();
    await expect(page.locator('[data-text-block]').first()).toBeVisible({ timeout: 120_000 });
    await pressOn(page.locator('[data-text-block]').first());
    await page.keyboard.press('End');
    await page.keyboard.type(' (walked)');
    await clickPage(10, 10);
    return { blocks: await page.locator('[data-text-block]').count() };
  });
}

/**
 * The FreeText annotations of a saved file's first page, read by pdf-lib: each one's `/RC` and the fonts its appearance
 * names by BaseFont, so a style that only looked right on screen does not pass. @param {string} path
 */
async function savedTextBoxes(path) {
  const loaded = await PDFDocument.load(await readFile(path), { updateMetadata: false, ignoreEncryption: true });
  const annots = loaded.getPages()[0]?.node.Annots();
  const boxes = [];
  for (let at = 0; at < (annots?.size() ?? 0); at += 1) {
    const annot = annots?.lookupMaybe(at, PDFDict);
    if (annot?.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() !== 'FreeText') continue;
    const rc = annot.lookup(PDFName.of('RC'));
    const ap = annot.lookupMaybe(PDFName.of('AP'), PDFDict)?.lookup(PDFName.of('N'));
    const fonts = [];
    const resources = ap instanceof PDFRawStream ? ap.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) : undefined;
    for (const [, ref] of resources?.lookupMaybe(PDFName.of('Font'), PDFDict)?.entries() ?? []) {
      const base = loaded.context.lookup(ref, PDFDict).lookupMaybe(PDFName.of('BaseFont'), PDFName);
      if (base !== undefined) fonts.push(base.decodeText());
    }
    boxes.push({ rc: rc instanceof PDFString || rc instanceof PDFHexString ? rc.decodeText() : '', fonts });
  }
  return boxes;
}

const formatted = await distinctCopy('formatted-source.pdf', sample);
await step('10. ADR-0228: strikethrough, a highlight, character spacing, Ctrl+J and space after on a paragraph, written once', async () => {
  await open(formatted);
  await section('Edit');
  await ensureEditText();
  await page.locator('[data-text-block]').nth(1).click();
  await expect(editor()).toBeFocused();
  await page.keyboard.press('Control+Shift+ArrowRight');
  await panel().getByRole('button', { name: 'Strikethrough' }).click();
  await panel().getByRole('group', { name: 'Highlight' }).getByRole('button', { name: 'Yellow highlight' }).click();
  // W4: THE SIZE IS SHOWN AND SPACING IS OPEN on an unedited paragraph, with no size typed first. Measured 2026-10-12, the
  // size box read blank here and the spacing box was disabled, and this step typed a size to get past it. The reading is
  // recorded, so a failing run says what the field held.
  const size = panel().getByRole('spinbutton', { name: 'Size in points' });
  const sizeShown = await size.inputValue();
  const spacing = panel().getByRole('spinbutton', { name: 'Character spacing in points' });
  expect({ sizeShown: sizeShown !== '', spacingOpen: await spacing.isEnabled() }).toStrictEqual({ sizeShown: true, spacingOpen: true });
  await spacing.fill('0.5');
  await spacing.press('Enter');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+J');
  const after = panel().getByRole('spinbutton', { name: /Space after/u });
  await after.fill('6');
  await after.press('Enter');
  await clickPage(10, 10);
  await expect(editor()).toHaveCount(0);
  return { sizeShown };
});

await step('11. K8/W9: Tab in Edit text types a tab, it is in the SAVED file, and the write is timed alone', async () => {
  // W9: THE TAB IS LOOKED FOR ANYWHERE IN THE WORDS. Home goes to the start of the VISUAL line under the click, which in
  // a wrapped paragraph is just after the space the line above ends in: the case `layOutParagraph` dropped (2026-10-14).
  // THE MARKS BEFORE, from a copy saved before the tab is typed, so the count after is this tab's and no other's.
  const before = await savedCopy('k8-before.pdf');
  const marksBefore = tabMarks(await savedContent(before));
  await page.locator('[data-text-block]').nth(2).click();
  await expect(editor()).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  await expect(editor()).toBeFocused();
  const typed = await editor().evaluate((element) => element.textContent?.includes('\t') ?? false);
  // THE WRITE, TIMED ALONE: from the click away to the editor closing, which is the write answering. The 7.6 to 8.7 s run 3
  // reported for an edit with a tab was a span that held this step's own 8 s sleep; this figure holds the write and nothing else.
  const clicked = performance.now();
  await clickPage(10, 10);
  await expect(editor()).toHaveCount(0);
  const writeMs = Math.round(performance.now() - clicked);
  // READ BACK FROM THE SAVED FILE by pdf-lib, not by reopening the block: the tab is written as one gap marked as U+0009
  // (ADR-0228), and the editor's own reader is the one that turns the mark back into a tab, so it could not see one missing.
  const after = await savedCopy('k8-after.pdf');
  const marksAfter = tabMarks(await savedContent(after));
  expect({ typed, written: marksAfter - marksBefore }).toStrictEqual({ typed: true, written: 1 });
  return { tabInTheWords: typed, tabMarksBefore: marksBefore, tabMarksAfter: marksAfter, writeMs };
});

await step('12. B2.8: In this document lists the fonts of every page, not only the open block’s', async () => {
  // A BLOCK ON SCREEN: the first block is above the document area here (the page is scrolled and 180 degrees round), and a
  // click on it opens nothing; any block shows the document's fonts, so the third, which step 11 also opens, is used.
  // THE PREVIOUS STEP'S WRITE MAY STILL BE RUNNING (3 to 8 s, measured 2026-10-12), and the controls of a block wait on it:
  // waited for until none is in flight (an 8 s sleep stood for this).
  await writesIdle(page);
  // THE TOOL ARMED AGAIN: the Escape that ends step 11's reopened block can also leave Edit text (2026-10-13 screenshot of
  // this step: no block layer drawn), and this step must not depend on how step 11 ended.
  await ensureEditText();
  await page.locator('[data-text-block]').nth(2).click();
  await expect(editor()).toBeFocused();
  await expect(panel()).toBeVisible();
  await panel().getByRole('button', { name: /^Font:/u }).click();
  const group = panel().getByRole('listbox').getByRole('group', { name: 'In this document' });
  const listed = await group.locator('[data-font-choice]').evaluateAll((each) => each.map((node) => node.getAttribute('data-font-choice')));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  return { documentFonts: listed };
});

/** Where the page's top was on screen when step 13 drew its box, so step 16 can scroll back to where the box is. */
let textBoxCanvasTop = 0;

await step('13. B5.8 and K2: a text box typed with Ctrl+B mid-sentence, in Calibri from its Properties', async () => {
  await section('Comment');
  await command('Text box');
  const surface = page.getByLabel('Draw on page 1');
  const box = await surface.boundingBox();
  if (box === null) throw new Error('no drawing surface');
  textBoxCanvasTop = box.y;
  const top = Math.max(box.y, 240);
  await page.mouse.move(box.x + 80, top + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, top + 280, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.type('Plain then ');
  await page.keyboard.press('Control+B');
  await page.keyboard.type('bold');
  await page.keyboard.press('Control+B');
  await page.keyboard.type(' words');
  await page.keyboard.press('Escape');
  await pressDrawn(200, 240);
  const properties = page.getByRole('complementary', { name: 'Properties' });
  await properties.getByRole('button', { name: /^Font:/u }).click();
  await properties.getByRole('combobox', { name: 'Search fonts' }).fill('Calibri');
  await properties.getByRole('combobox', { name: 'Search fonts' }).press('Enter');
});

const formattedSaved = join(output, 'formatted.pdf');
await step('14. saved: the paragraph’s words, the tab, the text box’s bold run and its embedded Calibri are in the file', async () => {
  await saveTo(formattedSaved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(formattedSaved), { timeout: 30_000 }).toBe(true);
  const boxes = await savedTextBoxes(formattedSaved);
  const walked = boxes.find((each) => each.rc.includes('bold'));
  return {
    pageFonts: await savedFonts(formattedSaved),
    textBoxBoldRun: walked?.rc.includes('font-weight:bold') ?? false,
    textBoxFonts: walked?.fonts ?? [],
  };
});

/**
 * The border style each saved text box states in its /BS, and the default style its /DS and rich text /RC state, by its
 * words. @param {string} path
 */
async function savedBorderStyles(path) {
  const loaded = await PDFDocument.load(await readFile(path), { updateMetadata: false, ignoreEncryption: true });
  const annots = loaded.getPages()[0]?.node.Annots();
  const styles = [];
  for (let at = 0; at < (annots?.size() ?? 0); at += 1) {
    const annot = annots?.lookupMaybe(at, PDFDict);
    if (annot?.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() !== 'FreeText') continue;
    const style = annot.lookupMaybe(PDFName.of('BS'), PDFDict)?.lookupMaybe(PDFName.of('S'), PDFName)?.decodeText() ?? 'none';
    const contents = annot.lookup(PDFName.of('Contents'));
    /** @param {string} key */
    const said = (key) => {
      const value = annot.lookup(PDFName.of(key));
      return value instanceof PDFString || value instanceof PDFHexString ? value.decodeText() : '';
    };
    const ds = said('DS');
    const rc = said('RC');
    styles.push({ words: contents instanceof PDFString || contents instanceof PDFHexString ? contents.decodeText() : '', style, ds, rc });
  }
  return styles;
}

await step('15. N10: no Format group in the ribbon while a block is open; Ctrl+B and Times New Roman from the Properties panel format the words', async () => {
  await section('Edit');
  await ensureEditText();
  await page.locator('[data-text-block]').first().click();
  await expect(editor()).toBeVisible();
  // THE OWNER'S DECISION: the ribbon carries none of the formatting commands nor the Font and Size boxes.
  const ribbon = page.locator('[data-pane="ribbon"]');
  await expect(ribbon.locator('[data-command]').first()).toBeVisible();
  expect(await ribbon.locator('[data-command^="text.format."]').count()).toBe(0);
  expect(await ribbon.locator('[data-ribbon-values]').count()).toBe(0);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+B');
  await chooseFont('Times New Roman');
  const stillOpen = await editor().isVisible();
  // A CLICK AWAY WRITES IT, so step 19's saved file holds the bold Times New Roman this step set.
  // THE WRITE EMBEDS A FONT, which is longer than the 3 to 5 s of a plain edit: the editor was still up after 30 s on
  // 2026-10-13 (i5-3230M), so the wait is 120 s and its length is recorded.
  const clickedAt = Date.now();
  await clickPage(20, 20);
  await expect(editor()).toHaveCount(0, { timeout: 120_000 });
  return { editorStayedOpen: stillOpen, writeTookMs: Date.now() - clickedAt, afterFontChoice: fontChoiceSamples.at(-1) };
});

await step('16. E4 and N13: the text box from step 13 made bold and justified in the one Text section, and dashed in Box', async () => {
  await section('Comment');
  // THE BOX IS WHERE IT WAS DRAWN ON THE PAGE, NOT ON THE SCREEN: steps since then scrolled the page, so it is scrolled
  // back by the distance the page's top has moved before the press is made.
  const now = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (now !== null && Math.abs(now.y - textBoxCanvasTop) > 1) {
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, now.y - textBoxCanvasTop);
    // THE SCROLL HAS ENDED: the page's box stops moving (an 800 ms sleep stood for this).
    await boxSettled(page, () => page.locator('canvas.m-page:visible').first().boundingBox());
  }
  await pressDrawn(200, 240);
  const properties = page.getByRole('complementary', { name: 'Properties' });
  // THE ONE TEXT SECTION (N13): the box's Bold is the editor's pressed button, no longer a checkbox, and the panel holds
  // no sentence about the controls.
  const text = properties.locator('[data-text-section]');
  await text.getByRole('button', { name: 'Bold' }).click();
  await expect(text.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
  await text.getByRole('button', { name: 'Justify' }).click();
  await expect(text.getByRole('button', { name: 'Justify' })).toHaveAttribute('aria-pressed', 'true');
  const style = properties.getByRole('group', { name: 'Border style' });
  expect(await style.evaluate((node) => node.closest('[data-properties-box]') !== null)).toBe(true);
  await style.getByRole('button', { name: 'Dashed' }).click();
  return {
    dashedPressed: await style.getByRole('button', { name: 'Dashed' }).getAttribute('aria-pressed'),
    sentencesInTextSection: await text.locator('p').count(),
  };
});

await step('17. D1 and L3: a watermark set in Courier New, one of this computer’s fonts, chosen in the Watermark window’s font picker', async () => {
  await section('Organize');
  await command('Watermark…');
  const dialog = page.getByRole('dialog', { name: 'Watermark' });
  await expect(dialog).toBeVisible();
  // AT ONCE, AS A PERSON TYPES (W3): this step waited five seconds here, which is the window the defect lives in, so the
  // wait hid it. The field is read after the typing and after the pick, so a run that fails says which emptied it.
  const opened = Date.now();
  const field = dialog.getByRole('textbox', { name: 'Text' });
  await field.pressSequentially('DRAFT');
  const typed = { value: await field.inputValue(), ms: Date.now() - opened };
  await dialog.getByRole('button', { name: 'Font: Helvetica' }).click();
  const offered = await dialog.locator('[data-font-choice]').evaluateAll((each) => [...new Set(each.map((node) => node.getAttribute('data-font-choice')))]);
  // A COMPUTER'S FONT (L3, ADR-0235): until the stamps moved to the MuPDF writer the row offered the three built in alone,
  // so Courier New is a family only the new route can set. Step 19 reads it back from the saved file.
  expect(offered).toContain('Courier New');
  await dialog.locator('[data-font-choice="Courier New"]').first().click();
  const picked = { value: await field.inputValue(), ms: Date.now() - opened };
  // THE WORDS MUST STILL BE THERE after the font is chosen: a font pick that emptied the text would otherwise show only as
  // "needs some text" on the button below, two steps from its cause.
  expect({ typed: typed.value, picked: picked.value }).toStrictEqual({ typed: 'DRAFT', picked: 'DRAFT' });
  await dialog.getByRole('button', { name: 'Add watermark' }).click();
  return { stampFontsOffered: offered, typed, picked };
});

const markdownSource = join(output, 'walk-notes.md');
const markdownPages = join(output, 'walk-notes.pdf');
await step('18. D1: Insert from Markdown at the end, its prose set in Times New Roman chosen in the insert window', async () => {
  await writeFile(markdownSource, '# Walk notes\n\nThis paragraph was inserted from Markdown.\n\n```\nlet code = 1;\n```\n');
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
  }, markdownSource);
  await saveTo(markdownPages);
  await command('Insert from Markdown…');
  await page.getByRole('button', { name: /^Font:/u }).click();
  const search = page.getByRole('combobox', { name: 'Search fonts' });
  await search.fill('Times New Roman');
  await search.press('Enter');
  await page.getByRole('button', { name: 'Choose file…' }).click();
  await expect.poll(() => existsSync(markdownPages), { timeout: 60_000 }).toBe(true);
  return { insertedFonts: await savedFonts(markdownPages) };
});

const stampedSaved = join(output, 'stamped.pdf');
await step('19. saved: step 15’s bold Times New Roman, the dashed border, the Courier New watermark and the inserted pages are in the file', async () => {
  await saveTo(stampedSaved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(stampedSaved), { timeout: 30_000 }).toBe(true);
  const words = await savedWords(stampedSaved);
  const pageFonts = await savedFonts(stampedSaved);
  // READ BACK: the panel and Ctrl+B of step 15 wrote a bold Times New Roman.
  expect(pageFonts.some((name) => /Times.*Bold/iu.test(name))).toBe(true);
  // AND STEP 16'S BOX: dashed, and bold and justified as the file's own style strings say, read by pdf-lib (N13).
  const boxes = await savedBorderStyles(stampedSaved);
  expect(boxes.some((box) => box.style === 'D' && /bold/iu.test(box.ds + box.rc) && /justify/iu.test(box.ds + box.rc))).toBe(true);
  // AND STEP 17'S WATERMARK, in the computer's Courier New rather than the built-in Courier it was set in before L3.
  expect(pageFonts.some((name) => /Courier\s*New/iu.test(name))).toBe(true);
  return {
    pageFonts,
    textBoxBorders: boxes,
    watermarkOnFirstPage: words[0]?.includes('DRAFT') ?? false,
    insertedParagraphFound: words.some((each) => each.includes('This paragraph was inserted from Markdown.')),
  };
});

/**
 * What is under a point of the window: the class of the topmost element, so a press can be told apart from one that
 * landed on something other than the page. @param {number} x @param {number} y
 */
async function underPoint(x, y) {
  return page.evaluate(
    ([px, py]) => {
      const dom = /** @type {{ elementFromPoint: (x: number, y: number) => { className: unknown } | null }} */ (Reflect.get(globalThis, 'document'));
      const found = dom.elementFromPoint(px ?? 0, py ?? 0);
      return found === null ? 'nothing' : String(found.className);
    },
    [x, y],
  );
}

/**
 * Whether a press at a point of the window lands on Add text's surface: the topmost element there, or one it sits in,
 * is the surface. @param {number} x @param {number} y
 */
async function onAddSurface(x, y) {
  return page.evaluate(
    ([px, py]) => {
      const dom = /** @type {{ elementFromPoint: (x: number, y: number) => { closest: (selector: string) => unknown } | null }} */ (
        Reflect.get(globalThis, 'document')
      );
      return dom.elementFromPoint(px ?? 0, py ?? 0)?.closest('[data-text-add-surface]') != null;
    },
    [x, y],
  );
}

const forW1 = await distinctCopy('for-w1.pdf', sample);
await step('W1: Add text at 85%, 89% and 95% down the first (turned) page, each pressed ON SCREEN, is in the saved file', async () => {
  // THE EDIT TAB FIRST: step 19 leaves the Organize tab up, and a document opened then shows its page grid with no page
  // canvas for `open` to wait on (2026-10-13, step 20's screenshot).
  await section('Edit');
  await open(forW1);
  await section('Edit');
  /** @type {Record<string, unknown>} */
  const facts = {};
  for (const down of [0.85, 0.89, 0.95]) {
    if ((await page.getByRole('button', { name: 'Add text', exact: true }).first().getAttribute('aria-pressed')) !== 'true') {
      await command('Add text');
    }
    const surface = page.locator('[data-text-add-surface]').first();
    let box = await surface.boundingBox();
    if (box === null) throw new Error('no add surface');
    // THE POINT SCROLLED INTO THE DOCUMENT AREA FIRST: a press below the window's foot, or on the status bar, is a press
    // on something that is not the page, and words typed after it go nowhere — which reads exactly like a drop.
    const viewport = page.viewportSize() ?? { width: 1400, height: 900 };
    const bottom = viewport.height - 80;
    let target = box.y + box.height * down;
    if (target > bottom) {
      await page.mouse.move(box.x + box.width / 2, 500);
      await page.mouse.wheel(0, target - 500);
      // THE SCROLL HAS ENDED: the surface's box stops moving (an 800 ms sleep stood for this).
      box = await boxSettled(page, () => surface.boundingBox());
      if (box === null) throw new Error('no add surface');
      target = box.y + box.height * down;
    }
    const x = box.x + box.width * 0.15;
    const under = await underPoint(x, target);
    const words = `W1 at ${String(Math.round(down * 100))} percent`;
    // THE TWO EXPLANATIONS TOLD APART BEFORE THE PRESS: run 3 could not say whether the walk's lost words were pressed
    // onto something that is not the page (the harness) or written and lost (the app). A press that will not land on the
    // add surface fails HERE, naming what it would have landed on.
    facts[`${String(Math.round(down * 100))}%`] = { pressedAtWindowY: Math.round(target), under };
    expect(await onAddSurface(x, target), `the ${String(Math.round(down * 100))}% press would land on "${under}", not the page`).toBe(true);
    await page.mouse.click(x, target);
    await expect(editor()).toBeFocused();
    await page.keyboard.type(words);
    await page.keyboard.press('Escape');
    await expect(editor()).toHaveCount(0);
  }
  const saved = join(output, 'w1-saved.pdf');
  await saveTo(saved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(saved), { timeout: 20_000 }).toBe(true);
  // READ BACK by PDF.js, and from the FIRST PAGE, where they were pressed. Every press landed on the page (above), so a
  // line missing here is the APP losing words, and the message names which and where the rest of the file put them.
  const pages = await savedWords(saved);
  const first = pages[0] ?? '';
  const missing = [85, 89, 95].filter((down) => !first.includes(`W1 at ${String(down)} percent`));
  const elsewhere = missing.map((down) => pages.findIndex((words) => words.includes(`W1 at ${String(down)} percent`)));
  expect({ missing, onPageIndex: elsewhere, facts }).toStrictEqual({ missing: [], onPageIndex: [], facts });
  return { ...facts, firstPageHoldsAll: true };
});

/**
 * How many rules Monstera drew and marked as a word's on a saved file's first page (`markDecorations.ts`, the owner's L2):
 * its content streams decoded by pdf-lib, and each `/MonsteraDecoration` named in them counted. @param {string} path
 */
async function savedMarkedRules(path) {
  return ((await savedContent(path)).match(/MonsteraDecoration/gu) ?? []).length;
}

const forL2 = await distinctCopy('for-l2.pdf', sample);
const l2Saved = join(output, 'l2.pdf');
await step('L2: an underlined word keeps its one underline when its block is edited again, read back from the saved file', async () => {
  await section('Edit');
  await open(forL2);
  await section('Edit');
  await ensureEditText();
  await page.locator('[data-text-block]').nth(1).click();
  await expect(editor()).toBeFocused();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Shift+ArrowRight');
  await page.keyboard.press('Control+U');
  await clickPage(10, 10);
  await expect(editor()).toHaveCount(0);
  // OPENED AGAIN: the word is read back underlined, so the editor draws it so (and a second Ctrl+U would take it off).
  await page.locator('[data-text-block]').nth(1).click();
  await expect(editor()).toBeFocused();
  const drawnUnderlined = await editor()
    .locator('.m-text-editor__run')
    .evaluateAll((runs) => runs.some((run) => (run.getAttribute('style') ?? '').includes('underline')));
  // WORDS BEFORE IT, so it moves: its rule must move with it and the old one go.
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Moved along by the walk ');
  await clickPage(10, 10);
  await expect(editor()).toHaveCount(0);
  await saveTo(l2Saved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(l2Saved), { timeout: 30_000 }).toBe(true);
  const rules = await savedMarkedRules(l2Saved);
  expect({ drawnUnderlined, rules }).toStrictEqual({ drawnUnderlined: true, rules: 1 });
  return { drawnUnderlined, markedRules: rules };
});

/**
 * L6's page: a heading drawn FIRST, then more single-character runs than one answer carries (`ENGINE_TEXT_OBJECTS_MAX`,
 * 39,100 on 2026-10-13), each on its own baseline so none joins another. The heading is first in the page's own order, so
 * it is among what is outlined.
 */
async function densePage() {
  const made = await PDFDocument.create({ updateMetadata: false });
  const font = await made.embedFont(StandardFonts.Helvetica);
  const sheet = made.addPage([612, 792]);
  sheet.drawText('Dense page heading', { x: 72, y: 740, size: 14, font });
  for (let at = 0; at < 39_200; at += 1) sheet.drawText('x', { x: 72 + (at % 400) * 1.2, y: 60 + at * 0.016, size: 0.5, font });
  const path = join(output, 'l6-dense.pdf');
  await writeFile(path, await made.save());
  return path;
}

const l6Saved = join(output, 'l6.pdf');
await step('L6: a page with more runs than one answer carries SAYS SO in Edit text, and its heading is still edited and saved', async () => {
  await section('Edit');
  await open(await densePage());
  await section('Edit');
  await ensureEditText();
  await expect(page.getByText('This page has more text than can be outlined at once')).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-text-block]').first().click();
  await expect(editor()).toBeFocused();
  await page.keyboard.press('Control+Home');
  await page.keyboard.type('Edited ');
  await clickPage(10, 10);
  await expect(editor()).toHaveCount(0);
  await saveTo(l6Saved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(l6Saved), { timeout: 60_000 }).toBe(true);
  // READ BACK by PDF.js: the edited heading is in the file.
  const words = await savedWords(l6Saved);
  expect(words[0]).toContain('Edited Dense page heading');
  return { headingSaved: true };
});

await step('N14: a word processor’s subsets keep their own font, bold and superscript while a block is open, and after it is written', async () => {
  // A PRODUCER'S PAGE, built from the bundled Carlito (`producerSubsetFixture.ts`): subset fonts with no cmap, a bold
  // lead-in and a superscript marker raised by a text rise.
  // LITERAL SPECIFIERS, so `proof:electronimports` can read what this loads.
  const { buildProducerSubsetPdf } = await import('../../packages/kernel/dist/producerSubsetFixture.js');
  const { fontsDirectory } = await import('../provision/fonts.mjs');
  const fonts = fontsDirectory(root);
  const producer = join(output, 'producer-subsets.pdf');
  await writeFile(producer, await buildProducerSubsetPdf(await readFile(join(fonts, 'Carlito-Regular.ttf')), await readFile(join(fonts, 'Carlito-Bold.ttf'))));
  await section('Edit');
  await open(producer);
  await section('Edit');
  await ensureEditText();
  const block = page.locator('[data-text-block]').first();
  const box = await block.boundingBox();
  if (box === null) throw new Error('no block on the producer page');
  await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
  await expect(editor()).toBeFocused();
  // EVERY RUN IN ITS OWN FONT, never refused and never left in its kind of face.
  const runs = editor().locator('.m-text-editor__run');
  await expect.poll(async () => runs.evaluateAll((spans) => spans.every((span) => (span.getAttribute('data-run-font') ?? '').startsWith('m-run-'))), { timeout: 15_000 }).toBe(true);
  // IN THE PAGE, where the window's own computed style is the browser's answer.
  const drawn = await runs.evaluateAll((spans) =>
    spans.map((span) => {
      const computed = span.ownerDocument.defaultView?.getComputedStyle(span);
      return { text: span.textContent, weight: computed?.fontWeight, align: computed?.verticalAlign };
    }),
  );
  const mark = drawn.find((run) => run.text === '12');
  expect(mark?.align).toMatch(/^[1-9][\d.]*px$/u);
  expect(drawn[0]?.weight).toBe('700');
  await page.keyboard.press('End');
  await page.keyboard.type(' Walked.');
  await clickPage(20, 20);
  await expect(editor()).toHaveCount(0);
  const saved = join(output, 'producer-subsets-saved.pdf');
  await saveTo(saved);
  await command('Save a copy…');
  await expect.poll(() => existsSync(saved), { timeout: 30_000 }).toBe(true);
  // READ BACK: the words, the producer's subsets still named, and the marker still raised above the line by PDF.js.
  const words = (await savedWords(saved))[0] ?? '';
  expect(words).toContain('Walked.');
  const named = await savedFonts(saved);
  expect(named.some((name) => name.endsWith('+Carlito-Bold'))).toBe(true);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(saved)), useSystemFonts: false });
  const items = (await (await (await task.promise).getPage(1)).getTextContent()).items.flatMap((item) => ('str' in item ? [item] : []));
  await task.destroy();
  const line = items.find((item) => item.str.startsWith('Results'))?.transform[5];
  const raised = items.find((item) => item.str === '12')?.transform[5];
  expect(line).toBeDefined();
  expect(raised).toBeDefined();
  const rise = (raised ?? 0) - (line ?? 0);
  expect(rise).toBeGreaterThan(3.9);
  expect(rise).toBeLessThan(4.0);
  return { drawn, savedRise: rise, fontsNamed: named };
});

// LAST, because on failure the editor stays open and nothing after it could run (measured 2026-10-12, twice in the
// walk and once on a fresh document: after the picker's keyboard choice focus is in its search box, and neither Escape
// nor a press back in the words nor a press away ends the editor).
/**
 * What the open editor is doing when it will not end (W2): whether a write is in flight (`aria-busy`, set from the moment
 * the words are sent until the write answers, every way out returning early meanwhile), where the focus is, and whether the
 * picker's list is still open. Three causes, three different readings.
 */
async function editorState() {
  // THE PAGE'S OWN DOCUMENT, by `globalThis` as `underPoint` reads it: this module's `document` is the sample's path, and
  // the scripts are checked without the DOM's types.
  return page.evaluate(() => {
    /** @typedef {{ tagName: string, getAttribute: (name: string) => string | null }} Node */
    const dom = /** @type {{ querySelector: (selector: string) => Node | null, activeElement: Node | null }} */ (
      Reflect.get(globalThis, 'document')
    );
    const words = dom.querySelector('[data-text-editor]');
    const focused = dom.activeElement;
    return {
      open: words !== null,
      busy: words?.getAttribute('aria-busy') ?? null,
      focus: focused === null ? null : `${focused.tagName.toLowerCase()}${focused.getAttribute('aria-label') === null ? '' : `[${focused.getAttribute('aria-label')}]`}`,
      listOpen: dom.querySelector('[data-text-properties] [role="listbox"]') !== null,
    };
  });
}

/**
 * One Add text box at this point of the walk, words typed, a font chosen or not, then Escape: the box's state just before
 * the key and after it. @param {string} words @param {string | undefined} family
 */
async function addThenEscape(words, family) {
  await section('Edit');
  await command('Add text');
  const surface = page.locator('[data-text-add-surface]').first();
  const box = await surface.boundingBox();
  if (box === null) throw new Error('no add surface');
  await page.mouse.click(box.x + box.width * 0.15, Math.min(box.y + box.height * 0.78, 800));
  await expect(editor()).toBeFocused();
  await page.keyboard.type(words);
  if (family !== undefined) await chooseFont(family);
  const before = await editorState();
  const started = Date.now();
  await page.keyboard.press('Escape');
  const ended = await expect(editor())
    .toHaveCount(0, { timeout: 15_000 })
    .then(() => true, () => false);
  return { before, ended, after: ended ? undefined : await editorState(), ms: Date.now() - started };
}

await step('20. W2: Add text with a font chosen in the Properties panel still ends with Escape; a box with no font first is the control', async () => {
  // THE CONTROL FIRST, AT THE SAME POINT OF THE WALK: if this box will not end either, the font is not the cause, and the
  // readings say what is (a write that never answered reads `busy: "true"`). Measured 2026-10-12: Ctrl+Z and Ctrl+Y sent
  // while an edit's write was in flight left a LATER Add text box open for good, with no font chosen.
  const control = await addThenEscape('Added with no font chosen', undefined);
  const withFont = control.ended ? await addThenEscape('Added with a font, line one', 'Times New Roman') : undefined;
  // THE SAMPLES COME FIRST in what the step reports, so a failure below still carries them (W2's evidence).
  const afterFontChoice = fontChoiceSamples.at(-1);
  expect({ control: control.ended, withFont: withFont?.ended }, JSON.stringify({ afterFontChoice })).toStrictEqual({ control: true, withFont: true });
  return { control, withFont, afterFontChoice };
});

await finish();
