// @ts-check
/**
 * The page Edit text is opened on to ask whether OPENING it changes what is shown (cloud run 19,
 * `packages/testing/src/editorFidelity.pw.ts`), and the blocks the application reads from it.
 *
 * ## The six blocks, each a shape the owner's video showed changing on open
 *
 * - a bold heading in Times over two lines, the first a wrap;
 * - a justified paragraph in Times, its words set to fill each line but the last;
 * - a bulleted list, each entry a bold lead-in, the rest roman and a raised reference `[n]` at 7 points;
 * - a code block in Courier, one command to a line;
 * - a paragraph in an embedded TrueType font, Liberation Sans built by `fontKindFixtures.mjs`' `fontOfKind`, the one
 *   builder of font-kind fixtures;
 * - a paragraph in Times, not embedded.
 *
 * ## The blocks are the application's reading, not a description of the page
 *
 * PDFium's `textRuns` over the page, grouped by `groupIntoBlocks` with each line's rises by `withRises`, the reading
 * `composition.ts`' `textBlocks` makes: its style fields, its `fixedPitch` from the read's `mono`, and nothing else of
 * main's (no push, no writer: the rendered case is about what the editor shows). That mapping is restated here, where
 * main's own cannot be imported, so `proof:editorfidelityfixture` is what holds the committed blocks to what the reading
 * answers now.
 *
 * Usage: node scripts/research/editorFidelityFixture.mjs   writes the PDF and its blocks under packages/testing/fixtures
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';

import { EDITOR_FIDELITY_FIXTURE, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { isMain } from '../lib/isMain.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { fontOfKind } from './fontKindFixtures.mjs';

const ROOT = repoRoot();
export const FIXTURE_PDF = join(ROOT, 'packages', 'testing', 'fixtures', 'text-edit', 'editor-fidelity.pdf');
export const FIXTURE_BLOCKS = join(ROOT, 'packages', 'testing', 'fixtures', 'text-edit', 'editor-fidelity.blocks.json');

const HEADING = ['Quarterly results for the northern', 'region and its partners'];
const JUSTIFIED = [
  'The committee met on the first Monday of each month to review the',
  'progress of each project against its plan, agree what to change,',
  'and record every decision in the minutes it kept for the board.',
];
const LIST = [
  { lead: 'Retrieval quality', rest: ' – measured on the held out set of questions', note: '[3]' },
  { lead: 'Answer accuracy', rest: ' – scored by two readers on a sample of fifty', note: '[4]' },
];
const CODE = [
  'git clone https://github.com/explodinggradients/ragas.git',
  '# 2. Install uv (if not already installed)',
  'curl -LsSf https://astral.sh/uv/install.sh | sh',
  'uv sync --all-extras',
];
const EMBEDDED = ['This paragraph is set in a font the file carries with it, so the', 'page draws its own glyphs and an editor can draw the same ones.'];
const TIMES = ['This paragraph is set in Times, which the file names and does not', 'carry, so every reader draws it in a Times of its own choosing.'];

/** The page's bytes. Deterministic: no dates, and pdf-lib's ids are not written without `updateMetadata`. */
export async function buildPage() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([612, 792]);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const roman = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const courier = await doc.embedFont(StandardFonts.Courier);
  const liberation = fontOfKind(doc, 'truetype-embedded', [...new Set(EMBEDDED.join(''))], helvetica);

  HEADING.forEach((line, at) => page.drawText(line, { x: 72, y: 730 - at * 22, size: 18, font: bold }));

  // JUSTIFIED BY PLACING EACH WORD: the gaps of every line but the last are widened so it ends where the longest ends, as
  // a typesetter's justified lines do, each gap a little wider than a space rather than wide enough to read as a column.
  const measure = Math.max(...JUSTIFIED.map((line) => roman.widthOfTextAtSize(line, 11)));
  JUSTIFIED.forEach((line, at) => {
    const words = line.split(' ');
    const ink = words.reduce((sum, word) => sum + roman.widthOfTextAtSize(word, 11), 0);
    const gap = at === JUSTIFIED.length - 1 ? roman.widthOfTextAtSize(' ', 11) : (measure - ink) / (words.length - 1);
    let x = 72;
    for (const word of words) {
      page.drawText(word, { x, y: 650 - at * 14, size: 11, font: roman });
      x += roman.widthOfTextAtSize(word, 11) + gap;
    }
  });

  LIST.forEach((entry, at) => {
    const y = 590 - at * 16;
    page.drawText('•', { x: 80, y, size: 11, font: roman });
    page.drawText(entry.lead, { x: 92, y, size: 11, font: bold });
    const after = 92 + bold.widthOfTextAtSize(entry.lead, 11);
    page.drawText(entry.rest, { x: after, y, size: 11, font: roman });
    page.drawText(entry.note, { x: after + roman.widthOfTextAtSize(entry.rest, 11), y: y + 4, size: 7, font: roman });
  });

  CODE.forEach((line, at) => page.drawText(line, { x: 72, y: 520 - at * 12, size: 9, font: courier }));

  // THE EMBEDDED FONT through the builder's own encoding, in a content stream of its own on the same page.
  const context = doc.context;
  const content = EMBEDDED.map((line, at) => `BT /FE 11 Tf 72 ${String(440 - at * 14)} Td ${liberation.show(line)} Tj ET`).join('\n');
  page.node.normalizedEntries();
  const resources = page.node.Resources();
  const fonts = resources?.lookup(PDFName.of('Font'));
  if (fonts === undefined || !('set' in fonts)) throw new Error('the page has no font dictionary to add the embedded font to');
  /** @type {import('@cantoo/pdf-lib').PDFDict} */ (fonts).set(PDFName.of('FE'), liberation.font);
  page.node.addContentStream(context.register(context.flateStream(content)));

  TIMES.forEach((line, at) => page.drawText(line, { x: 72, y: 380 - at * 14, size: 11, font: roman }));
  return new Uint8Array(await doc.save({ useObjectStreams: false }));
}

/**
 * The page's blocks as `composition.ts`' `textBlocks` answers them, less what this fixture does not need.
 *
 * @param {Uint8Array} bytes
 */
export async function readBlocks(bytes) {
  // THE BUILT KERNEL THIS READS, fresh or refused: a stale one would write last build's reading under this build's name.
  refuseStaleBuild(ROOT, EDITOR_FIDELITY_FIXTURE, 1);
  const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
  pdfium.openPdfium(pdfiumLibrary(ROOT));
  const { blockableOf, groupIntoBlocks, isEditedInPlace, withRises } = await import('../../packages/kernel/dist/textLines.js');
  const session = await pdfium.pdfiumWriter.open(bytes);
  /** @type {any} */
  let read;
  try {
    read = await pdfium.textRuns(session, 0);
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
  const round = (/** @type {number} */ value) => Math.round(value * 1000) / 1000;
  const boxOf = (/** @type {any} */ box) => ({ x0: round(box.x0), y0: round(box.y0), x1: round(box.x1), y1: round(box.y1) });
  const upright = read.runs.filter((/** @type {any} */ run) => isEditedInPlace(run.style));
  const grouped = withRises(
    groupIntoBlocks(
      upright.map((/** @type {any} */ run) => ({
        ...blockableOf(run),
        fixedPitch: run.style.mono,
        style: {
          size: round(run.style.size),
          colour: run.style.colour,
          serif: run.style.serif,
          mono: run.style.mono,
          italic: run.style.italic,
          bold: run.style.bold,
          ...(run.style.font === '' ? {} : { font: run.style.font }),
          baseline: run.style.baseline,
        },
      })),
    ),
    ({ baseline: _baseline, ...style }, rise) => (rise === 0 ? style : { ...style, rise: round(rise) }),
    ({ baseline: _baseline, ...style }) => style,
  );
  return grouped.map((/** @type {any} */ block) => ({
    box: boxOf(block.box),
    style: block.style,
    shape: block.shape,
    lines: block.lines.map((/** @type {any} */ line) => ({
      runs: line.runs.map((/** @type {any} */ run) => ({ index: run.index, text: run.text, style: run.style })),
      box: boxOf(line.box),
      soft: line.soft,
      baseline: round(line.baseline),
    })),
  }));
}

if (isMain(import.meta.url)) {
  if (!existsSync(pdfiumLibrary(ROOT))) throw new Error('PDFium is not provisioned. Run `node scripts/provision/pdfium.mjs`.');
  const bytes = await buildPage();
  const blocks = await readBlocks(bytes);
  writeFileSync(FIXTURE_PDF, bytes);
  writeFileSync(FIXTURE_BLOCKS, `${JSON.stringify(blocks, null, 1)}\n`);
  process.stdout.write(`wrote ${String(bytes.length)} bytes and ${String(blocks.length)} blocks\n`);
}
