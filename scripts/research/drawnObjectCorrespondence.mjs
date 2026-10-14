// @ts-check
/**
 * Does PDFium's k-th path, image, form or shading object name the page's k-th drawn instruction of that kind?
 *
 * ## Why this exists
 *
 * ADR-0240 moves a picture, a form or a shape by wrapping its own instructions in the content stream, because PDFium's
 * `FPDFPage_GenerateContent` rewrites every text object on the page it regenerates and a font it cannot re-encode then
 * refuses the move at read-back (the owner's E1). The editor names objects by PDFium's walk, so the writer has to find,
 * in the bytes, the instruction a PDFium index names. This measures whether `textOperators.ts`' `drawnObjects` (the one
 * owner of that numbering, ADR-0176 Decision 3 extended) agrees with PDFium, kind by kind and in order.
 *
 * ## What it reads
 *
 * PDFium's objects on page 0 (`pageObjects`: index, kind, box), and the page's content read by the kernel's own module.
 * Every object of both is put in content order by kind, and the k-th of each kind compared: its kind sequence, and its
 * box (a path's from its points, an image's from the unit square under its CTM).
 *
 * ## Its control, on every run
 *
 * The fixture's first image is placed by `40 0 0 30 200 300 cm`, so its box is exactly 200..240 by 300..330 by
 * construction. If PDFium's first image does not have that box, or either side finds no objects, the run throws rather
 * than reporting agreement: zero of zero is not agreement.
 *
 * ## Measured, 2026-10-14, PDFium 155.0.8044.0 Linux (this container)
 *
 * See ADR-0240's table; the run's output is quoted there.
 *
 * Usage: node scripts/research/drawnObjectCorrespondence.mjs [file.pdf ...]
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDict, PDFDocument, PDFName } from '@cantoo/pdf-lib';

import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { pageStreams as streamsOf } from '../lib/pageStreams.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What each XObject on page 0 is, read with pdf-lib. @param {Uint8Array} bytes */
async function xobjectKinds(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const resources = doc.getPage(0).node.Resources();
  const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
  /** @type {Map<string, 'image' | 'form'>} */
  const kinds = new Map();
  for (const [name, ref] of xobjects?.entries() ?? []) {
    const object = doc.context.lookup(ref);
    const dict = object instanceof PDFDict ? object : /** @type {{ dict?: PDFDict }} */ (object).dict;
    const subtype = dict?.get(PDFName.of('Subtype'));
    if (subtype === PDFName.of('Image')) kinds.set(name.decodeText(), 'image');
    if (subtype === PDFName.of('Form')) kinds.set(name.decodeText(), 'form');
  }
  return kinds;
}

/** A box from points. @param {readonly (readonly [number, number])[]} points */
function boxOf(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return { left: Math.min(...xs), bottom: Math.min(...ys), right: Math.max(...xs), top: Math.max(...ys) };
}

/**
 * @param {string} label
 * @param {Uint8Array} bytes
 * @param {any} pdfium the PDFium adapter, imported by a computed path
 * @param {any} operators `textOperators.js`, likewise
 */
async function measure(label, bytes, pdfium, operators) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  try {
    /** @type {readonly { kind: string, left: number, bottom: number, right: number, top: number }[]} */
    const objects = await pdfium.pageObjects(session, 0);
    const kinds = await xobjectKinds(bytes);
    const content = operators.joinedContent(await streamsOf(bytes, 0));
    /** @type {readonly { kind: string, ordinal: number, start: number, ctm: number[], points: [number, number][] }[]} */
    const drawn = operators.drawnObjects(content, (/** @type {string} */ name) => kinds.get(name));
    /** @type {readonly { object: number | null, start: number }[]} */
    const shown = operators.showOperators(content);
    const ours = [
      ...drawn.map((object) => ({ kind: object.kind, start: object.start, object })),
      ...shown.filter((operator) => operator.object !== null).map((operator) => ({ kind: 'text', start: operator.start, object: null })),
    ].sort((a, b) => a.start - b.start);
    const theirs = objects.map((object) => object.kind);
    const sequenceAgrees = JSON.stringify(theirs) === JSON.stringify(ours.map((each) => each.kind));
    const boxes = drawn.map((object) => {
      const pdfiumOne = objects.filter((each) => each.kind === object.kind)[object.ordinal];
      const computed =
        object.kind === 'image'
          ? boxOf([
              [object.ctm[4] ?? 0, object.ctm[5] ?? 0],
              [(object.ctm[0] ?? 0) + (object.ctm[4] ?? 0), (object.ctm[1] ?? 0) + (object.ctm[5] ?? 0)],
              [(object.ctm[2] ?? 0) + (object.ctm[4] ?? 0), (object.ctm[3] ?? 0) + (object.ctm[5] ?? 0)],
              [(object.ctm[0] ?? 0) + (object.ctm[2] ?? 0) + (object.ctm[4] ?? 0), (object.ctm[1] ?? 0) + (object.ctm[3] ?? 0) + (object.ctm[5] ?? 0)],
            ])
          : object.points.length > 0
            ? boxOf(object.points)
            : null;
      const round = (/** @type {number} */ value) => Math.round(value * 100) / 100;
      return {
        kind: object.kind,
        ordinal: object.ordinal,
        pdfium: pdfiumOne === undefined ? null : [pdfiumOne.left, pdfiumOne.bottom, pdfiumOne.right, pdfiumOne.top].map(round),
        ours: computed === null ? null : [computed.left, computed.bottom, computed.right, computed.top].map(round),
      };
    });
    return { label, pdfium: theirs, ours: ours.map((each) => each.kind), sequenceAgrees, boxes };
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
}

/**
 * THE SHAPES: two painted paths (a fill and a stroke), a clip that paints nothing, a path that clips and fills, text,
 * an image XObject, a form XObject, an inline image and a shading, each in its own saved state, so every place one
 * numbering could count an instruction the other does not is on one page.
 */
async function shapes() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([400, 400]);
  const font = await doc.embedFont('Helvetica');
  page.node.setFontDictionary(PDFName.of('F1'), font.ref);
  const image = doc.context.stream(Uint8Array.of(128), {
    Type: 'XObject', Subtype: 'Image', Width: 1, Height: 1, ColorSpace: 'DeviceGray', BitsPerComponent: 8,
  });
  const form = doc.context.stream('0 0 1 rg 0 0 30 20 re f', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 30, 20] });
  page.node.setXObject(PDFName.of('Im1'), doc.context.register(image));
  page.node.setXObject(PDFName.of('Fm1'), doc.context.register(form));
  const shading = doc.context.obj({
    ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [0, 0, 1, 0],
    Function: { FunctionType: 2, Domain: [0, 1], C0: [1, 0, 0], C1: [0, 0, 1], N: 1 },
  });
  const resources = page.node.Resources() ?? doc.context.obj({});
  resources.set(PDFName.of('Shading'), doc.context.obj({ Sh1: shading }));
  const content = [
    'q 1 0 0 rg 20 300 100 50 re f Q',
    'q 2 w 20 200 m 120 260 l S Q',
    'q 10 10 50 50 re W n Q',
    'BT /F1 12 Tf 20 380 Td (text) Tj ET',
    'q 40 0 0 30 200 300 cm /Im1 Do Q',
    'q 1 0 0 1 200 200 cm /Fm1 Do Q',
    'q 50 0 0 40 300 100 cm BI /W 1 /H 1 /CS /G /BPC 8 ID A EI Q',
    'q 0 0 1 rg 300 300 40 40 re W f Q',
    'q 250 20 50 50 re W n /Sh1 sh Q',
  ].join('\n');
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
  return doc.save({ useObjectStreams: false });
}

const library = pdfiumLibrary(ROOT);
if (library === null || !existsSync(library)) {
  process.stdout.write('UNVERIFIABLE: PDFium is not provisioned (scripts/provision/pdfium.mjs)\n');
  process.exit(0);
}
refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/pdfiumFfi.ts', 'packages/kernel/dist/pdfiumFfi.js', 'tsc'],
    ['packages/kernel/src/textOperators.ts', 'packages/kernel/dist/textOperators.js', 'tsc'],
  ],
  2,
);
const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
const operators = await import('../../packages/kernel/dist/textOperators.js');
pdfium.openPdfium(library);

const control = await measure('shapes', await shapes(), pdfium, operators);
const firstImage = control.boxes.find((box) => box.kind === 'image' && box.ordinal === 0);
if (control.pdfium.length === 0 || control.ours.length === 0 || JSON.stringify(firstImage?.pdfium) !== JSON.stringify([200, 300, 240, 330])) {
  throw new Error(`the positive control disagrees, so the instrument is wrong: ${JSON.stringify(control)}`);
}
const rows = [control];
for (const file of process.argv.slice(2)) rows.push(await measure(file, new Uint8Array(readFileSync(file)), pdfium, operators));
for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
