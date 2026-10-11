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
 * box styled word by word while typed and set in a real font, each read back from the saved file.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from '@cantoo/pdf-lib';
import { root, startWalk } from './liveWalk.mjs';

const sample = process.argv[2] ?? join(root, '_review/test-files/sample5.pdf');
const handwritten = process.argv[3] ?? join(homedir(), 'Desktop', 'Handwritten table.pdf');
if (!existsSync(sample)) throw new Error(`No document at ${sample}. Pass the path to sample5.pdf.`);

const walk = await startWalk('text');
const { page, output, copyOf, open, saveTo, command, section, pressOn, step, finish } = walk;
const document = await copyOf(sample);

/** The words of a saved file's pages, read by PDF.js rather than by the app that wrote them. @param {string} path */
async function savedWords(path) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: false });
  const loaded = await task.promise;
  const pages = [];
  for (let at = 1; at <= loaded.numPages; at += 1) {
    const content = await (await loaded.getPage(at)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await task.destroy();
  return pages;
}

/** The fonts a saved file's pages name, by BaseFont, read by pdf-lib (`pdffonts`' question, without Poppler). @param {string} path */
async function savedFonts(path) {
  const loaded = await PDFDocument.load(await readFile(path), { updateMetadata: false, ignoreEncryption: true });
  const names = new Set();
  for (const each of loaded.getPages()) {
    const resources = each.node.Resources();
    const fonts = resources?.lookupMaybe(PDFName.of('Font'), PDFDict);
    for (const [, ref] of fonts?.entries() ?? []) {
      const font = loaded.context.lookup(ref, PDFDict);
      const base = font.lookupMaybe(PDFName.of('BaseFont'), PDFName);
      if (base !== undefined) names.add(base.decodeText());
    }
  }
  return [...names].sort();
}

/** The open editor's words. */
const editor = () => page.locator('[data-text-editor]');
/** The Properties panel's text section, while an editor is open. */
const panel = () => page.locator('[data-text-properties]');

/** Chooses `family` in the open picker of the panel's text section, by searching for it. @param {string} family */
async function chooseFont(family) {
  await panel().getByRole('button', { name: /^Font:/u }).click();
  const search = panel().getByRole('combobox', { name: 'Search fonts' });
  await search.fill(family);
  await search.press('Enter');
}

await step('1. Edit text: a click between two letters, typing, Backspace twice, Shift+Ctrl+Left, Ctrl+B lights Bold', async () => {
  await open(document);
  await section('Edit');
  await command('Edit text on the page');
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
  await page.locator('canvas.m-page').first().click({ position: { x: 20, y: 20 } });
  await expect(editor()).toHaveCount(0);
  await page.keyboard.press('Control+Z');
  await page.keyboard.press('Control+Y');
});

await step('4. Add text: two lines typed on a blank area in Times New Roman 12, kept after a click away', async () => {
  await command('Add text');
  const surface = page.locator('[data-text-add-surface]').first();
  const box = await surface.boundingBox();
  if (box === null) throw new Error('no add surface');
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.92);
  await expect(editor()).toBeFocused();
  await page.keyboard.type('Added by the walk, line one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('and line two');
  await chooseFont('Times New Roman');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.05);
  await expect(page.getByText('Added by the walk', { exact: false })).toHaveCount(0);
});

await step('5. a text box from the Comment tab: drawn, typed, Arial 11, a blue border and a light fill; Text and Box shown', async () => {
  await section('Comment');
  await command('Text box');
  const surface = page.getByLabel('Draw on page 1');
  const box = await surface.boundingBox();
  if (box === null) throw new Error('no drawing surface');
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 160, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.type('A comment in a box');
  await page.keyboard.press('Escape');
  await page.locator('[data-annotation-index]').last().click();
  const properties = page.getByRole('complementary', { name: 'Properties' });
  await expect(properties.getByRole('group', { name: 'Text' })).toBeVisible();
  await expect(properties.getByRole('group', { name: 'Box' })).toBeVisible();
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
  await page.keyboard.press('Control+Shift+S');
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

await step('7. the font picker: the document’s fonts, Recent and this computer’s by real name; "cal" finds Calibri and Cambria', async () => {
  await section('Edit');
  await command('Edit text on the page');
  await page.locator('[data-text-block]').first().click();
  await panel().getByRole('button', { name: /^Font:/u }).click();
  const groups = await panel().getByRole('listbox').getByRole('group').evaluateAll((each) => each.map((node) => node.getAttribute('aria-labelledby')));
  await panel().getByRole('combobox', { name: 'Search fonts' }).fill('cal');
  const found = await panel().locator('[data-font-choice]').evaluateAll((each) => each.map((node) => node.getAttribute('data-font-choice')));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  return { groups: groups.length, calFinds: found };
});

const cjk = await copyOf(sample);
await step('8. CJK (the owner’s check): Chinese and Japanese typed with Add text are saved as their letters, and the font is named', async () => {
  await open(cjk);
  await section('Edit');
  await command('Add text');
  const surface = page.locator('[data-text-add-surface]').first();
  const box = await surface.boundingBox();
  if (box === null) throw new Error('no add surface');
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.85);
  await page.keyboard.insertText('汉字测试 日本語のテキスト');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.05);
  const cjkSaved = join(output, 'cjk.pdf');
  await saveTo(cjkSaved);
  await page.keyboard.press('Control+Shift+S');
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
    await command('Edit text on the page');
    await page.getByRole('button', { name: /Recognise/u }).first().click();
    await expect(page.locator('[data-text-block]').first()).toBeVisible({ timeout: 120_000 });
    await pressOn(page.locator('[data-text-block]').first());
    await page.keyboard.press('End');
    await page.keyboard.type(' (walked)');
    await page.locator('canvas.m-page').first().click({ position: { x: 10, y: 10 } });
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

const formatted = await copyOf(sample);
await step('10. ADR-0228: strikethrough, a highlight, character spacing, Ctrl+J and space after on a paragraph, written once', async () => {
  await open(formatted);
  await section('Edit');
  await command('Edit text on the page');
  await page.locator('[data-text-block]').nth(1).click();
  await expect(editor()).toBeFocused();
  await page.keyboard.press('Control+Shift+ArrowRight');
  await panel().getByRole('button', { name: 'Strikethrough' }).click();
  await panel().getByRole('group', { name: 'Highlight' }).getByRole('button', { name: 'Yellow highlight' }).click();
  const spacing = panel().getByRole('spinbutton', { name: 'Character spacing in points' });
  await spacing.fill('0.5');
  await spacing.press('Enter');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+J');
  const after = panel().getByRole('spinbutton', { name: /Space after/u });
  await after.fill('6');
  await after.press('Enter');
  await page.locator('canvas.m-page').first().click({ position: { x: 10, y: 10 } });
  await expect(editor()).toHaveCount(0);
});

await step('11. K8: Tab in Edit text types a tab, the words after it move to the next stop, and the focus stays in the words', async () => {
  await page.locator('[data-text-block]').nth(2).click();
  await expect(editor()).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  await expect(editor()).toBeFocused();
  const tabbed = await editor().evaluate((element) => element.textContent?.startsWith('\t') ?? false);
  await page.locator('canvas.m-page').first().click({ position: { x: 10, y: 10 } });
  return { tabInTheWords: tabbed };
});

await step('12. B2.8: In this document lists the fonts of every page, not only the open block’s', async () => {
  await page.locator('[data-text-block]').first().click();
  await panel().getByRole('button', { name: /^Font:/u }).click();
  const group = panel().getByRole('listbox').getByRole('group', { name: 'In this document' });
  const listed = await group.locator('[data-font-choice]').evaluateAll((each) => each.map((node) => node.getAttribute('data-font-choice')));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  return { documentFonts: listed };
});

await step('13. B5.8 and K2: a text box typed with Ctrl+B mid-sentence, in Calibri from its Properties', async () => {
  await section('Comment');
  await command('Text box');
  const surface = page.getByLabel('Draw on page 1');
  const box = await surface.boundingBox();
  if (box === null) throw new Error('no drawing surface');
  await page.mouse.move(box.x + 80, box.y + 320);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 400, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.type('Plain then ');
  await page.keyboard.press('Control+B');
  await page.keyboard.type('bold');
  await page.keyboard.press('Control+B');
  await page.keyboard.type(' words');
  await page.keyboard.press('Escape');
  await page.locator('[data-annotation-index]').last().click();
  const properties = page.getByRole('complementary', { name: 'Properties' });
  await properties.getByRole('button', { name: /^Font:/u }).click();
  await properties.getByRole('combobox', { name: 'Search fonts' }).fill('Calibri');
  await properties.getByRole('combobox', { name: 'Search fonts' }).press('Enter');
});

const formattedSaved = join(output, 'formatted.pdf');
await step('14. saved: the paragraph’s words, the tab, the text box’s bold run and its embedded Calibri are in the file', async () => {
  await saveTo(formattedSaved);
  await page.keyboard.press('Control+Shift+S');
  await expect.poll(() => existsSync(formattedSaved), { timeout: 30_000 }).toBe(true);
  const boxes = await savedTextBoxes(formattedSaved);
  const walked = boxes.find((each) => each.rc.includes('bold'));
  return {
    pageFonts: await savedFonts(formattedSaved),
    textBoxBoldRun: walked?.rc.includes('font-weight:bold') ?? false,
    textBoxFonts: walked?.fonts ?? [],
  };
});

await finish();
