// @ts-check
/**
 * What is a page made of, and can the shipped substrate say so?
 *
 * ## The question D6's first row asks
 *
 * *Scanned-page detection* needs no OCR engine, so it leads the stage. What it
 * needs is an answer with a **stated shape** rather than a side effect: today
 * the only thing in this repository that attributes a page as a scan is
 * `proof:lineagreement`, which prints *no text from either engine — a scan, not
 * a disagreement* because two readers both returned nothing. That is an
 * instrument's disclaimer, not a product's answer, and nothing in the kernel
 * knows it.
 *
 * ## Two facts decide the shape, and both are measured here rather than assumed
 *
 * 1. **Does MuPDF's structured text report images at all, and under what
 *    option?** `FZ_STEXT_PRESERVE_IMAGES` is spelt `preserve-images`. If image
 *    blocks arrive without it, the option is unnecessary; if they arrive only
 *    with it, the detector needs a per-consumer opt-in exactly as `table-hunt`
 *    is one.
 * 2. **What does the existing parser do with an image block?** `collectBlocks`
 *    drops any block with no `lines`, which should make images invisible to
 *    every current consumer — so adding the option would change what the
 *    detector sees and nothing else. Asserted by reading, confirmed by running.
 *
 * ## Three constructed pages, because the interesting distinction is a
 * three-way one
 *
 * A page with no text is not necessarily a scan. It may be blank. Those two
 * need different answers — offering OCR on an empty page is the wired-tools
 * defect wearing a suggestion — so the fixtures are text, image-only and empty,
 * and a shape that cannot separate the last two is the wrong shape.
 *
 * The image is generated with `sharp`, which this repository already carries
 * for brand assets, so the fixture is a real raster rather than a description
 * of one.
 *
 * Usage: node scripts/research/pageComposition.mjs
 *        MONSTERA_CORPUS=<directory> node scripts/research/pageComposition.mjs
 */

import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';
import sharp from 'sharp';

import { corpusCaveat, openCorpus } from '../lib/corpus.mjs';
import { formatError } from '../lib/reportError.mjs';

/** The option names, spelt here only because this script predates the module's. */
const SEGMENT = 'segment';
const PRESERVE_IMAGES = 'preserve-images';

/** A grey raster, as a real PNG. */
async function raster() {
  return sharp({
    create: { width: 240, height: 160, channels: 3, background: { r: 200, g: 200, b: 200 } },
  })
    .png()
    .toBuffer();
}

/** @returns {Promise<{ label: string, bytes: Uint8Array }[]>} */
async function fixtures() {
  const png = await raster();

  const withText = await PDFDocument.create();
  const textPage = withText.addPage([400, 300]);
  const font = await withText.embedFont(StandardFonts.Helvetica);
  textPage.drawText('A page with ordinary text on it.', { x: 30, y: 200, size: 12, font });

  const imageOnly = await PDFDocument.create();
  const imagePage = imageOnly.addPage([400, 300]);
  imagePage.drawImage(await imageOnly.embedPng(png), { x: 40, y: 60, width: 320, height: 200 });

  const empty = await PDFDocument.create();
  empty.addPage([400, 300]);

  // AND THE MIXED CASE, which is the one a two-state answer gets wrong: a page
  // carrying both is a text page, and a detector keyed on "has an image" would
  // offer OCR over text it can already read.
  const both = await PDFDocument.create();
  const bothPage = both.addPage([400, 300]);
  const bothFont = await both.embedFont(StandardFonts.Helvetica);
  bothPage.drawImage(await both.embedPng(png), { x: 40, y: 40, width: 320, height: 120 });
  bothPage.drawText('Text above a picture.', { x: 30, y: 240, size: 12, font: bothFont });

  return [
    { label: 'text only ', bytes: await withText.save() },
    { label: 'image only', bytes: await imageOnly.save() },
    { label: 'empty     ', bytes: await empty.save() },
    { label: 'both      ', bytes: await both.save() },
  ];
}

/**
 * Every block type MuPDF reports for a page, flattened through `structure`.
 *
 * @param {unknown} source
 * @param {Record<string, number>} into
 */
function types(source, into) {
  if (!Array.isArray(source)) return;
  for (const entry of source) {
    if (typeof entry !== 'object' || entry === null) continue;
    const block = /** @type {Record<string, unknown>} */ (entry);
    const contents = block['contents'];
    if (Array.isArray(contents)) {
      types(contents, into);
      continue;
    }
    const kind = typeof block['type'] === 'string' ? block['type'] : '(none)';
    into[kind] = (into[kind] ?? 0) + 1;
  }
}

/**
 * @param {Uint8Array} bytes
 * @param {number} index
 * @param {string} options
 * @returns {{ blocks: Record<string, number>, characters: number }}
 */
function read(bytes, index, options) {
  const document = /** @type {mupdf.PDFDocument} */ (
    mupdf.PDFDocument.openDocument(bytes, 'application/pdf')
  );
  const page = document.loadPage(index);
  const stext = page.toStructuredText(options);
  try {
    const parsed = /** @type {Record<string, unknown>} */ (JSON.parse(stext.asJSON()));
    /** @type {Record<string, number>} */
    const blocks = {};
    types(parsed['blocks'], blocks);
    // Characters through the same JSON, so the two halves of the verdict come
    // from one reading of one engine rather than from two calls that could
    // disagree about what this page holds.
    return { blocks, characters: charactersIn(parsed) };
  } finally {
    stext.destroy();
  }
}

/**
 * Every character MuPDF placed on the page.
 *
 * @param {unknown} node
 * @returns {number}
 */
function charactersIn(node) {
  if (Array.isArray(node)) {
    let sum = 0;
    for (const entry of node) sum += charactersIn(entry);
    return sum;
  }
  if (typeof node !== 'object' || node === null) return 0;
  const record = /** @type {Record<string, unknown>} */ (node);
  const text = record['text'];
  if (typeof text === 'string') return text.length;
  let sum = 0;
  for (const value of Object.values(record)) sum += charactersIn(value);
  return sum;
}

try {
  process.stdout.write('# What is a page made of?\n\n');
  process.stdout.write('## Constructed pages, with the option off and on\n\n');
  process.stdout.write('  fixture       without preserve-images        with preserve-images\n');
  for (const fixture of await fixtures()) {
    const off = read(fixture.bytes, 0, SEGMENT);
    const on = read(fixture.bytes, 0, `${SEGMENT},${PRESERVE_IMAGES}`);
    process.stdout.write(
      `  ${fixture.label}  chars=${String(off.characters).padStart(3)} ` +
        `${JSON.stringify(off.blocks).padEnd(24)}  chars=${String(on.characters).padStart(3)} ` +
        `${JSON.stringify(on.blocks)}\n`,
    );
  }

  process.stdout.write('\n## The supplied corpus, page by page\n\n');
  const corpus = openCorpus();
  if (!corpus.available) {
    process.stdout.write(`${corpus.outcome.text}\n`);
  } else {
    process.stdout.write('  id                pages   text   image-only   empty\n');
    for (const item of corpus.documents) {
      const document = /** @type {mupdf.PDFDocument} */ (
        mupdf.PDFDocument.openDocument(item.bytes, 'application/pdf')
      );
      const pages = document.countPages();
      let text = 0;
      let imageOnly = 0;
      let empty = 0;
      for (let index = 0; index < pages; index += 1) {
        const seen = read(item.bytes, index, `${SEGMENT},${PRESERVE_IMAGES}`);
        const images = seen.blocks['image'] ?? 0;
        if (seen.characters > 0) text += 1;
        else if (images > 0) imageOnly += 1;
        else empty += 1;
      }
      process.stdout.write(
        `  ${item.id}${String(pages).padStart(7)}${String(text).padStart(7)}` +
          `${String(imageOnly).padStart(13)}${String(empty).padStart(8)}\n`,
      );
    }
    process.stdout.write(`\n${corpusCaveat(corpus.documents.length)}\n`);
  }
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
