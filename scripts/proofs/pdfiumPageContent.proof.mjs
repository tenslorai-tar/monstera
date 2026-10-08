// @ts-check
/**
 * The PDFium page-content read, against the real library
 * ([ADR-0210](../../docs/DECISIONS/0210-the-editable-powerpoint-export-is-built-from-two-host-reads-and-a-slide-model.md)).
 *
 * `pageContent` is what the editable PowerPoint export reads: a page's frame, its text runs, its pictures with their bytes,
 * the paths a shape can be, and the places that are none of those. The slide model is proved without PDFium, from content
 * handed to it (`editablePresentation.test.ts`); THIS proves that what it is handed is what the library says about a page.
 * Two halves that are each right can be wrong together, and the usual place is a number the library answers in a
 * convention nobody wrote down. The first run of this file found one: `FPDF_SEGMENT_*` is LINETO 0, BEZIERTO 1,
 * MOVETO 2, which is not the order the words are listed in, and every path on the page was answered as opaque.
 *
 * ## Every case has its control
 *
 * A case that asserts *refused* or *opaque* uses an input the absent rule would let through: the dashed line beside the
 * plain one, the clipped rectangle beside the unclipped one, the masked image beside the unmasked one. A refusal with
 * nothing beside it cannot tell the rule from an input that would have failed anyway.
 *
 * ## Fixtures are raw PDF, written here
 *
 * Whole-file structure is the point of several cases (a form, an SMask, a clip, a render mode), and a library that writes
 * PDFs would decide those details for us. The JPEG is MuPDF's, so its bytes are a real encoder's.
 *
 * Usage: node scripts/proofs/pdfiumPageContent.proof.mjs [--require-pdfium]
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { PDFIUM_PAGE_CONTENT, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { exitUnverifiable } from '../lib/unverifiable.mjs';
import { PDFIUM_VERSION, pdfiumLibrary } from '../provision/pdfium.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REQUIRE = process.argv.includes('--require-pdfium');

const library = pdfiumLibrary(root);
if (!existsSync(library)) {
  exitUnverifiable({
    required: REQUIRE,
    subject: 'the PDFium page-content read',
    why: `${library} is absent. \`node scripts/provision/pdfium.mjs\` fetches the pinned ${PDFIUM_VERSION} archive.`,
    flag: '--require-pdfium',
  });
}

refuseStaleBuild(root, PDFIUM_PAGE_CONTENT, 2);

const { openPdfium, onImage, pageContent, renderPageBitmap, renderPageBitmapWithoutText, textRuns } = await import(
  '../../packages/kernel/dist/pdfiumFfi.js'
);
const { PAGE_CONTENT_IMAGE_PIXELS_MAX } = await import('../../packages/kernel/dist/host/pdfiumChannels.js');
const mupdf = await import('mupdf');

openPdfium(library);

/** @type {string[]} */
const failures = [];
const roster = createRoster(failures, { cases: 34 });

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} detail
 */
function record(name, ok, detail) {
  const mark = roster.mark();
  if (!ok) failures.push(`${name}\n      ${detail}`);
  roster.record(mark, `${name} — ${detail}`);
}

/** @param {number} a @param {number} b @param {number} within */
const near = (a, b, within = 0.6) => Math.abs(a - b) <= within;

/**
 * A PDF from object bodies. Each body is a Buffer; the page, pages and catalog numbers are the caller's.
 *
 * @param {Buffer[]} objects bodies of objects 1..n
 * @param {number} catalog the catalog's object number
 */
function pdf(objects, catalog) {
  const parts = [Buffer.from('%PDF-1.7\n')];
  /** @type {number[]} */
  const offsets = [];
  let at = parts[0]?.length ?? 0;
  objects.forEach((body, n) => {
    offsets.push(at);
    const chunk = Buffer.concat([Buffer.from(`${String(n + 1)} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    parts.push(chunk);
    at += chunk.length;
  });
  let xref = `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${String(objects.length + 1)} /Root ${String(catalog)} 0 R >>\nstartxref\n${String(at)}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return new Uint8Array(Buffer.concat(parts));
}

/** @param {string} dict @param {Uint8Array | Buffer} data */
function stream(dict, data) {
  return Buffer.concat([Buffer.from(`<< ${dict} /Length ${String(data.length)} >>\nstream\n`), data, Buffer.from('\nendstream')]);
}

/**
 * A one page document. `extra` objects come first, numbered from 1 in the order given, so a resource can name them.
 *
 * @param {object} options
 * @param {string} options.content the page's content stream
 * @param {Buffer[]} [options.extra] objects 1..k
 * @param {string} [options.resources] the page's /Resources body, naming those objects
 * @param {string} [options.page] extra entries for the page dictionary, such as /Rotate or /CropBox
 */
function onePage({ content, extra = [], resources = '', page = '' }) {
  const base = extra.length;
  const contentNo = base + 1;
  const pageNo = base + 2;
  const pagesNo = base + 3;
  const catalogNo = base + 4;
  return pdf(
    [
      ...extra,
      stream('', Buffer.from(content)),
      Buffer.from(
        `<< /Type /Page /Parent ${String(pagesNo)} 0 R /MediaBox [0 0 612 792] /Contents ${String(contentNo)} 0 R /Resources << ${resources} >> ${page} >>`,
      ),
      Buffer.from(`<< /Type /Pages /Kids [${String(pageNo)} 0 R] /Count 1 >>`),
      Buffer.from(`<< /Type /Catalog /Pages ${String(pagesNo)} 0 R >>`),
    ],
    catalogNo,
  );
}

const HELVETICA_BOLD = Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
const TIMES = Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>');

/** A 32 x 24 gradient as a JPEG, made by MuPDF's encoder. */
function jpeg() {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 32, 24], false);
  const pixels = pixmap.getPixels();
  for (let y = 0; y < 24; y += 1) {
    for (let x = 0; x < 32; x += 1) {
      pixels[(y * 32 + x) * 3] = x * 8;
      pixels[(y * 32 + x) * 3 + 1] = y * 10;
      pixels[(y * 32 + x) * 3 + 2] = 128;
    }
  }
  return Buffer.from(pixmap.asJPEG(90, false));
}

const JPEG = jpeg();

/**
 * @param {Uint8Array} bytes
 * @param {number} [page]
 */
function read(bytes, page = 0) {
  return onImage({ bytes, opensWith: undefined }, (session) => pageContent(session, page));
}

// ---------------------------------------------------------------------------------------------------------------------

async function main() {
  process.stdout.write('# The PDFium page-content read, against the real library\n\n');
  process.stdout.write(`  PDFium ${PDFIUM_VERSION}\n  ${library}\n\n`);

  // TEXT, TWO FONTS, AND WHETHER IT IS PAINTED.
  const text = await read(
    onePage({
      content: [
        'BT /F1 24 Tf 1 0 0 rg 72 700 Td (Quarterly Report) Tj ET',
        'BT /F2 11 Tf 0 g 72 650 Td (The first line) Tj ET',
        'BT /F2 11 Tf 3 Tr 72 600 Td (Hidden recognised words) Tj ET',
      ].join('\n'),
      extra: [HELVETICA_BOLD, TIMES],
      resources: '/Font << /F1 1 0 R /F2 2 0 R >>',
    }),
  );
  const heading = text.runs.find((run) => run.text === 'Quarterly Report');
  const body = text.runs.find((run) => run.text === 'The first line');
  const hidden = text.runs.find((run) => run.text === 'Hidden recognised words');
  record(
    'text runs carry their words, face, size, colour and place',
    heading !== undefined &&
      body !== undefined &&
      heading.style.size === 24 &&
      heading.style.bold &&
      heading.style.colour.r === 255 &&
      heading.style.colour.g === 0 &&
      near(heading.left, 72, 2) &&
      near(heading.bottom, 695, 8) &&
      body.style.size === 11 &&
      !body.style.bold &&
      body.style.font === 'Times-Roman',
    JSON.stringify([heading?.style, heading?.left, heading?.bottom, body?.style.font]),
  );
  record(
    'a run drawn in render mode 3 is INVISIBLE, and one drawn in mode 0 is not',
    hidden?.invisible === true && heading?.invisible === false && body?.invisible === false,
    JSON.stringify([hidden?.invisible, heading?.invisible, body?.invisible]),
  );
  record(
    'the frame is the page: its box and no turn',
    text.frame.rotation === 0 && text.frame.crop.x0 === 0 && text.frame.crop.y1 === 792 && text.frame.crop.x1 === 612,
    JSON.stringify(text.frame),
  );

  // TURNED TEXT: a pure rotation answers its angle and its own four corners, and a shear or a mirror answers neither. The
  // level run of the same words is the ruler: a turned run's length along its baseline is the level run's width.
  const thirty = Math.PI / 6;
  const cos = Math.cos(thirty).toFixed(6);
  const sin = Math.sin(thirty).toFixed(6);
  const turnedPage = await read(
    onePage({
      content: [
        'BT /F2 20 Tf 72 700 Td (Turned words here) Tj ET',
        `BT /F2 20 Tf ${cos} ${sin} -${sin} ${cos} 200 300 Tm (Turned words here) Tj ET`,
        'BT /F2 20 Tf 1 0 0.5 1 100 200 Tm (Sheared words) Tj ET',
        'BT /F2 20 Tf -1 0 0 1 400 100 Tm (Mirrored words) Tj ET',
      ].join('\n'),
      extra: [HELVETICA_BOLD, TIMES],
      resources: '/Font << /F1 1 0 R /F2 2 0 R >>',
    }),
  );
  const level = turnedPage.runs.find((run) => run.text === 'Turned words here' && run.style.orientation === 'upright');
  const turnedRun = turnedPage.runs.find((run) => run.text === 'Turned words here' && run.style.orientation !== 'upright');
  const sheared = turnedPage.runs.find((run) => run.text === 'Sheared words');
  const mirrored = turnedPage.runs.find((run) => run.text === 'Mirrored words');
  const quad = turnedRun?.turn?.quad;
  const along = quad === undefined ? 0 : Math.hypot(quad[2] - quad[0], quad[3] - quad[1]);
  const across = quad === undefined ? 0 : Math.hypot(quad[4] - quad[2], quad[5] - quad[3]);
  record(
    'a run turned 30 degrees answers its angle and the corners of its own box: its length along the baseline is the level run’s width',
    turnedRun?.turn !== null &&
      turnedRun?.turn !== undefined &&
      near(turnedRun.turn.angle, 30, 0.05) &&
      level !== undefined &&
      near(along, level.right - level.left, 2.5) &&
      across > 5 &&
      across < 25,
    JSON.stringify([turnedRun?.turn?.angle, along, level === undefined ? undefined : level.right - level.left, across]),
  );
  record(
    'CONTROL: a level run, a sheared run and a mirrored run answer NO turn, so only a pure rotation is written as a turned box',
    level?.turn === null &&
      sheared?.turn === null &&
      sheared.style.orientation !== 'upright' &&
      mirrored?.turn === null &&
      mirrored.style.orientation !== 'upright',
    JSON.stringify([level?.turn, sheared?.turn, mirrored?.turn]),
  );

  // PICTURES.
  const FLATE =deflateSync(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]));
  const pictures = await read(
    onePage({
      content: 'q 200 0 0 120 72 400 cm /ImJ Do Q\nq 60 0 0 40 300 330 cm /ImF Do Q',
      extra: [
        stream('/Type /XObject /Subtype /Image /Width 32 /Height 24 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', JPEG),
        stream('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode', FLATE),
      ],
      resources: '/XObject << /ImJ 1 0 R /ImF 2 0 R >>',
    }),
  );
  const [first, second] = pictures.images;
  const firstBytes = first === undefined ? new Uint8Array() : pictures.blob.subarray(first.offset, first.offset + first.length);
  record(
    'a plain JPEG is answered as ITS OWN BYTES, identical to what the file holds',
    first?.format === 'jpeg' && Buffer.from(firstBytes).equals(JPEG),
    `${String(first?.format)} ${String(first?.length)} of ${String(JPEG.length)} bytes`,
  );
  record(
    'its place is the matrix: 200 x 120 at (72, 400), and the bounds agree with it',
    first !== undefined &&
      first.matrix[0] === 200 &&
      first.matrix[3] === 120 &&
      first.matrix[4] === 72 &&
      first.matrix[5] === 400 &&
      near(first.bounds.right - first.bounds.left, 200) &&
      first.width === 32 &&
      first.height === 24,
    JSON.stringify(first),
  );
  const pixels = second === undefined ? new Uint8Array() : pictures.blob.subarray(second.offset, second.offset + second.length);
  record(
    'a Flate image is answered as its DECODED pixels, BGRA: red, green, blue, yellow',
    second?.format === 'bgra' &&
      second.length === 16 &&
      [...pixels].join(',') === '0,0,255,255,0,255,0,255,255,0,0,255,0,255,255,255',
    `${String(second?.format)} ${[...pixels].join(',')}`,
  );
  record(
    'the pictures sit one after another in the blob, and nothing lies beyond it',
    first !== undefined && second !== undefined && first.offset === 0 && second.offset === first.length && pictures.blob.length === first.length + second.length,
    `${String(pictures.blob.length)} bytes`,
  );

  // A MASKED IMAGE IS NOT EMBEDDED, and its unmasked twin is.
  const alpha = deflateSync(Buffer.from([255, 128, 64, 0]));
  const rgb = deflateSync(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]));
  const maskedPage = (/** @type {boolean} */ masked) =>
    onePage({
      content: 'q 100 0 0 100 100 100 cm /Im Do Q',
      extra: [
        stream('/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode', alpha),
        stream(
          `/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode${masked ? ' /SMask 1 0 R' : ''}`,
          rgb,
        ),
      ],
      resources: '/XObject << /Im 2 0 R >>',
    });
  const masked = await read(maskedPage(true));
  const unmasked = await read(maskedPage(false));
  record(
    'an image with a soft mask is answered as OPAQUE (cut from the render), not embedded without its transparency',
    masked.images.length === 0 && masked.opaque.length === 1,
    `${String(masked.images.length)} images, ${String(masked.opaque.length)} opaque`,
  );
  record(
    'CONTROL: the same image without the mask IS embedded, so the case above is the mask and not the image',
    unmasked.images.length === 1 && unmasked.opaque.length === 0,
    `${String(unmasked.images.length)} images, ${String(unmasked.opaque.length)} opaque`,
  );

  // AN IMAGE PAST THE PIXEL BUDGET IS NOT DECODED INTO THE ANSWER.
  const side = Math.ceil(Math.sqrt(PAGE_CONTENT_IMAGE_PIXELS_MAX)) + 1;
  const huge = await read(
    onePage({
      content: 'q 100 0 0 100 100 100 cm /Im Do Q',
      extra: [
        stream(
          `/Type /XObject /Subtype /Image /Width ${String(side)} /Height ${String(side)} /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /FlateDecode`,
          deflateSync(Buffer.alloc(Math.ceil((side * side) / 8))),
        ),
      ],
      resources: '/XObject << /Im 1 0 R >>',
    }),
  );
  record(
    'an image past the pixel budget is opaque and costs the answer no bytes',
    huge.images.length === 0 && huge.opaque.length === 1 && huge.blob.length === 0,
    `${String(side)}x${String(side)}: ${String(huge.images.length)} images, ${String(huge.blob.length)} blob bytes`,
  );

  // SHAPES.
  const shapes = await read(
    onePage({
      content: [
        'q 0 0 1 rg 300 400 200 120 re f Q',
        'q 2 w 1 0 0 RG 72 380 m 540 380 l S Q',
        'q 1 0 0 1 10 10 cm 0 0.5 0 rg 20 20 50 50 re f Q',
        'q 0.5 g 400 100 m 450 100 460 150 410 160 c h f Q',
        'q 100 100 100 100 re W n 0 0 0 rg 90 90 200 200 re f Q',
        'q [4 2] 0 d 1 w 72 360 m 540 360 l S Q',
        'q 72 340 m 540 340 l S Q',
        'q 100 100 100 100 re W n 120 120 50 50 re f Q',
      ].join('\n'),
    }),
  );
  const [rect, line, moved, curve] = shapes.paths;
  record(
    'a filled rectangle is a path with its colour, and a stroked line is one with its colour and width',
    rect?.fill?.b === 255 && rect.fill.r === 0 && rect.stroke === null && line?.fill === null && line.stroke?.width === 2 && line.stroke.r === 255,
    JSON.stringify([rect?.fill, line?.stroke]),
  );
  const xs = (moved?.segments ?? []).flatMap((segment) => (segment.kind === 'move' || segment.kind === 'line' ? [segment.x] : []));
  record(
    'a path drawn after a `cm` is answered IN PAGE SPACE, its own matrix applied',
    moved !== undefined && Math.min(...xs) === 30 && Math.max(...xs) === 80 && near(moved.bounds.left, 30) && near(moved.bounds.right, 80),
    `x ${String(Math.min(...xs))} to ${String(Math.max(...xs))}, bounds ${String(moved?.bounds.left)} to ${String(moved?.bounds.right)}`,
  );
  record(
    'a curve is ONE segment of three points, not three lines',
    curve?.segments.map((segment) => segment.kind).join(',') === 'move,curve,line,close',
    curve?.segments.map((segment) => segment.kind).join(',') ?? 'no curve',
  );
  record(
    'a rectangle clipped to something smaller, and a dashed line, are OPAQUE',
    shapes.opaque.length === 2 && shapes.paths.length === 6,
    `${String(shapes.paths.length)} paths, ${String(shapes.opaque.length)} opaque`,
  );
  const undashed = shapes.paths.find((path) => path.stroke !== null && path.bounds.bottom === 339);
  record(
    'CONTROL: the same line without its dash IS a path, and a rectangle clipped to a box that contains it IS one — so those two are the dash and the clip',
    undashed !== undefined && shapes.paths.some((path) => path.bounds.left === 120 && path.bounds.right === 170),
    JSON.stringify(shapes.paths.map((path) => path.bounds)),
  );
  record(
    'every drawn object is accounted for, as a path or as opaque: eight were drawn, and a clip is not one of them',
    shapes.paths.length + shapes.opaque.length === 8,
    `${String(shapes.paths.length)} + ${String(shapes.opaque.length)} of 8`,
  );

  // A FORM'S TEXT IS ON THE PAGE.
  const formContent = Buffer.from('BT /F2 14 Tf 10 10 Td (Text inside a form) Tj ET');
  const formPdf = onePage({
    content: 'q 1 0 0 1 100 200 cm /Fm1 Do Q',
    extra: [TIMES, stream('/Type /XObject /Subtype /Form /BBox [0 0 300 40] /Resources << /Font << /F2 1 0 R >> >>', formContent)],
    resources: '/XObject << /Fm1 2 0 R >>',
  });
  const formed = await read(formPdf);
  const formRun = formed.runs.find((run) => run.text === 'Text inside a form');
  record(
    'text inside a form is a RUN ON THE PAGE, its matrix composed: 10 + 100 across and 10 + 200 up',
    formRun !== undefined && near(formRun.left, 110, 2) && near(formRun.bottom, 210, 3),
    JSON.stringify([formRun?.left, formRun?.bottom]),
  );
  record('and nothing is left uncounted', formed.unaddressable === 0, `${String(formed.unaddressable)} characters`);
  const unflattened = await onImage({ bytes: formPdf, opensWith: undefined }, (session) => textRuns(session, 0));
  record(
    'CONTROL: the plain text read, without flattening, leaves that text unaddressable',
    unflattened.unaddressable > 0 && !unflattened.runs.some((run) => run.text === 'Text inside a form'),
    `${String(unflattened.unaddressable)} characters unaddressable, ${String(unflattened.runs.length)} runs`,
  );

  // A FORM DRAWN THROUGH A CLIP OF ITS OWN STAYS A FORM (CR-NAT-17): PDFium has no call to put the form's clip on a child, so
  // flattening it paints the content unclipped. The same page with the clip taken off is the control above.
  const clippedPdf = onePage({
    content: 'q 0 0 60 60 re W n 1 0 0 1 100 200 cm /Fm1 Do Q',
    extra: [TIMES, stream('/Type /XObject /Subtype /Form /BBox [0 0 300 40] /Resources << /Font << /F2 1 0 R >> >>', formContent)],
    resources: '/XObject << /Fm1 2 0 R >>',
  });
  const clipped = await read(clippedPdf);
  record(
    'a form drawn through a clip of its own is NOT flattened: its text is not a run on the page, and is counted unaddressable',
    !clipped.runs.some((run) => run.text === 'Text inside a form') && clipped.unaddressable > 0,
    `${String(clipped.runs.length)} runs, ${String(clipped.unaddressable)} characters unaddressable`,
  );
  record(
    'CONTROL: the same form with no clip IS flattened, so the case above is the clip',
    formed.runs.some((run) => run.text === 'Text inside a form') && formed.unaddressable === 0,
    `${String(formed.runs.length)} runs, ${String(formed.unaddressable)} unaddressable`,
  );

  // THE FRAME.
  const turned = await read(
    onePage({ content: '', page: '/Rotate 90 /CropBox [50 60 562 742]' }),
  );
  record(
    'a turned page with a CropBox not at the origin is framed as it is displayed: the box and 90 degrees',
    turned.frame.rotation === 90 && turned.frame.crop.x0 === 50 && turned.frame.crop.y0 === 60 && turned.frame.crop.x1 === 562 && turned.frame.crop.y1 === 742,
    JSON.stringify(turned.frame),
  );
  record(
    'CONTROL: the page above it has neither',
    text.frame.rotation === 0 && text.frame.crop.x0 === 0,
    JSON.stringify(text.frame),
  );

  // THE RENDER WITH NO TEXT.
  const textPage = onePage({
    content: 'BT /F1 40 Tf 0 g 72 400 Td (WORDS WORDS WORDS) Tj ET',
    extra: [HELVETICA_BOLD],
    resources: '/Font << /F1 1 0 R >>',
  });
  const ink = (/** @type {Uint8Array} */ bgra) => {
    let n = 0;
    for (let at = 0; at + 3 < bgra.length; at += 4) if ((bgra[at] ?? 255) < 128) n += 1;
    return n;
  };
  const withWords = await onImage({ bytes: textPage, opensWith: undefined }, (session) => renderPageBitmap(session, 0, 306, 396));
  const without = await onImage({ bytes: textPage, opensWith: undefined }, (session) => renderPageBitmapWithoutText(session, 0, 306, 396));
  record(
    'the render with no text has NO ink where the words were',
    ink(without.bgra) === 0,
    `${String(ink(without.bgra))} dark pixels`,
  );
  record(
    'CONTROL: the ordinary render of the same page has the words, so the empty one is the removal and not a blank page',
    ink(withWords.bgra) > 500,
    `${String(ink(withWords.bgra))} dark pixels`,
  );
  const formWords = await onImage({ bytes: formPdf, opensWith: undefined }, (session) => renderPageBitmapWithoutText(session, 0, 306, 396));
  const formWithWords = await onImage({ bytes: formPdf, opensWith: undefined }, (session) => renderPageBitmap(session, 0, 306, 396));
  record(
    'text inside a FORM is removed too, and the ordinary render of it has ink',
    ink(formWords.bgra) === 0 && ink(formWithWords.bgra) > 20,
    `${String(ink(formWords.bgra))} without, ${String(ink(formWithWords.bgra))} with`,
  );
  const afterwards = await read(textPage);
  record(
    'and the document was not touched: reading the same bytes again still finds the words',
    afterwards.runs.some((run) => run.text === 'WORDS WORDS WORDS'),
    afterwards.runs.map((run) => run.text).join('|'),
  );

  // A PAGE THE DOCUMENT DOES NOT HAVE.
  const missing = await read(textPage, 9).then(
    () => null,
    (/** @type {unknown} */ error) => (error instanceof Error ? error.message : String(error)),
  );
  record('a page the document does not have is refused by name', missing !== null && missing.includes('could not load page'), missing ?? 'it was accepted');

  // BLANK AND SMALL.
  const blank = await read(onePage({ content: '' }));
  record(
    'a blank page answers nothing, truncated nothing and counts nothing',
    blank.runs.length === 0 && blank.images.length === 0 && blank.paths.length === 0 && blank.opaque.length === 0 && !blank.truncated && blank.unaddressable === 0,
    JSON.stringify(blank),
  );
  record(
    'every image header lies inside the blob it was written with',
    [...pictures.images, ...unmasked.images].every((image, at) => {
      const blob = at < pictures.images.length ? pictures.blob : unmasked.blob;
      return image.offset >= 0 && image.offset + image.length <= blob.length;
    }),
    `${String(pictures.blob.length)} and ${String(unmasked.blob.length)} bytes`,
  );
  record(
    'the DECODED bitmap of a 2 x 2 image is exactly 16 bytes — width times height times four — so the wire’s size check has something to hold it to',
    unmasked.images[0]?.format === 'bgra' && unmasked.images[0].length === 4 * 4,
    String(unmasked.images[0]?.length),
  );
  record(
    'the same read of the same bytes twice answers the same thing',
    JSON.stringify((await read(formPdf)).runs) === JSON.stringify(formed.runs),
    'a read that depended on its predecessor would differ',
  );

  process.stdout.write(
    failures.length > 0
      ? `\n${String(failures.length)} PDFium page-content case(s) FAILED:\n\n  - ${failures.join('\n\n  - ')}\n`
      : roster.format('PDFium page-content case'),
  );
  process.exitCode = failures.length === 0 ? 0 : 1;
}

await main();
