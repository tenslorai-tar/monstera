// @ts-check
/**
 * Edit text on a document SHAPED LIKE A DESIGN TOOL'S BROCHURE (the owner's R20 of 2026-10-21): how often an edit is
 * refused, and with what words. The owner's own brochure refused Edit object's colour change and every move; this asks
 * the same of Edit text, on a document built here — never the owner's file.
 *
 *   node scripts/research/brochureEditWalk.mjs [--pages <n>]
 *
 * ## The fixture, and what makes it a design tool's
 *
 * pdf-lib writes it, with content streams written the way a layout program writes them rather than the way pdf-lib's
 * own `drawText` does:
 *
 * - every heading and every body line is a text object of its own (`BT … ET`), placed by `Tm`;
 * - runs are set glyph by glyph in `TJ` with kerning between them, headings in a CID TrueType font under Identity-H and
 *   body text in an embedded SUBSET Type 1 font — the two kinds a layout program's export carries — each from the one
 *   font-kind builder, `fontKindFixtures.mjs`' `fontOfKind`;
 * - each text object sits in marked content (`/Span <</MCID n>> BDC … EMC`), as a tagged export's does;
 * - a coloured panel is drawn behind each heading, and pictures (image XObjects) stand beside the text in two columns;
 * - a heading is laid over a picture, one paragraph is justified (its word gaps written in `TJ`), and a pull quote is
 *   drawn inside a form XObject.
 *
 * ## What is tried, on every page
 *
 * 1. a heading's words replaced;
 * 2. a heading's colour changed (all its words, the panel's Red);
 * 3. the heading over a picture edited;
 * 4. a justified line edited;
 * 5. the pull quote in its form XObject edited;
 * 6. a body line edited (words added at its end).
 *
 * Each try is ended by the walks' one press away (`textSteps`), which answers what the editor said, if anything. The
 * record is every try with its words; the last line counts the refusals, so nothing is concluded from one.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';
import { fontOfKind } from './fontKindFixtures.mjs';
import { startWalk } from './liveWalk.mjs';
import { textSteps } from './textWalkSteps.mjs';

const argv = process.argv.slice(2);
const pagesAt = argv.indexOf('--pages');
const PAGES = pagesAt === -1 ? 3 : Number(argv[pagesAt + 1]);

const WORDS = [
  'Our community garden grows food for all.',
  'Volunteers meet on Saturday mornings.',
  'Children learn where vegetables come from.',
  'Every season ends with a shared meal.',
  'Seeds and tools are lent free of charge.',
  'The garden is open from dawn until dusk.',
];
const HEADINGS = ['Garden news', 'When we meet', 'What to bring'];

/** A design tool's brochure, built here. */
/** @param {number} pageNumber the page of the brochure this one-page document is */
async function brochure(pageNumber) {
  const document = await PDFDocument.create({ updateMetadata: false });
  const context = document.context;
  const helvetica = await document.embedFont(StandardFonts.Helvetica);
  // THE TWO KINDS a layout program's export carries, from the one builder (`fontKindFixtures.mjs`): headings in a CID
  // TrueType under Identity-H, body text in an embedded SUBSET Type 1. Each keeps only the glyphs this document sets.
  const headingText = `${HEADINGS.join('')}0123456789 ,pageHarvestGrow, share, eat together`;
  const heading = fontOfKind(document, 'type0-cidfonttype2', [...new Set(headingText)], helvetica);
  const body = fontOfKind(document, 'type1-subset', [...new Set(WORDS.join(''))], helvetica);
  // A PICTURE: 48 x 32 RGB pixels in a gradient, deflated, as an image XObject.
  const pixels = new Uint8Array(48 * 32 * 3);
  for (let at = 0; at < 48 * 32; at += 1) {
    pixels[at * 3] = (at % 48) * 5;
    pixels[at * 3 + 1] = Math.floor(at / 48) * 7;
    pixels[at * 3 + 2] = 160;
  }
  const picture = context.register(context.flateStream(pixels, { Type: 'XObject', Subtype: 'Image', Width: 48, Height: 32, ColorSpace: 'DeviceRGB', BitsPerComponent: 8 }));
  let mcid = 0;
  for (const index of [pageNumber - 1]) {
    const page = document.addPage([595, 842]);
    page.node.set(PDFName.of('Resources'), context.obj({ Font: { F1: heading.font, F2: body.font }, XObject: { Im1: picture } }));
    /** @type {string[]} */
    const content = [];
    /**
     * One text object: `text` set glyph by glyph in TJ with a kern between every pair, at (x, y), in marked content.
     * @param {'/F1' | '/F2'} name @param {(text: string) => string} show @param {number} size @param {number} x
     * @param {number} y @param {string} text @param {string} colour
     */
    const line = (name, show, size, x, y, text, colour) => {
      const runs = [...text].map((character, at) => `${show(character)}${at < text.length - 1 ? (at % 3 === 0 ? ' -12 ' : ' 8 ') : ''}`).join('');
      content.push(`/Span <</MCID ${String(mcid)}>> BDC BT ${colour} rg ${name} ${String(size)} Tf 1 0 0 1 ${String(x)} ${String(y)} Tm [${runs}] TJ ET EMC`);
      mcid += 1;
    };
    // THE HEADING, on a coloured panel.
    content.push('q 0.86 0.93 0.88 rg 40 742 515 56 re f Q');
    line('/F1', heading.show, 26, 52, 760, `${HEADINGS[0] ?? ''}, page ${String(index + 1)}`, '0.1 0.35 0.25');
    // TWO COLUMNS of body lines beside two pictures, each under a subheading; the first picture carries a heading laid
    // OVER it, as a cover's does.
    for (const [column, left] of /** @type {[number, number][]} */ ([[0, 52], [1, 310]])) {
      content.push(`q 230 0 0 150 ${String(left)} 560 cm /Im1 Do Q`);
      if (column === 0) line('/F1', heading.show, 20, left + 12, 600, 'Harvest 2026', '1 1 1');
      line('/F1', heading.show, 16, left, 520, HEADINGS[column + 1] ?? '', '0.6 0.2 0.1');
      for (const [at, text] of WORDS.entries()) line('/F2', body.show, 11, left, 496 - at * 18, text, '0.15 0.15 0.15');
    }
    // A JUSTIFIED PARAGRAPH, as a layout program sets one: the words of a line in one TJ, the space between them widened
    // by an adjustment rather than a space glyph, with a character spacing, one text object per line. (Each word placed by
    // its own `14 0 Td` overlapped the next — Td moves from a word's START — which was this fixture's fault, 2026-10-21.)
    for (const [at, text] of WORDS.slice(0, 3).entries()) {
      const placed = text
        .split(' ')
        .map((word) => body.show(word))
        .join(' -420 ');
      content.push(`/Span <</MCID ${String(mcid)}>> BDC BT 0.2 0.2 0.2 rg /F2 10 Tf 0.3 Tc 1 0 0 1 52 ${String(330 - at * 16)} Tm [${placed}] TJ ET EMC`);
      mcid += 1;
    }
    // A PULL QUOTE in a form XObject, drawn by Do: text a layout program keeps in a group of its own.
    const quote = context.register(
      context.flateStream(`BT 0.1 0.35 0.25 rg /F1 14 Tf 0 0 Td ${heading.show('Grow, share, eat together')} Tj ET`, {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, -4, 260, 18],
        Resources: { Font: { F1: heading.font } },
      }),
    );
    page.node.set(PDFName.of('Resources'), context.obj({ Font: { F1: heading.font, F2: body.font }, XObject: { Im1: picture, Fm1: quote } }));
    content.push('q 1 0 0 1 310 320 cm /Fm1 Do Q');
    page.node.set(PDFName.of('Contents'), context.register(context.flateStream(content.join('\n'))));
  }
  return document.save({ useObjectStreams: false });
}

const walk = await startWalk('brochureEdit');
const { page, output, section, step, finish } = walk;
const text = textSteps(walk);

/** @type {{ page: number, try: string, said: string[] }[]} */
const tries = [];

/**
 * Opens the block of words at (x, y) in PDF points from the page's top left: a press there with Edit text on, and the
 * editor waited for. Aimed by place rather than by order, so each try is on the object it names.
 * @param {number} x @param {number} y
 */
async function openAt(x, y) {
  const box = await page.locator('canvas.m-page:visible').first().boundingBox();
  if (box === null) throw new Error('the page is not on screen');
  const scale = box.width / 595;
  const point = { x: box.x + x * scale, y: box.y + y * scale };
  // THE BLOCK THAT HOLDS THE POINT, pressed as a block: a bare press at the point opened nothing while a stale editor
  // element satisfied the wait (the 3-page run of 2026-10-21, every heading unchanged and "Saved").
  const blocks = page.locator('[data-text-edit-layer]:visible [data-text-block]');
  await blocks.first().waitFor({ timeout: 60_000 });
  for (let at = 0; at < (await blocks.count()); at += 1) {
    const area = await blocks.nth(at).boundingBox();
    if (area === null || point.x < area.x || point.x > area.x + area.width || point.y < area.y || point.y > area.y + area.height) continue;
    await blocks.nth(at).click();
    await text.editor().first().waitFor({ state: 'visible', timeout: 30_000 });
    return;
  }
  throw new Error(`no block of words holds the point (${String(x)}, ${String(y)}) on the page`);
}

/** @param {number} pageNumber @param {string} name @param {() => Promise<void>} edit */
async function attempt(pageNumber, name, edit) {
  await step(`page ${String(pageNumber)}: ${name}`, async () => {
    await text.ensureEditText();
    await edit();
    try {
      const said = await text.pressAway();
      tries.push({ page: pageNumber, try: name, said });
      return { said };
    } catch (error) {
      // AN EDIT THAT NEITHER ENDED NOR SAID WHY in 120 s: what the editor and the writes were doing then, so the record
      // says whether it hung, was busy, or was never what the press took.
      const editors = text.editor();
      const state = {
        editors: await editors.count(),
        busy: (await editors.count()) > 0 ? await editors.first().getAttribute('aria-busy') : null,
        words: (await editors.count()) > 0 ? ((await editors.first().textContent()) ?? '').slice(0, 80) : null,
        writesInFlight: await page.locator('html').getAttribute('data-writes'),
        problems: await text.problems(),
      };
      tries.push({ page: pageNumber, try: name, said: [`NOT ENDED: ${JSON.stringify(state)}`] });
      throw new Error(`the edit neither ended nor said why: ${JSON.stringify(state)}`, { cause: error });
    }
  });
}

// EACH PAGE ITS OWN DOCUMENT, opened in turn: the walk then needs no page navigation, and every try starts on a page no
// earlier try has changed.
for (let pageNumber = 1; pageNumber <= PAGES; pageNumber += 1) {
  const path = join(output, `brochure-${String(pageNumber)}.pdf`);
  await writeFile(path, await brochure(pageNumber));
  await walk.open(path);
  await section('Edit');
  await attempt(pageNumber, 'replace a heading’s words', async () => {
    await openAt(120, 70);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Summer at the garden');
  });
  await attempt(pageNumber, 'change a heading’s colour', async () => {
    await openAt(120, 70);
    await page.keyboard.press('Control+A');
    await text.panel().getByRole('button', { name: 'Red', exact: true }).first().click();
  });
  await attempt(pageNumber, 'edit a heading laid over a picture', async () => {
    await openAt(90, 234);
    await page.keyboard.press('End');
    await page.keyboard.type(' festival');
  });
  // THE JUSTIFIED LINE AND THE QUOTE BEFORE THE BODY LINE: a body line that grows pushes the paragraphs below it down
  // (ADR-0249), and the justified one was then no longer where the press aimed (run of 2026-10-21).
  await attempt(pageNumber, 'edit a justified line', async () => {
    await openAt(100, 507);
    await page.keyboard.press('End');
    await page.keyboard.type(' now');
  });
  await attempt(pageNumber, 'edit the pull quote in its form XObject', async () => {
    await openAt(340, 516);
    await page.keyboard.press('End');
    await page.keyboard.type(' again');
  });
  await attempt(pageNumber, 'add words to a body line', async () => {
    await openAt(100, 342);
    await page.keyboard.press('End');
    await page.keyboard.type(' too');
  });
}

const refused = tries.filter((each) => each.said.length > 0);
await writeFile(join(output, 'tries.json'), `${JSON.stringify({ pages: PAGES, tries }, null, 2)}\n`);
process.stdout.write(`\nBROCHURE: ${String(refused.length)} of ${String(tries.length)} edits were refused or warned\n`);
for (const each of refused) process.stdout.write(`  page ${String(each.page)}, ${each.try}: ${each.said.join(' / ')}\n`);
await finish();
