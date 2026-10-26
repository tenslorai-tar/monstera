// @ts-check
/**
 * The catalogue of difficult pages for Edit text (`scripts/research/editCatalogue.mjs`) is what it claims, and the check
 * a later test runs after an edit (`scripts/lib/editExpectations.mjs`) passes a correct edit and fails every damaged one.
 *
 * ## The catalogue
 *
 * - READ BACK: every block of every page reads, through MuPDF and through PDFium's reading (the editor's), as the words
 *   the manifest gives it, where it says the block is.
 * - DRAWN: every character of a visible block draws something, and none of an invisible one does — the same instrument
 *   the check judges an unseen word by, so this is its positive and its negative control.
 * - THE SHAPE: what each file claims to test is in the file, read back with pdf-lib: the font kinds, the drawn fonts,
 *   the word spacing, the rise and the link, the three bullets, the form placed twice and nested, the clips, the
 *   rotation, the picture, the marked content and structure tree, the crop box and turn, the invisible layer, the
 *   absent ToUnicode, the five hundred pages.
 *
 * ## The threshold
 *
 * - ROUND TRIP: every page saved again by MuPDF's writer with no change is drawn to the same pixels, so a pixel that
 *   differs at all is a change and no level tolerance is needed.
 * - ANTI-ALIASING SPREAD: each block drawn and the page drawn without it, and the farthest changed pixel from the
 *   block's character boxes, over every block; `MARGIN` must hold it and be no more than half a point wider.
 *
 * ## The check, on every page
 *
 * - The correct edit passes, and so does the same edit grown by a line, which overlaps what is below.
 * - CONTROLS, each the correct edit with one damage, each made by the same generator: a neighbour moved half a point;
 *   a word missing; the new word invisible; the new word in a drawn font; the edit unseen (the bytes unchanged); the
 *   write refused; a defect logged; a drawing outside the block removed. Each must fail, for its own reason.
 *
 * Usage: node scripts/proofs/editCatalogue.proof.mjs [--require-engines] [--shape <id>]
 */
import { existsSync } from 'node:fs';

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';

import { EDIT_CATALOGUE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { MARGIN, expectEdit, inkedCharacters, readBlock } from '../lib/editExpectations.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { bindNativeEngine } from '../lib/nativeEngine.mjs';
import { charactersOf, compare, render, SCALE } from '../lib/pageDisturbance.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { SHAPES } from '../research/editCatalogue.mjs';

const ROOT = repoRoot();
const REQUIRED = process.argv.includes('--require-engines');
const ONLY = process.argv.includes('--shape') ? process.argv[process.argv.indexOf('--shape') + 1] : undefined;

const CASES = [
  'THE CATALOGUE: 24 shapes, each built by its generator',
  'READ BACK: every block of every page reads, by MuPDF and by PDFium, as the manifest’s words where it says',
  'DRAWN: every character of a visible block draws, and none of an invisible one (the unseen check’s two controls)',
  'THE SHAPE: what each file claims to test is in the file, read back with pdf-lib',
  'ROUND TRIP: every page saved again with no change draws the same pixels, so no level tolerance is needed',
  'ANTI-ALIASING SPREAD: the farthest pixel of any block outside its character boxes is MARGIN, measured to the device pixel (wider or narrower fails)',
  'THE CORRECT EDIT passes the check on every page',
  'THE EDIT GROWN BY A LINE, overlapping what is below, passes the check on every page',
  'CONTROL: a neighbour moved half a point fails the check, as moved by MuPDF’s characters, by PDFium’s runs and by the pixels, each',
  'CONTROL: a word missing from the edit fails the check, as read back wrongly by both engines',
  'CONTROL: the new word invisible fails the check, as unseen words (every page whose block shows its words, the scan’s included)',
  'CONTROL: the new word in a drawn (Type 3) font fails the check, as a drawn font for new words',
  'CONTROL: an edit that changed nothing fails the check, as unseen',
  'CONTROL: a refused write and a logged defect each fail the check, as refused and as logged',
  'CONTROL: a drawing outside the block removed fails the check, as a drawing changed and as pixels changed',
  'CONTROL: the edited block set above its own top fails the check, as outside its column (every page)',
  'CONTROL: the link removed fails the check, as a link changed (the page with a link)',
  'CONTROL: on the scan, a cover under a word the edit kept fails the check, as a kept word covered (ADR-0187)',
];

// ------------------------------------------------------------------------------------------------- the file's shape

/**
 * A page's fonts (its own and its forms'), its content with its forms' content, and the entries the claims read.
 * @param {Uint8Array} bytes @param {number} index
 */
async function structureOf(bytes, index) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const page = doc.getPage(index);
  const context = doc.context;
  /** @param {unknown} value */
  const resolved = (value) => (value === undefined ? undefined : context.lookup(/** @type {any} */ (value)));
  /** @type {{ subtype: string, base: string, file: string, toUnicode: boolean, encoding: string }[]} */
  const fonts = [];
  /** @type {string[]} */
  const contents = [];
  let forms = 0;
  let nested = 0;
  let images = 0;
  /** @param {any} stream */
  const textOf = (stream) => Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1');
  /** @param {any} resources @param {number} depth */
  const walk = (resources, depth) => {
    if (!(resources instanceof PDFDict)) return;
    const fontDict = resolved(resources.get(PDFName.of('Font')));
    if (fontDict instanceof PDFDict) {
      for (const [, ref] of fontDict.entries()) {
        const font = /** @type {PDFDict} */ (resolved(ref));
        const name = (/** @type {string} */ key, /** @type {PDFDict} */ from = font) => String(resolved(from.get(PDFName.of(key))) ?? '').replace(/^\//u, '');
        const descendant = resolved(/** @type {PDFArray | undefined} */ (resolved(font.get(PDFName.of('DescendantFonts'))))?.get(0));
        const holder = descendant instanceof PDFDict ? descendant : font;
        const descriptor = resolved(holder.get(PDFName.of('FontDescriptor')));
        let file = 'none';
        if (descriptor instanceof PDFDict) {
          for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
            const stream = resolved(descriptor.get(PDFName.of(key)));
            if (stream instanceof PDFRawStream) file = key === 'FontFile3' ? `${key}/${name('Subtype', stream.dict)}` : key;
          }
        }
        fonts.push({
          subtype: descendant instanceof PDFDict ? `Type0/${name('Subtype', descendant)}` : name('Subtype'),
          base: name('BaseFont'),
          file,
          toUnicode: font.has(PDFName.of('ToUnicode')),
          encoding: name('Encoding'),
        });
      }
    }
    const xobjects = resolved(resources.get(PDFName.of('XObject')));
    if (xobjects instanceof PDFDict) {
      for (const [, ref] of xobjects.entries()) {
        const xobject = resolved(ref);
        if (!(xobject instanceof PDFRawStream)) continue;
        const subtype = String(xobject.dict.get(PDFName.of('Subtype')));
        if (subtype === '/Image') images += 1;
        if (subtype !== '/Form') continue;
        forms += 1;
        if (depth > 0) nested += 1;
        contents.push(textOf(xobject));
        walk(resolved(xobject.dict.get(PDFName.of('Resources'))), depth + 1);
      }
    }
  };
  walk(resolved(page.node.get(PDFName.of('Resources'))), 0);
  const own = resolved(page.node.get(PDFName.of('Contents')));
  const content = [own instanceof PDFRawStream ? textOf(own) : '', ...contents].join('\n');
  const annots = resolved(page.node.get(PDFName.of('Annots')));
  const crop = resolved(page.node.get(PDFName.of('CropBox')));
  const rotate = resolved(page.node.get(PDFName.of('Rotate')));
  return {
    fonts,
    content,
    pageContent: own instanceof PDFRawStream ? textOf(own) : '',
    forms,
    nested,
    images,
    links: annots instanceof PDFArray ? annots.asArray().filter((each) => String(/** @type {PDFDict} */ (resolved(each)).get(PDFName.of('Subtype'))) === '/Link').length : 0,
    crop: crop instanceof PDFArray ? crop.asArray().map((each) => /** @type {PDFNumber} */ (each).asNumber()) : null,
    rotate: rotate instanceof PDFNumber ? rotate.asNumber() : 0,
    tagged: doc.catalog.has(PDFName.of('StructTreeRoot')),
    pages: doc.getPageCount(),
  };
}

/** How many times `pattern` occurs in `text`. @param {string} text @param {RegExp} pattern */
const count = (text, pattern) => (text.match(pattern) ?? []).length;

/**
 * What each file claims, as a list of [claim, held]. A claim that cannot be read from the file is not a claim.
 * @type {Record<string, (s: Awaited<ReturnType<typeof structureOf>>, built: import('../research/editCatalogue.mjs').Built) => [string, boolean][]>}
 */
const CLAIMS = {
  '01-truetype-subset': (s) => [['an embedded TrueType subset (AAAAAA+, FontFile2)', s.fonts.some((each) => each.subtype === 'TrueType' && each.base.startsWith('AAAAAA+') && each.file === 'FontFile2')]],
  '02-type1-and-cff-subsets': (s) => [
    ['a Type 1 subset in FontFile', s.fonts.some((each) => each.subtype === 'Type1' && each.base.startsWith('AAAAAA+') && each.file === 'FontFile')],
    ['a CFF subset in FontFile3 /Type1C', s.fonts.some((each) => each.subtype === 'Type1' && each.base.startsWith('AAAAAA+') && each.file === 'FontFile3/Type1C')],
  ],
  '03-standard-fonts-not-embedded': (s) =>
    ['Times-Roman', 'Helvetica', 'Courier'].map((base) => [
      `${base} named, not embedded, WinAnsi, no ToUnicode`,
      s.fonts.some((each) => each.base === base && each.file === 'none' && each.encoding === 'WinAnsiEncoding' && !each.toUnicode),
    ]),
  '04-all-fonts-drawn-type3': (s) => [['every font on the page is Type 3, and there are two', s.fonts.length === 2 && s.fonts.every((each) => each.subtype === 'Type3')]],
  '05-heading-over-lines': (s, built) => [['the heading is three lines, a text object each', (built.blocks.find((b) => b.id === 'heading')?.text.split('\n').length ?? 0) === 3 && count(s.content, /\bBT\b/gu) === 5]],
  '06-justified-paragraph': (s) => [['word spacing other than zero is set', /[1-9][\d.]* Tw/u.test(s.content)]],
  '07-references-and-links': (s) => [
    ['a raised run (a rise other than zero)', /[1-9][\d.]* Ts/u.test(s.content)],
    ['a link annotation', s.links === 1],
  ],
  '08-bulleted-lists': (s, built) => [
    ['a bullet in the Symbol font, its own text object', s.fonts.some((each) => each.base === 'Symbol') && built.blocks.filter((b) => b.id.startsWith('symbol-bullet')).length === 3],
    ['three bullets drawn as filled curves', count(s.content, / c f/gu) === 3],
    ['bullets in the same text object as the words', built.blocks.find((b) => b.id === 'same-list')?.text.split('\n').every((line) => line.startsWith('•')) === true],
  ],
  '09-numbered-list': (_s, built) => [['numbers and items are separate text objects, one item wrapping', built.blocks.find((b) => b.id === 'numbers')?.text.split('\n').filter((l) => l !== '').length === 3]],
  '10-code-block': (s) => [
    ['Courier', s.fonts.some((each) => each.base === 'Courier')],
    ['a filled panel behind', / re f/u.test(s.content)],
    ['one text object per command', count(s.content, /\bBT\b/gu) === 5],
  ],
  '11-underline-strike-highlight': (s) => [
    ['a highlight behind, filled', / re f/u.test(s.content)],
    ['an underline and a strike, stroked', count(s.content, / l S/gu) === 2],
  ],
  '12-form-xobject-text': (s) => [
    ['forms carrying text, and one inside another', s.forms >= 3 && s.nested === 1 && /BT/u.test(s.content.slice(s.pageContent.length))],
    ['one form drawn in two places (or its edited copy)', count(s.pageContent, /\/(Shared|Original) Do/gu) === 2],
  ],
  '13-clipped-cells': (s) => [['three rectangular clips', count(s.content, / re W n/gu) === 3]],
  '14-two-columns': (_s, built) => {
    const left = built.blocks.find((b) => b.id === 'left')?.box;
    const right = built.blocks.find((b) => b.id === 'right')?.box;
    return [['two blocks side by side', left !== undefined && right !== undefined && left.right < right.left && left.top > right.bottom && right.top > left.bottom]];
  },
  '15-table': (s) => [['eight ruled lines', count(s.content, / l S/gu) === 8]],
  '16-right-to-left': (s) => [
    ['two embedded Type0 fonts with ToUnicode', s.fonts.filter((each) => each.subtype.startsWith('Type0/') && each.file !== 'none' && each.toUnicode).length === 2],
  ],
  '17-cjk': (s) => [
    ['an embedded CIDFontType2 subset', s.fonts.some((each) => each.subtype === 'Type0/CIDFontType2' && each.file === 'FontFile2')],
    ['a CIDFontType0 not embedded', s.fonts.some((each) => each.subtype === 'Type0/CIDFontType0' && each.file === 'none')],
  ],
  '18-rotated-text': (s, built) => [
    ['a block at 90 degrees and one at 30', built.blocks.some((b) => b.angle === 90) && built.blocks.some((b) => b.angle === 30)],
    ['their text matrices turn them', /\b0 1 -1 0 /u.test(s.content) && /0\.866 0\.5 -0\.5 0\.866 /u.test(s.content)],
  ],
  '19-text-over-image': (s) => [['a picture drawn before the text over it', s.images === 1 && s.content.indexOf(' Do ') < s.content.indexOf('BT')]],
  '20-tagged-text': (s) => [
    ['paragraphs in marked content with MCIDs', count(s.content, /\/P <<\/MCID \d+>> BDC/gu) === 2],
    ['a structure tree', s.tagged],
  ],
  '21-cropbox-and-rotate': (s) => [['a crop box off the origin, and /Rotate 90', s.crop !== null && s.crop[0] !== 0 && s.crop[1] !== 0 && s.rotate === 90]],
  '22-scanned-page-ocr': (s, built) => [
    ['one picture the size of the page', s.images === 1],
    ['the words in render mode 3, the blocks invisible', / 3 Tr /u.test(s.content) && built.blocks.every((b) => !b.visible)],
  ],
  '23-word-processor-export': (s) => [['TrueType subsets, WinAnsi, no ToUnicode', s.fonts.some((each) => each.subtype === 'TrueType' && each.base.startsWith('AAAAAA+') && each.encoding === 'WinAnsiEncoding' && !each.toUnicode)]],
  '24-five-hundred-pages': (s, built) => [['500 pages, the edit on page 250', s.pages === 500 && built.page === 249]],
};

// ----------------------------------------------------------------------------------------------------------- the run

/** @param {any} pdfium @param {any} kernel */
async function run(pdfium, kernel) {
  /** @type {string[]} */
  const failures = [];
  const roster = createRoster(failures, { cases: 18 });
  if (CASES.length !== 18) throw new Error(`CASES names ${String(CASES.length)} cases against a declared 18`);
  const check = (/** @type {string} */ name, /** @type {boolean} */ held, /** @type {string} */ detail) => {
    const mark = roster.mark();
    if (!held) failures.push(`${name}\n      ${detail}`);
    roster.record(mark, name);
  };
  const engines = { kernel, pdfium };
  const shapes = SHAPES.filter((shape) => ONLY === undefined || shape.id === ONLY);

  /** Per case, what went wrong on which page. @type {string[][]} */
  const wrong = CASES.map(() => []);
  /** How many pages each control ran on: a control some pages skip must still have run, or it passed by not running. @type {number[]} */
  const ran = CASES.map(() => 0);
  let spread = 0;
  let spreadAt = '';
  for (const shape of shapes) {
    const started = Date.now();
    const base = await shape.build({});
    const { page } = base;
    for (const id of [shape.edit.block, shape.neighbour]) if (!base.blocks.some((block) => block.id === id)) wrong[0]?.push(`${shape.id}: names no block “${id}”`);
    // THE NEW WORD IS NEW: in the edit's words and not in the block before. A word the page already held is one the
    // drawn-font and invisible-word controls cannot be about (two shapes named one, measured on this proof's first run).
    // AS TEXT, not as a word list: a CJK line has no spaces to part its words by.
    const editedText = shape.edit.lines.map((line) => (typeof line === 'string' ? line : line.map((segment) => segment.text).join(''))).join(' ');
    const before = base.blocks.find((block) => block.id === shape.edit.block)?.text ?? '';
    if (!editedText.includes(shape.edit.word) || before.includes(shape.edit.word)) {
      wrong[0]?.push(`${shape.id}: “${shape.edit.word}” is not a word the edit adds`);
    }

    // READ BACK and DRAWN, for every block.
    for (const block of base.blocks) {
      const read = await readBlock(engines, base.bytes, page, block);
      if (!read.mupdf.includes(read.want)) wrong[1]?.push(`${shape.id} ${block.id}: MuPDF read “${read.mupdf[0] ?? ''}”, the manifest says “${read.want}”`);
      if (!read.pdfium.includes(read.want)) wrong[1]?.push(`${shape.id} ${block.id}: PDFium read “${read.pdfium[0] ?? ''}”, the manifest says “${read.want}”`);
      const inked = await inkedCharacters(engines, base.bytes, page, block.box);
      if (inked.read === 0) wrong[2]?.push(`${shape.id} ${block.id}: no character read, so drawing was not judged`);
      else if (block.visible && inked.unseen !== '') wrong[2]?.push(`${shape.id} ${block.id}: visible, and “${inked.unseen}” draws nothing`);
      else if (!block.visible && inked.unseen.length !== inked.read) wrong[2]?.push(`${shape.id} ${block.id}: invisible, and ${String(inked.read - inked.unseen.length)} character(s) draw`);
    }

    // THE SHAPE, read back.
    const claims = CLAIMS[shape.id];
    const structure = await structureOf(base.bytes, page);
    if (claims === undefined) wrong[3]?.push(`${shape.id}: no claim is read back for it`);
    else for (const [claim, held] of claims(structure, base)) if (!held) wrong[3]?.push(`${shape.id}: ${claim}`);

    // ROUND TRIP: saved again by MuPDF's writer, unchanged.
    const session = await kernel.mupdfWriter.open(base.bytes);
    let resaved;
    try {
      resaved = await kernel.mupdfWriter.serialise(session);
    } finally {
      await kernel.mupdfWriter.close(session);
    }
    const drawnBefore = render(kernel, base.bytes, page);
    const again = compare(drawnBefore, render(kernel, resaved, page), [], 0);
    if (again.outside !== 0) wrong[4]?.push(`${shape.id}: ${String(again.outside)} pixel(s) differ`);

    // ANTI-ALIASING SPREAD: each visible block against the page drawn without it.
    const chars = charactersOf(kernel, base.bytes, page);
    for (const block of base.blocks.filter((each) => each.visible)) {
      const without = await shape.build({ omit: block.id });
      const boxes = chars
        .filter((each) => {
          const x = (each.box.left + each.box.right) / 2;
          const y = (each.box.bottom + each.box.top) / 2;
          return x >= block.box.left && x <= block.box.right && y >= block.box.bottom && y <= block.box.top && each.character.trim() !== '';
        })
        .map((each) => each.box);
      const { farthest } = compare(drawnBefore, render(kernel, without.bytes, page), boxes, 0);
      if (farthest / SCALE > spread) {
        spread = farthest / SCALE;
        spreadAt = `${shape.id} ${block.id}`;
      }
    }

    // THE CHECK: the correct edit, the grown one, and every control.
    const block = /** @type {import('../research/editCatalogue.mjs').Block} */ (base.blocks.find((each) => each.id === shape.edit.block));
    const edit = { block: shape.edit.block, lines: shape.edit.lines };
    const correct = await shape.build({ edit });
    const expected = /** @type {string} */ (correct.blocks.find((each) => each.id === block.id)?.text);
    const judge = async (/** @type {Uint8Array | null} */ after, /** @type {string} */ want, outcome = {}) =>
      await expectEdit(engines, { before: base.bytes, after, page, block, expected: want, outcome });
    const verdict = (/** @type {string[]} */ found) => (found.length === 0 ? 'passed' : found.join(' | '));

    const right = await judge(correct.bytes, expected);
    if (right.length > 0) wrong[6]?.push(`${shape.id}: ${verdict(right)}`);
    const word = shape.edit.word;
    // THE LINE ADDED IS THE NEW WORD ALONE: it is in every page's fonts, and as narrow as the narrowest block.
    // On a drawn font's page it is set in an ordinary one, as the owner's rule sets every new word there.
    // And it is drawn (render mode 0), which a scan's recognised words are not until an edit writes them.
    const grownLines = [...shape.edit.lines, [{ text: word, render: 0, ...(block.face.startsWith('Type 3') ? { normal: true } : {}) }]];
    const grown = await shape.build({ edit: { ...edit, lines: grownLines } });
    const grew = await judge(grown.bytes, /** @type {string} */ (grown.blocks.find((each) => each.id === block.id)?.text));
    if (grew.length > 0) wrong[7]?.push(`${shape.id}: ${verdict(grew)}`);

    /** A control: the check must fail, and name `reason` among its failures. @param {number} at @param {string[]} found @param {string} reason */
    const control = (at, found, reason) => {
      ran[at] = (ran[at] ?? 0) + 1;
      if (!found.some((each) => each.startsWith(reason))) wrong[at]?.push(`${shape.id}: ${found.length === 0 ? 'passed' : `failed only as ${verdict(found)}`}, not as ${reason}`);
    };
    // EACH OF THE THREE INSTRUMENTS that sees a neighbour move must see it alone: MuPDF's characters, PDFium's runs, and
    // the pixels — or one of them could be blind and the other two would keep this control green.
    const moved = await judge((await shape.build({ edit, move: { block: shape.neighbour, dx: 0, dy: -0.5 } })).bytes, expected);
    // An invisible neighbour (the scan's text layer) moves no pixel, so only a visible one owes the pixel reason.
    const seen = base.blocks.find((each) => each.id === shape.neighbour)?.visible === true;
    for (const reason of ['MOVED OR REMOVED OUTSIDE THE BLOCK (MuPDF)', 'MOVED OR CHANGED OUTSIDE THE BLOCK (PDFium)', ...(seen ? ['PIXELS OUTSIDE THE BLOCK'] : [])]) control(8, moved, reason);
    // THE EDITED BLOCK SET ABOVE ITS OWN TOP, in its own direction: its words leave its column.
    const [upX, upY] = [-Math.sin((block.angle * Math.PI) / 180) * 30, Math.cos((block.angle * Math.PI) / 180) * 30];
    control(15, await judge((await shape.build({ edit, move: { block: block.id, dx: upX, dy: upY } })).bytes, expected), 'OUTSIDE ITS COLUMN');
    // A PAGE THAT CARRIES A LINK has it removed (the generator names its link `link`).
    if (structure.links > 0) {
      control(16, await judge((await shape.build({ edit, omit: 'link' })).bytes, expected), 'A LINK CHANGED');
    }
    const short = shape.edit.lines.map((line) => (typeof line === 'string' ? line.replace(word, '') : line.map((segment) => ({ ...segment, text: segment.text.replace(word, '') }))));
    const missing = await shape.build({ edit: { ...edit, lines: short } });
    const missed = await judge(missing.bytes, expected);
    control(9, missed, 'READ BACK (MuPDF)');
    control(9, missed, 'READ BACK (PDFium)');
    // A SCAN'S BLOCK SHOWS ITS NEW WORDS (ADR-0181 Decision 9), so its new word left invisible — the old way — fails too.
    if (block.visible || block.scan === true) {
      const invisible = await shape.build({ edit, invisible: { block: block.id, word } });
      control(10, await judge(invisible.bytes, expected), 'UNSEEN WORDS');
      control(12, await judge(base.bytes, expected), 'UNSEEN:');
    }
    // A COVER UNDER A WORD THE EDIT KEPT, on the scan: the picture there is the page's visible text.
    if (block.scan === true) {
      // A word of the first line, which the edit keeps and which the generator's `cover` reads its ink from.
      const kept = (block.text.split('\n')[0] ?? '').split(' ').find((each) => each.length > 3);
      control(17, await judge((await shape.build({ edit, cover: kept ?? '' })).bytes, expected), 'A KEPT WORD COVERED');
    }
    const drawnWord = await shape.build({ edit, drawn: { block: block.id, word } });
    control(11, await judge(drawnWord.bytes, expected), 'A DRAWN FONT');
    control(13, await judge(null, expected, { refused: new Error('a refusal made by the control') }), 'REFUSED');
    control(13, await judge(correct.bytes, expected, { noted: ['a defect noted by the control'] }), 'LOGGED');
    const outside = base.drawings.find((drawing) => {
      const box = drawing.box;
      return box.right < block.box.left || box.left > block.box.right || box.top < block.box.bottom || box.bottom > block.box.top;
    });
    if (outside !== undefined) {
      const removed = await shape.build({ edit, omit: outside.id });
      const found = await judge(removed.bytes, expected);
      control(14, found, 'A DRAWING OR PICTURE');
      control(14, found, 'PIXELS OUTSIDE THE BLOCK');
    }
    process.stdout.write(`  ${shape.id}: ${String(Date.now() - started)} ms\n`);
  }

  check(CASES[0] ?? '', shapes.length === (ONLY === undefined ? 24 : 1) && (wrong[0]?.length ?? 1) === 0, (wrong[0] ?? []).join('\n      '));
  for (const at of [1, 2, 3, 4]) check(CASES[at] ?? '', (wrong[at]?.length ?? 1) === 0, (wrong[at] ?? []).join('\n      '));
  process.stdout.write(`\n  ANTI-ALIASING SPREAD: ${spread.toFixed(2)} pt at ${spreadAt}; MARGIN is ${String(MARGIN)} pt\n`);
  // EQUAL AT THE INSTRUMENT'S STEP, one device pixel: a bound of "at most half a point wider" could not fail while MARGIN
  // was itself half a point (the stage audit of 2026-10-26), so the margin must be the measurement rounded up to a pixel.
  check(CASES[5] ?? '', spread > 0 && MARGIN === Math.ceil(spread * SCALE) / SCALE,`measured ${spread.toFixed(2)} pt (at ${spreadAt}) against a MARGIN of ${String(MARGIN)} pt`);
  for (const at of [6, 7]) check(CASES[at] ?? '', (wrong[at]?.length ?? 1) === 0, (wrong[at] ?? []).join('\n      '));
  const controls = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  process.stdout.write(`  CONTROLS RAN on: ${controls.map((at) => `case ${String(at + 1)} ${String(ran[at] ?? 0)}`).join(', ')} time(s)\n`);
  for (const at of controls) {
    const times = ran[at] ?? 0;
    check(CASES[at] ?? '', times > 0 && (wrong[at]?.length ?? 1) === 0, times === 0 ? 'the control ran on no page' : (wrong[at] ?? []).join('\n      '));
  }

  process.stdout.write(
    failures.length > 0 ? `\n${String(failures.length)} edit catalogue case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n` : roster.format('edit catalogue case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

const library = pdfiumLibrary(ROOT);
const shim = existsSync(library) ? bindNativeEngine(ROOT) : null;
if (!existsSync(library) || shim === null) {
  exitUnverifiable({
    required: REQUIRED,
    subject: 'The edit catalogue and its expectation check',
    why:
      `${String(CASES.length)} case(s) need both engines:\n${CASES.map((label) => `        ??  ${label}`).join('\n')}\n\n      ` +
      (existsSync(library) ? 'The MuPDF shim is not built. Run `npm run provision:mupdf`.' : 'PDFium is not provisioned. Run `node scripts/provision/pdfium.mjs`.'),
    flag: '--require-engines',
  });
} else {
  refuseStaleBuild(ROOT, EDIT_CATALOGUE, 2);
  // LITERAL SPECIFIERS, so `proof:electronimports` and the freshness scan can read what this loads.
  const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
  pdfium.openPdfium(library);
  const mupdf = await import('../../packages/kernel/dist/mupdfRaw.js');
  const { mupdfWriter } = await import('../../packages/kernel/dist/mupdfWriter.js');
  await run(pdfium, { mupdf, mupdfWriter });
}
