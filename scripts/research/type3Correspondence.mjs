// @ts-check
/**
 * Does PDFium's text-object index name the same thing as the page's n-th text-showing operator?
 *
 * ## Why this exists
 *
 * A Type 3 page cannot be rewritten by PDFium: `FPDFPage_GenerateContent` writes a Type 3 text object with no font, no
 * text and no `ET` (`fontKindEdits.mjs`, 2026-10-04), so every PDFium command that regenerates such a page refuses at
 * its read-back and saves nothing. ADR-0176's writer works on the content stream's own bytes, and the editor names what
 * it edits by PDFium's index, so the writer has to find, in the bytes, the operator a PDFium index names. This measures
 * whether the two numberings agree.
 *
 * ## What it reads
 *
 * For each page: PDFium's text objects in its own walk (`textObjectIndices`, each object's text), and the page's
 * content streams, decoded with pdf-lib and read by THE KERNEL'S OWN `textOperators.ts`, which owns the numbering rule
 * (ADR-0176 Decision 3). The k-th object is compared with the operator the rule numbers k, by length. It measured the
 * rule before the module existed, with a tokeniser of its own; that copy is gone, so there is one opinion about the rule.
 *
 * ## Its controls, on every run
 *
 * The positive control is a page of an ordinary font (`fontKindFixtures.mjs`' `type1-standard14`), where nothing about
 * Type 3 is in play: if the numberings disagree there, the instrument is wrong and the run throws instead of reporting
 * the Type 3 pages. `everyOperator` beside `operators` shows what the rule decides on each page.
 *
 * ## Measured, 2026-10-06, PDFium 155.0.8044.0 Linux
 *
 * Helvetica 3 of 3; hand-built Type 3 3 of 3; hard shapes 8 objects for 10 operators, all 8 lengths equal; the Chromium
 * print 60 of 60, the only length differences a space's character that PDFium gives to the object before it and
 * two-byte CID codes.
 *
 * Usage: node scripts/research/type3Correspondence.mjs [file.pdf ...]
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, PDFName } from '@cantoo/pdf-lib';

import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { pageStreams as streamsOf } from '../lib/pageStreams.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';
import { CHROMIUM_FIXTURE } from './chromiumType3Fixture.mjs';
import { buildFixture } from './fontKindFixtures.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * @param {string} label
 * @param {Uint8Array} bytes
 * @param {any} pdfium the PDFium adapter, imported by a computed path
 * @param {any} operators `textOperators.js`, likewise
 */
async function measure(label, bytes, pdfium, operators) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  try {
    const indices = await pdfium.textObjectIndices(session, 0);
    const texts = await Promise.all(indices.map((/** @type {number} */ index) => pdfium.textObjectText(session, 0, index)));
    /** @type {readonly { object: number | null, codes: Uint8Array, state: { font: string | null } }[]} */
    const every = operators.showOperators(operators.joinedContent(await streamsOf(bytes, 0)));
    const lengths = texts.map((/** @type {string} */ text) => Array.from(text).length);
    const numbered = (/** @type {number} */ at) => every.find((operator) => operator.object === at);
    const disagreements = lengths.flatMap((length, at) =>
      numbered(at)?.codes.length === length
        ? []
        : [{ at, text: texts[at], chars: length, codes: numbered(at)?.codes.length, font: numbered(at)?.state.font }],
    );
    return {
      label,
      objects: indices.length,
      everyOperator: every.length,
      operators: operators.textObjectCount(every),
      agreeingLengths: lengths.length - disagreements.length,
      disagreements,
    };
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
}

/**
 * THE HARD SHAPES, each a line of its own between two ordinary ones, in Helvetica so nothing but the operator differs:
 * an empty string, the two quote operators, a TJ of spacing alone, text that only clips (render mode 7), text inside
 * marked content and a saved graphics state, and a font the resources lack. Each is a place where one numbering could
 * count an operator the other does not.
 */
async function hardShapes() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont('Helvetica');
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  const content = [
    'BT /F1 12 Tf 20 360 Td (first) Tj ET',
    'BT /F1 12 Tf 20 340 Td () Tj ET',
    "BT /F1 12 Tf 14 TL 20 320 Td (quote) ' ET",
    'BT /F1 12 Tf 20 300 Td 1 0 (dquote) " ET',
    'BT /F1 12 Tf 20 280 Td [ -100 ] TJ ET',
    'BT /F1 12 Tf 7 Tr 20 260 Td (clip) Tj ET',
    '/Span <</MCID 0>> BDC BT /F1 12 Tf 20 240 Td (marked) Tj ET EMC',
    'q BT /F1 12 Tf 20 220 Td (saved) Tj ET Q',
    'BT /F9 12 Tf 20 210 Td (nofont) Tj ET',
    'BT /F1 12 Tf 20 200 Td (last) Tj ET',
  ].join('\n');
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
  return doc.save({ useObjectStreams: false });
}

const library = pdfiumLibrary(ROOT);
if (library === null || !existsSync(library)) {
  process.stdout.write('UNVERIFIABLE: PDFium is not provisioned (scripts/provision/pdfium.mjs)\n');
  process.exit(0);
}
// EVERY BUILT MODULE THIS IMPORTS, refused when stale before either loads.
refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/pdfiumFfi.ts', 'packages/kernel/dist/pdfiumFfi.js', 'tsc'],
    ['packages/kernel/src/textOperators.ts', 'packages/kernel/dist/textOperators.js', 'tsc'],
  ],
  2,
);
// LITERAL SPECIFIERS, so `proof:electronimports` can read what this loads.
const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
const operators = await import('../../packages/kernel/dist/textOperators.js');
pdfium.openPdfium(library);

const ordinary = await measure('control: type1-standard14', await buildFixture('type1-standard14'), pdfium, operators);
if (ordinary.objects !== ordinary.operators || ordinary.agreeingLengths !== ordinary.objects) {
  throw new Error(`the positive control disagrees, so the instrument is wrong: ${JSON.stringify(ordinary)}`);
}
const rows = [ordinary, await measure('type3 (hand-built)', await buildFixture('type3'), pdfium, operators)];
rows.push(await measure('hard shapes', await hardShapes(), pdfium, operators));
rows.push(await measure('chromium-type3.pdf', new Uint8Array(readFileSync(CHROMIUM_FIXTURE)), pdfium, operators));
for (const file of process.argv.slice(2)) rows.push(await measure(file, new Uint8Array(readFileSync(file)), pdfium, operators));
for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
