// @ts-check
/**
 * Does a picture survive a text edit through PDFium — by the shape the picture is drawn in?
 *
 * ## Why this exists
 *
 * The owner's install of 0.1.5.0 (2026-09-30): after Edit text on one of their documents, its picture no longer
 * appeared. An edit here ends in `FPDFPage_GenerateContent`, which writes the page's content stream afresh from
 * PDFium's page objects — so anything PDFium holds as an object but cannot write back is lost from the SAVED bytes
 * while still drawn from memory until the page is reopened. The document is not one this project may open, so the
 * shapes a picture can take are generated here and each is measured.
 *
 * ## What is measured
 *
 * One page per shape, each with a line of text and a solid red picture over a known square. The page is rendered, its
 * text object replaced, the document SAVED and REOPENED — the canonical image is what the viewer reads — and rendered
 * again; the square's centre pixel is read both times.
 *
 * | shape | how the picture is drawn |
 * |---|---|
 * | xobject | an image XObject — the ordinary shape, and the CONTROL: it must survive, or the edit or the instrument is broken |
 * | inline | an inline image, `BI … ID … EI` in the content stream |
 * | smask | an image XObject with a soft mask |
 * | stencil | an image mask painted in the fill colour |
 * | form | an image XObject drawn inside a Form XObject |
 *
 * Usage: node scripts/research/pdfiumImageKeep.mjs   (after npm run build and node scripts/provision/pdfium.mjs)
 */

import { PDFIUM_ADAPTER, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { pdfiumLibrary } from '../provision/pdfium.mjs';

const ROOT = repoRoot();
// THE BUILT ADAPTER IS THE SUBJECT; a dynamic import, so this guard runs before it.
refuseStaleBuild(ROOT, PDFIUM_ADAPTER, 1);
const pdfium = await import('../../packages/kernel/dist/pdfiumFfi.js');
pdfium.openPdfium(pdfiumLibrary(ROOT));

const SIDE = 16;
/** A solid red RGB raster. */
const RED = Buffer.alloc(SIDE * SIDE * 3);
for (let at = 0; at < RED.length; at += 3) RED[at] = 255;
/** A fully opaque soft mask. */
const OPAQUE = Buffer.alloc(SIDE * SIDE, 255);
/** A stencil whose every sample paints: `/Decode [0 1]` paints where the sample is 0. */
const STENCIL = Buffer.alloc((SIDE / 8) * SIDE, 0);

/** Where the picture is drawn, in PDF user space, and the page it is on. */
const PAGE = { width: 612, height: 792 };
const SQUARE = { x: 100, y: 400, size: 200 };
const PLACE = `${String(SQUARE.size)} 0 0 ${String(SQUARE.size)} ${String(SQUARE.x)} ${String(SQUARE.y)} cm`;
const TEXT = 'BT /F1 24 Tf 72 700 Td (Hello world) Tj ET';

/**
 * A PDF of the given objects, numbered from 1 in order, with object 1 the catalog — offsets computed, bytes exact.
 *
 * @param {(string | Buffer)[][]} objects each a list of parts concatenated as latin1 text and raw bytes
 */
function pdfOf(objects) {
  /** @type {Buffer[]} */
  const parts = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  let length = parts[0]?.length ?? 0;
  /** @type {number[]} */
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(length);
    const piece = Buffer.concat([
      Buffer.from(`${String(index + 1)} 0 obj\n`, 'latin1'),
      ...body.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : part)),
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(piece);
    length += piece.length;
  });
  const xref =
    `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(length)}\n%%EOF\n`;
  parts.push(Buffer.from(xref, 'latin1'));
  return new Uint8Array(Buffer.concat(parts));
}

/** @param {string} dictionary @param {Buffer} data */
const stream = (dictionary, data) => [`<< ${dictionary} /Length ${String(data.length)} >>\nstream\n`, data, '\nendstream'];

/**
 * The page's object list: 1 catalog, 2 pages, 3 page, 4 font, 5 content, then `extra` from 6.
 *
 * @param {string} content @param {string} xobjects @param {(string | Buffer)[][]} extra
 */
function document(content, xobjects, extra) {
  return pdfOf([
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE.width)} ${String(PAGE.height)}] ` +
        `/Resources << /Font << /F1 4 0 R >> ${xobjects === '' ? '' : `/XObject << ${xobjects} >>`} >> /Contents 5 0 R >>`,
    ],
    ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    stream('', Buffer.from(content, 'latin1')),
    ...extra,
  ]);
}

const IMAGE = `/Type /XObject /Subtype /Image /Width ${String(SIDE)} /Height ${String(SIDE)}`;

const SHAPES = {
  xobject: () => document(`${TEXT}\nq ${PLACE} /Im1 Do Q`, '/Im1 6 0 R', [stream(`${IMAGE} /ColorSpace /DeviceRGB /BitsPerComponent 8`, RED)]),
  inline: () =>
    document(
      `${TEXT}\nq ${PLACE} BI /W ${String(SIDE)} /H ${String(SIDE)} /CS /RGB /BPC 8 ID ${RED.toString('latin1')} EI Q`,
      '',
      [],
    ),
  smask: () =>
    document(`${TEXT}\nq ${PLACE} /Im1 Do Q`, '/Im1 6 0 R', [
      stream(`${IMAGE} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask 7 0 R`, RED),
      stream(`${IMAGE} /ColorSpace /DeviceGray /BitsPerComponent 8`, OPAQUE),
    ]),
  stencil: () =>
    document(`${TEXT}\nq 1 0 0 rg ${PLACE} /Im1 Do Q`, '/Im1 6 0 R', [stream(`${IMAGE} /ImageMask true /BitsPerComponent 1`, STENCIL)]),
  form: () =>
    document(`${TEXT}\nq 1 0 0 1 ${String(SQUARE.x)} ${String(SQUARE.y)} cm /Fm1 Do Q`, '/Fm1 6 0 R', [
      stream(
        `/Type /XObject /Subtype /Form /BBox [0 0 ${String(SQUARE.size)} ${String(SQUARE.size)}] /Resources << /XObject << /Im1 7 0 R >> >>`,
        Buffer.from(`q ${String(SQUARE.size)} 0 0 ${String(SQUARE.size)} 0 0 cm /Im1 Do Q`, 'latin1'),
      ),
      stream(`${IMAGE} /ColorSpace /DeviceRGB /BitsPerComponent 8`, RED),
    ]),
};

/**
 * The square's centre, rendered at one pixel per point: `[red, green, blue]`.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ centre: number[], text: string }>}
 */
async function read(bytes) {
  const session = await pdfium.pdfiumWriter.open(bytes);
  try {
    const bitmap = await pdfium.renderPageBitmap(session, 0, PAGE.width, PAGE.height);
    const x = SQUARE.x + SQUARE.size / 2;
    const y = PAGE.height - (SQUARE.y + SQUARE.size / 2);
    const at = (y * bitmap.width + x) * 4;
    const runs = await pdfium.textRuns(session, 0);
    return {
      centre: [bitmap.bgra[at + 2] ?? -1, bitmap.bgra[at + 1] ?? -1, bitmap.bgra[at] ?? -1],
      text: runs.runs.map((/** @type {{ text: string }} */ run) => run.text).join(' '),
    };
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
}

/** @param {number[]} rgb */
const isRed = (rgb) => (rgb[0] ?? 0) > 200 && (rgb[1] ?? 255) < 60 && (rgb[2] ?? 255) < 60;

let broken = false;
for (const [shape, build] of Object.entries(SHAPES)) {
  const original = build();
  const before = await read(original);
  const session = await pdfium.pdfiumWriter.open(original);
  let saved;
  try {
    const indices = await pdfium.textObjectIndices(session, 0);
    const first = indices[0];
    if (first === undefined) throw new Error(`${shape}: the page has no text object to edit`);
    await pdfium.replaceTextObjects(session, 0, [{ index: first, text: 'Edited' }], 'as-written');
    saved = await pdfium.pdfiumWriter.serialise(session);
  } finally {
    await pdfium.pdfiumWriter.close(session);
  }
  const after = await read(saved);
  const kept = isRed(after.centre);
  process.stdout.write(
    `${shape.padEnd(8)} before ${JSON.stringify(before.centre).padEnd(14)} after ${JSON.stringify(after.centre).padEnd(14)} ` +
      `picture ${kept ? 'KEPT' : 'LOST'}  text now "${after.text}"\n`,
  );
  if (!isRed(before.centre)) {
    process.stdout.write(`  ${shape}: the fixture did not draw red BEFORE the edit, so its result says nothing\n`);
    broken = true;
  }
  if (!after.text.includes('Edited')) {
    process.stdout.write(`  ${shape}: the edit did not reach the saved bytes, so its result says nothing\n`);
    broken = true;
  }
  if (shape === 'xobject' && !kept) {
    process.stdout.write('  CONTROL: the ordinary shape lost its picture, so the edit or this instrument is broken\n');
    broken = true;
  }
}
process.exitCode = broken ? 1 : 0;
