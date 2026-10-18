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
import { root, startWalk, writesDone, writesIdle } from './liveWalk.mjs';
import { savedContent, savedFonts, savedTextKeepingSpaces, savedWords } from './savedPdf.mjs';
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
const { editor, panel, ensureEditText, pressAway, problems, chooseFont, savedCopy } = textSteps(walk);

// LITERAL SPECIFIERS, so `proof:electronimports` can read what this loads.
const { buildProducerSubsetPdf, PRODUCER_MARK } = await import('../../packages/kernel/dist/producerSubsetFixture.js');
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

/** Ends the editor with a press away, and requires that it ended with nothing refused. */
async function commit() {
  // SETTLED FIRST, then what the editor says (`pressAway`, the walks' one rule).
  const said = await pressAway();
  expect(said, 'the editor refused or warned at the press away').toStrictEqual([]);
  await expect(editor()).toHaveCount(0);
}

/**
 * Each run of the open editor: its words, whether it is drawn in a face the editor loaded from the page (`data-run-font`
 * naming one, and the browser's own `fonts.check` answering that the family is loaded), and the computed family and
 * weight its WORDS are drawn in.
 *
 * READ FROM EACH TEXT NODE'S OWN ELEMENT, never from the run span alone: a family chosen in Properties is applied by
 * `formatRange` as a formatting span INSIDE the run, so the run span's computed family stays the run's own while its
 * words are drawn in the choice (2026-10-16: step 7 reported Times New Roman for every run while the open editor had
 * re-wrapped narrower in Georgia). A run whose words are drawn in two families reports both, joined by " + ".
 */
async function runsDrawn() {
  return editor()
    .locator('.m-text-editor__run')
    .evaluateAll((spans) =>
      spans.map((span) => {
        const view = span.ownerDocument.defaultView;
        /** @param {typeof span} element */
        const firstFamily = (element) => (view?.getComputedStyle(element).fontFamily ?? '').split(',')[0]?.trim().replaceAll('"', '') ?? '';
        const walker = span.ownerDocument.createTreeWalker(span, 4);
        const families = new Set();
        let weight = '';
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (parent === null || (node.textContent ?? '') === '') continue;
          families.add(firstFamily(parent));
          weight ||= view?.getComputedStyle(parent).fontWeight ?? '';
        }
        const family = families.size === 0 ? firstFamily(span) : [...families].join(' + ');
        return {
          text: span.textContent ?? '',
          runFont: span.getAttribute('data-run-font'),
          family,
          loaded: family !== '' && !family.includes(' + ') && span.ownerDocument.fonts.check(`12px "${family}"`),
          weight: weight || (view?.getComputedStyle(span).fontWeight ?? ''),
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

/**
 * The distinct baselines the paragraph's words sit on in a saved file. NOT the small print's or the label's, which share
 * a word with it ("the"): read apart by their own words first, so a line below the paragraph is never counted as one of it.
 * @param {string} path
 */
async function paragraphBaselines(path) {
  const words = new Set(EVERYDAY.lines.join(' ').split(' '));
  const items = (await savedItems(path)).filter((item) => !item.str.startsWith(EVERYDAY.below.slice(0, 11)) && !item.str.startsWith(EVERYDAY.label));
  return [...new Set(items.filter((item) => item.str.split(/\s+/u).some((word) => words.has(word))).map((item) => item.y))].sort((a, b) => b - a);
}

/** The small print's baseline in a saved file, or `undefined` where no item begins with its words. @param {string} path */
async function smallPrintBaseline(path) {
  return (await savedItems(path)).find((item) => item.str.startsWith(EVERYDAY.below.slice(0, 11)))?.y;
}

await step('1. a serif page with a bold lead-in keeps its look while the block is open, and after an edit', async () => {
  // OPENED FIRST: the start screen has no Sections rail, so a section chosen before a document is open waits 30 s for a
  // control that is not there (2026-10-15 screenshot of this step: the start screen, "Nothing opened yet").
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
  // THE SUPERSCRIPT IS IN THE SENTENCE: the fixture's line is "...every sample", the raised PRODUCER_MARK, then " tested.",
  // so four Backspaces leave the mark before "tes" and a reader reports it there, with the gap its rise puts around it.
  const words = ((await savedWords(await savedCopy('02-deleted.pdf')))[0] ?? '').trim();
  expect(words.replaceAll(/\s+/gu, ' ').endsWith(`sample ${PRODUCER_MARK} tes`), words).toBe(true);
  return { words };
});

await step('3. typing letters the font has: no refusal, the words saved', async () => {
  await openBlock('Results.');
  await page.keyboard.type(' test');
  expect(await problems()).toStrictEqual([]);
  await commit();
  const words = (await savedWords(await savedCopy('03-typed.pdf')))[0] ?? '';
  expect(words.replaceAll(/\s+/gu, ' ')).toContain(`sample ${PRODUCER_MARK} tes test`);
  return { words };
});

await step('4. Enter breaks a line where it is pressed, and the break is saved', async () => {
  await open(everyday);
  await section('Edit');
  await openBlock('Every walk step');
  await page.keyboard.press('Control+Home');
  for (let at = 0; at < 3; at += 1) await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.press('Enter');
  // THE TEXT BELOW, SHOWN MOVED BEFORE THE WRITE (ADR-0249 Decision 5): the break makes the paragraph a line longer in the
  // editor, and the two blocks under it in its column, the small print and the form's label, are drawn that much lower
  // while it is open, with nothing said, as the page has room.
  const shownPush = async () => ({
    pushed: await page.locator('[data-text-pushed]').count(),
    crowded: await page.locator('[data-text-edit-crowded]').count(),
    height: await editor().evaluate((root) => Number(Reflect.get(root, 'offsetHeight') ?? -1)),
  });
  await expect.poll(async () => JSON.stringify(await shownPush()), { timeout: 10_000 }).toContain('"pushed":2');
  expect((await shownPush()).crowded).toBe(0);
  // WHERE THE SMALL PRINT WAS: the page as built, which this tab opened unchanged (a copy saved now would end the editor).
  const smallBefore = await smallPrintBaseline(everyday);
  await commit();
  const saved = await savedCopy('04-enter.pdf');
  const items = await savedItems(saved);
  const first = items.find((item) => item.str.includes('Every walk'));
  const second = items.find((item) => item.str.includes('reads its'));
  expect(first, JSON.stringify(items)).toBeDefined();
  expect(second, JSON.stringify(items)).toBeDefined();
  // ON TWO LINES: the second line's baseline below the first's.
  expect(second?.y ?? 0).toBeLessThan((first?.y ?? 0) - 1);
  // AND WRITTEN AS SHOWN (ADR-0249): the small print one line, 14.4 points, lower in the saved file.
  const smallAfter = await smallPrintBaseline(saved);
  expect(Math.abs((smallBefore ?? 0) - (smallAfter ?? 0) - 14.4), JSON.stringify({ smallBefore, smallAfter })).toBeLessThanOrEqual(0.2);
  return { first, second, smallBefore, smallAfter };
});

await step('5. two spaces typed stay two spaces, on screen and in the saved file', async () => {
  // A FRESH COPY OF THE PAGE, not the one step 4 broke a line in: this step's subject is two spaces surviving a save and
  // a reopen, on the page as built.
  const fresh = join(output, 'everyday-spaces.pdf');
  await writeFile(fresh, await readFile(everyday));
  await open(fresh);
  await section('Edit');
  await openBlock('Every walk step');
  await page.keyboard.type(' two  spaces');
  expect(await editor().innerText()).toContain('two  spaces');
  await commit();
  // READ KEEPING EVERY SPACE: PDF.js's page text emits one space for any run of them, so `savedWords` reads "two spaces"
  // from a file holding two whatever was written (measured 2026-10-16 on this step's own saved file).
  const words = await savedTextKeepingSpaces(await savedCopy('05-spaces.pdf'));
  expect(words).toMatch(/two {2}spaces/u);
  // ON REOPENING, still two. WHAT THE PAGE OFFERS TO EDIT is recorded first, and a reopen that shows the words without the
  // edit is not ended with a press away — that would write the older words over the edit — but with the editor's words
  // left as they are and a second reopen after the writes are idle, so the record says whether the read lagged or was wrong.
  const offered = await page.locator('[data-text-block]').evaluateAll((blocks) => blocks.map((each) => each.getAttribute('aria-label') ?? ''));
  // THE BLOCK THAT HOLDS THE TYPED WORDS, by its outline's label where the label shows them. Until ADR-0249 they wrapped
  // onto a line over the small print and were read as the start of its block; the small print now moves down, so they
  // are the paragraph's, whose label is cut before them.
  const holding = offered.find((label) => label.includes('two spaces'))?.match(/^Edit “(.{1,20})/u)?.[1];
  await openBlock(holding ?? 'Every walk step');
  const shown = await editor().innerText();
  if (!shown.includes('two  spaces')) {
    // ENDED AS THE HARNESS ENDS A FAILED STEP, then measured: whether ending it wrote the older words over the edit, and
    // what a reopen shows once every write is idle.
    const writing = await writesDone(page);
    await page.keyboard.press('Escape');
    await expect(editor()).toHaveCount(0);
    await writesIdle(page);
    const wroteOnEnd = (await writesDone(page)) - writing;
    const kept = (await savedTextKeepingSpaces(await savedCopy('05-after-reopen.pdf'))).includes('two  spaces');
    await page.waitForTimeout(2000);
    await openBlock(holding ?? 'Every walk step');
    const later = await editor().innerText();
    throw new Error(`the reopened editor did not hold the edit: ${JSON.stringify({ offered, shown, wroteOnEnd, kept, later })}`);
  }
  await commit();
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
  const beforeFile = await savedCopy('07-before.pdf');
  const before = await paragraphBaselines(beforeFile);
  const smallBefore = await smallPrintBaseline(beforeFile);
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
  // ITS LINES KEPT (A4): no line it had is lost. A wider face may wrap it onto one more, which until ADR-0249 drew that
  // line over the small print, so this asked for the same count; the text below now moves down instead, asserted next.
  const after = await paragraphBaselines(saved);
  expect(after.length, JSON.stringify({ before, after })).toBeGreaterThanOrEqual(before.length);
  // NOTHING COVERED (ADR-0249): the small print stands as far below the paragraph's last line as it did, within a point.
  const smallAfter = await smallPrintBaseline(saved);
  const gapBefore = (before.at(-1) ?? 0) - (smallBefore ?? 0);
  const gapAfter = (after.at(-1) ?? 0) - (smallAfter ?? 0);
  expect(smallBefore !== undefined && smallAfter !== undefined, 'the small print was read before and after').toBe(true);
  expect(gapAfter, JSON.stringify({ before, after, smallBefore, smallAfter })).toBeGreaterThanOrEqual(gapBefore - 1);
  return { before, after, smallBefore, smallAfter, samples };
});

await step('7b. every family the font picker lists is drawn in itself, not in the browser’s default (A3)', async () => {
  // THE INSTRUMENT FOR A3: the picker and the editor draw a family by its CSS name, and a name the system does not
  // resolve falls to the browser's default face (Times New Roman on Windows) with nothing said. Each listed name is
  // measured by canvas against two different fallbacks: a name that resolves draws the same width after either, a
  // name that does not draws as each fallback does. Its positive control is Arial, which every Windows has. Expected
  // to fail today, naming at least the bundled families (Carlito, Tinos and the rest): the renderer registers no face
  // for them, so it draws them by a name the system does not have (read 2026-10-14, `app.css` declares Marcellus alone).
  await openBlock('Every walk step');
  await panel().getByRole('button', { name: /^Font:/u }).click();
  // EVERY OPTION AS THE PAGE DRAWS IT (ADR-0250): its name, the family its span is drawn in (a stand-in for a standard
  // font's name, *Times-Roman* in Tinos), whether it is marked as not previewed, and the group it sits in. Read once no
  // face is still loading: the bundled faces arrive after the list, and step 7's picker asked for the list already.
  await page.waitForFunction(() => Reflect.get(globalThis, 'document').fonts.status === 'loaded', undefined, { timeout: 30_000 });
  const options = await page.locator('[data-font-picker] [role="option"] span').evaluateAll((spans) =>
    spans.map((span) => ({
      name: span.textContent ?? '',
      family: (span.ownerDocument.defaultView?.getComputedStyle(span).fontFamily ?? '').split(',')[0]?.trim().replaceAll('"', '') ?? '',
      none: span.hasAttribute('data-font-preview'),
      group: span.closest('[role="group"]')?.querySelector('[role="presentation"]')?.textContent ?? '',
    })),
  );
  await page.keyboard.press('Escape');
  await commit();
  const unresolved = await page.evaluate((drawn) => {
    const canvas = Reflect.get(globalThis, 'document').createElement('canvas');
    const context = canvas.getContext('2d');
    /** @param {string} font */
    const width = (font) => {
      context.font = font;
      return context.measureText('Findings 0123 WMiq').width;
    };
    return drawn
      .filter((option) => !option.none)
      .filter((option) => {
        const serif = width(`40px "${option.family}", serif`);
        const mono = width(`40px "${option.family}", monospace`);
        return serif === width('40px serif') && mono === width('40px monospace');
      })
      .map((option) => option.name);
  }, options);
  const names = options.map((option) => option.name);
  // NOT PREVIEWED ONLY UNDER *In this document* (the owner's locked decision 6): a family from this computer or bundled
  // with Monstera is always drawn in itself.
  const notPreviewed = options.filter((option) => option.none);
  expect(names.length, 'the picker listed no family, so the instrument saw nothing').toBeGreaterThan(0);
  expect(names, 'Arial is the positive control and the picker lists it').toContain('Arial');
  expect(unresolved, 'Arial is the positive control and resolves').not.toContain('Arial');
  expect(unresolved, `families drawn in the browser's default: ${unresolved.join(', ')}`).toStrictEqual([]);
  expect(notPreviewed.filter((option) => option.group !== 'In this document'), JSON.stringify(notPreviewed)).toStrictEqual([]);
  return { listed: names.length, unresolved, notPreviewed: notPreviewed.map((option) => option.name) };
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
  // THE SERIF PAGE AS STEP 3 SAVED IT: words this app wrote are now part of the page the editor opens. Its own saved copy,
  // by name: a copy of the tab on show here was the everyday page steps 4 to 8 left on show, which has no "Results." line.
  await open(join(output, '03-typed.pdf'));
  await section('Edit');
  await openBlock('Results.');
  await page.keyboard.press('Backspace');
  expect(await problems()).toStrictEqual([]);
  await commit();
  // THE RAISED MARK STAYS IN THE SENTENCE, as steps 2 and 3 read it: "...sample", the mark, "tes tes".
  const words = ((await savedWords(await savedCopy('09-second.pdf')))[0] ?? '').trim();
  expect(words.replaceAll(/\s+/gu, ' ').endsWith(`sample ${PRODUCER_MARK} tes tes`), words).toBe(true);
  return { words };
});

await step('10. a block with a line just below: the open editor keeps the page’s line spacing and does not cover it', async () => {
  // A FRESH COPY OF THE PAGE, as step 5's: `everyday.pdf` is still open in the tab steps 4 to 8 edited, so opening it again
  // shows that tab, whose paragraph a wider face and an added line have made taller. This step is about the page as built.
  const fresh = join(output, 'everyday-fresh.pdf');
  await writeFile(fresh, await readFile(everyday));
  await open(fresh);
  await section('Edit');
  await ensureEditText();
  const below = await block(EVERYDAY.below.slice(0, 15)).boundingBox();
  const outline = await openBlock('Every walk step');
  const shown = await editor().boundingBox();
  // THE LINE SPACING THE EDITOR DRAWS AT, and the page's at the scale it is drawn: the paragraph's baselines are 14.4
  // points apart on a 792-point page.
  const lineHeight = await editor().evaluate((root) => Number.parseFloat(root.ownerDocument.defaultView?.getComputedStyle(root).lineHeight ?? ''));
  const paper = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (below === null || shown === null || paper === null) throw new Error('no box for the editor, the line below or the page');
  const pitch = (14.4 * paper.height) / 792;
  await commit();
  // ABOVE THE LINE BELOW IT (A5): the editor ends no lower than the small print begins.
  expect(shown.y + shown.height, JSON.stringify({ shown, below })).toBeLessThanOrEqual(below.y + 1);
  // AT THE PAGE'S LINE SPACING (A5), three lines of it. Read as the spacing itself: this compared the editor's height with
  // the outline's until 2026-10-16, and the outline is the words' ink, a descender short of three line boxes (39.1 against
  // 43.2 at 100 %), so it could not pass for an editor at the right spacing; it had never run, every run stopping at the
  // line above it until the small print stopped being covered (ADR-0249).
  expect(Math.abs(lineHeight - pitch), JSON.stringify({ lineHeight, pitch })).toBeLessThanOrEqual(0.5);
  expect(Math.abs(shown.height - 3 * pitch), JSON.stringify({ shown, pitch })).toBeLessThanOrEqual(1);
  return { outline, shown, below, lineHeight, pitch };
});

await step('11. a one-line form label stays one line, at the label’s place, while it is edited', async () => {
  const label = await openBlock(EVERYDAY.label);
  const shown = await editor().boundingBox();
  if (shown === null) throw new Error('no box for the editor');
  // AT THE LABEL'S PLACE (A7: measured 4 to 5 px low), BASELINE AGAINST BASELINE. The editor's box is a line box, whose
  // top is the font's whole ascent above the baseline, and the label's outline is its words' own box, about a capital's
  // height above it; their tops differ by about (0.905 - 0.716) of the size for Arial however well the words sit, which
  // is the 1.83 px this read until 2026-10-16. So the editor's baseline is read from its first character (its box's top
  // plus the face's own ascent, measured by the canvas in the same font) and the label's from the page: its baseline is
  // y 560 on a 792-point page, drawn at the canvas's scale.
  const paper = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (paper === null) throw new Error('the page is not on screen');
  const labelBaseline = paper.y + ((792 - 560) * paper.height) / 792;
  const editorBaseline = await editor().evaluate((root) => {
    const walker = root.ownerDocument.createTreeWalker(root, 4);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      if (text.trim() === '' || node.parentElement === null) continue;
      const at = text.search(/\S/u);
      const range = root.ownerDocument.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 1);
      const box = range.getBoundingClientRect();
      const pen = root.ownerDocument.createElement('canvas').getContext('2d');
      if (pen === null) return null;
      pen.font = root.ownerDocument.defaultView?.getComputedStyle(node.parentElement).font ?? '';
      return box.top + pen.measureText(text.charAt(at)).fontBoundingBoxAscent;
    }
    return null;
  });
  if (editorBaseline === null) throw new Error('the editor holds no character to read a baseline from');
  expect(Math.abs(editorBaseline - labelBaseline), JSON.stringify({ editorBaseline, labelBaseline, shown, label })).toBeLessThanOrEqual(1.5);
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
