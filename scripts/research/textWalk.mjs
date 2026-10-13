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
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFString } from '@cantoo/pdf-lib';
import { root, startWalk } from './liveWalk.mjs';

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
 * Edit text ON, whichever way an earlier step left it: the tool is a toggle whose state travels with the window, so running
 * its command to turn it on turns it OFF when it is already on, and no words are then offered to press.
 */
async function ensureEditText() {
  const tool = page.getByRole('button', { name: 'Edit text', exact: true }).first();
  if ((await tool.getAttribute('aria-pressed')) !== 'true') await command('Edit text on the page');
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

/**
 * A press on the page at a point `x`, `y` from its top left, made with the mouse where a person makes it: the page's text
 * layer lies over the canvas and takes a press there, so a click aimed at the canvas element itself is refused as
 * intercepted, and a refusal is the walk's own, not the app's.
 * @param {number} x
 * @param {number} y
 */
async function clickPage(x, y) {
  const box = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (box === null) throw new Error('the page is not on screen');
  // THE PAGE MAY BE SCROLLED UNDER THE RIBBON, and the floating tool strip lies over its left margin (measured
  // 2026-10-12: a press at the left edge landed on one of the strip's buttons). So the press is lowered below the ribbon
  // (the document area starts at 230 px in the 1400 x 900 window) and made in the RIGHT margin, `x` from the page's edge.
  await page.mouse.click(box.x + box.width - x, Math.max(box.y, 230) + y);
}

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
  await clickPage(20, 20);
  await expect(editor()).toHaveCount(0);
  // EACH IS A COMMAND THAT REWRITES THE DOCUMENT (a write takes 3 to 5 s here, measured 2026-10-12), so the second key
  // waits for the first, as a hand does; sent together they left a later Add text editor open for good.
  await page.waitForTimeout(6000);
  await page.keyboard.press('Control+Z');
  await page.waitForTimeout(6000);
  await page.keyboard.press('Control+Y');
  await page.waitForTimeout(6000);
});

await step('4. Add text: two lines typed on a blank area, ended with Escape, and the words kept', async () => {
  await command('Add text');
  const surface = page.locator('[data-text-add-surface]').first();
  const box = await surface.boundingBox();
  if (box === null) throw new Error('no add surface');
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
  await command('Save a copy');
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
  await command('Save a copy');
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
    // THE EDIT TEXT NOTE ("This page is a picture, ...") HAS NO BUTTON: measured 2026-10-12 on this scan, in the page's own
    // flow it is a paragraph and nothing else. Recognition is Tools > Convert scan > OCR pages, whose window has the
    // Recognise button, so the walk takes that route and then edits.
    await section('Tools');
    await page.getByRole('button', { name: 'OCR pages', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(2000);
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
  // THE SPACING BOX IS DISABLED WHILE THE SIZE IS EMPTY (measured 2026-10-12 on an unedited paragraph: the size box reads
  // blank and spacing is "up to 1.2 pt either way at this size"), so a size is given first; an app finding in the report.
  const size = panel().getByRole('spinbutton', { name: 'Size in points' });
  await size.fill('12');
  await size.press('Enter');
  const spacing = panel().getByRole('spinbutton', { name: 'Character spacing in points' });
  await spacing.fill('0.5');
  await spacing.press('Enter');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+J');
  const after = panel().getByRole('spinbutton', { name: /Space after/u });
  await after.fill('6');
  await after.press('Enter');
  await clickPage(10, 10);
  await expect(editor()).toHaveCount(0);
});

await step('11. K8: Tab in Edit text types a tab, the words after it move to the next stop, and the focus stays in the words', async () => {
  await page.locator('[data-text-block]').nth(2).click();
  await expect(editor()).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  await expect(editor()).toBeFocused();
  const tabbed = await editor().evaluate((element) => element.textContent?.startsWith('\t') ?? false);
  await clickPage(10, 10);
  return { tabInTheWords: tabbed };
});

await step('12. B2.8: In this document lists the fonts of every page, not only the open block’s', async () => {
  // A BLOCK ON SCREEN: the first block is above the document area here (the page is scrolled and 180 degrees round), and a
  // click on it opens nothing; any block shows the document's fonts, so the third, which step 11 also opens, is used.
  // THE PREVIOUS STEP'S WRITE MAY STILL BE RUNNING (3 to 8 s, measured 2026-10-12), and the controls of a block wait on it.
  await page.waitForTimeout(8000);
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
  await command('Save a copy');
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
  await clickPage(20, 20);
  await expect(editor()).toHaveCount(0);
  return { editorStayedOpen: stillOpen };
});

await step('16. E4 and N13: the text box from step 13 made bold and justified in the one Text section, and dashed in Box', async () => {
  await section('Comment');
  // THE BOX IS WHERE IT WAS DRAWN ON THE PAGE, NOT ON THE SCREEN: steps since then scrolled the page, so it is scrolled
  // back by the distance the page's top has moved before the press is made.
  const now = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (now !== null && Math.abs(now.y - textBoxCanvasTop) > 1) {
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, now.y - textBoxCanvasTop);
    await page.waitForTimeout(800);
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

await step('17. D1: a watermark set in Courier, chosen in the Watermark window’s font picker', async () => {
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
  await dialog.locator('[data-font-choice="Courier"]').first().click();
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
await step('19. saved: step 15’s bold Times New Roman, the dashed border, the Courier watermark and the inserted pages are in the file', async () => {
  await saveTo(stampedSaved);
  await command('Save a copy');
  await expect.poll(() => existsSync(stampedSaved), { timeout: 30_000 }).toBe(true);
  const words = await savedWords(stampedSaved);
  const pageFonts = await savedFonts(stampedSaved);
  // READ BACK: the panel and Ctrl+B of step 15 wrote a bold Times New Roman.
  expect(pageFonts.some((name) => /Times.*Bold/iu.test(name))).toBe(true);
  // AND STEP 16'S BOX: dashed, and bold and justified as the file's own style strings say, read by pdf-lib (N13).
  const boxes = await savedBorderStyles(stampedSaved);
  expect(boxes.some((box) => box.style === 'D' && /bold/iu.test(box.ds + box.rc) && /justify/iu.test(box.ds + box.rc))).toBe(true);
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

const forW1 = await distinctCopy('for-w1.pdf', sample);
await step('W1: Add text at 85%, 89% and 95% down the first (turned) page, each pressed ON SCREEN, is in the saved file', async () => {
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
      await page.waitForTimeout(800);
      box = await surface.boundingBox();
      if (box === null) throw new Error('no add surface');
      target = box.y + box.height * down;
    }
    const x = box.x + box.width * 0.15;
    const under = await underPoint(x, target);
    const words = `W1 at ${String(Math.round(down * 100))} percent`;
    await page.mouse.click(x, target);
    await expect(editor()).toBeFocused();
    await page.keyboard.type(words);
    await page.keyboard.press('Escape');
    await expect(editor()).toHaveCount(0);
    facts[`${String(Math.round(down * 100))}%`] = { pressedAtWindowY: Math.round(target), under };
  }
  const saved = join(output, 'w1-saved.pdf');
  await saveTo(saved);
  await command('Save a copy');
  await expect.poll(() => existsSync(saved), { timeout: 20_000 }).toBe(true);
  // READ BACK by PDF.js, and from the FIRST PAGE, where they were pressed.
  const first = (await savedWords(saved))[0] ?? '';
  for (const down of [85, 89, 95]) expect(first.includes(`W1 at ${String(down)} percent`)).toBe(true);
  return { ...facts, firstPageHoldsAll: true };
});

await step('N14: a word processor’s subsets keep their own font, bold and superscript while a block is open, and after it is written', async () => {
  // A PRODUCER'S PAGE, built from the bundled Carlito (`producerSubsetFixture.ts`): subset fonts with no cmap, a bold
  // lead-in and a superscript marker raised by a text rise.
  const { buildProducerSubsetPdf } = await import(join(root, 'packages/kernel/dist/producerSubsetFixture.js'));
  const { fontsDirectory } = await import(join(root, 'scripts/provision/fonts.mjs'));
  const fonts = fontsDirectory(root);
  const producer = join(output, 'producer-subsets.pdf');
  await writeFile(producer, await buildProducerSubsetPdf(await readFile(join(fonts, 'Carlito-Regular.ttf')), await readFile(join(fonts, 'Carlito-Bold.ttf'))));
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
  await command('Save a copy');
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
  expect({ control: control.ended, withFont: withFont?.ended }).toStrictEqual({ control: true, withFont: true });
  return { control, withFont };
});

await finish();
