// @ts-check
/**
 * The documents `renderGeometry.proof.mjs` renders.
 *
 * ## Built here, not read from disk
 *
 * `packages/testing/fixtures/generated/` is gitignored, so a fixture named
 * rather than built exists on a machine that has run something else and on no
 * runner — the finding `canvasPixels.proof.mjs` records, whose fixture builder
 * this one sits beside.
 *
 * ## Each one differs from the others in ONE property
 *
 * The proof asks what size canvas the renderer produced, and the only honest way
 * to read that answer is against a document where a wrong implementation
 * produces a DIFFERENT size. So the pages are deliberately non-square — 400 by
 * 600 — because a square page makes a rotation invisible, and the crop is
 * deliberately at a non-zero origin, because a CropBox starting at 0,0 makes
 * *uses the CropBox* and *uses the MediaBox and got lucky* the same reading.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, PDFName, PDFNumber, StandardFonts, rgb } from '@cantoo/pdf-lib';

import { fixtureDirectory } from '../perf/largeFixture.mjs';
import { repoRoot } from './gitScope.mjs';

/** The page's box, in PDF units. Non-square on purpose — see the header. */
export const PAGE_WIDTH = 400;
export const PAGE_HEIGHT = 600;

/**
 * The crop, as `[x0, y0, x1, y1]`.
 *
 * A non-zero origin and a different aspect ratio from the page, so a renderer
 * using the MediaBox produces neither the right size nor the right shape.
 */
export const CROP = { x0: 80, y0: 120, x1: 280, y1: 420 };
export const CROP_WIDTH = CROP.x1 - CROP.x0;
export const CROP_HEIGHT = CROP.y1 - CROP.y0;

/**
 * Fills a page so the painted count means something.
 *
 * Rectangles rather than text, deliberately: this proof is about GEOMETRY, and a
 * fixture whose ink depends on a font resolving would report a geometry failure
 * for a font problem. The standard-font question has its own fixture below.
 *
 * @param {import('@cantoo/pdf-lib').PDFPage} page
 */
function paint(page) {
  const { width, height } = page.getSize();
  // Covers the whole box, including the part outside a crop — so a renderer
  // that drew the MediaBox into a CropBox-sized canvas still paints, and the
  // SIZE is what separates the two rather than the ink.
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.2, 0.4, 0.8) });
  page.drawRectangle({
    x: width / 4,
    y: height / 4,
    width: width / 2,
    height: height / 2,
    color: rgb(0.9, 0.8, 0.1),
  });
}

/**
 * Writes the four fixtures and returns their paths.
 *
 * @param {{ root?: string }} [options]
 * @returns {Promise<{ upright: string, rotated: string, cropped: string, standardFont: string }>}
 */
export async function buildRenderGeometryFixtures(options = {}) {
  const directory = fixtureDirectory(options.root ?? repoRoot());
  mkdirSync(directory, { recursive: true });

  /** @param {string} name @param {Uint8Array} bytes */
  const write = (name, bytes) => {
    const path = join(directory, name);
    writeFileSync(path, bytes);
    return path;
  };

  const plain = async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    paint(page);
    return { document, page };
  };

  const upright = await plain();

  const turned = await plain();
  // `/Rotate 90` on the page itself, which is what a scanner writes and what a
  // reader must honour. `setRotation` is pdf-lib's own writer for it.
  turned.page.node.set(PDFName.of('Rotate'), PDFNumber.of(90));

  const crop = await plain();
  crop.page.node.set(
    PDFName.of('CropBox'),
    crop.document.context.obj([CROP.x0, CROP.y0, CROP.x1, CROP.y1]),
  );

  // A page whose only ink is text in a STANDARD font that is named and not
  // embedded — the case PDF.js needs `standardFontDataUrl` for. Nothing about
  // the geometry; this one exists to answer whether the four runtime asset
  // directories the spike names actually resolve under this build's CSP.
  const fontDocument = await PDFDocument.create();
  const fontPage = fontDocument.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const helvetica = await fontDocument.embedFont(StandardFonts.Helvetica);
  for (let line = 0; line < 24; line += 1) {
    fontPage.drawText('The quick brown fox jumps over the lazy dog 0123456789', {
      x: 20,
      y: PAGE_HEIGHT - 30 - line * 22,
      size: 13,
      font: helvetica,
      color: rgb(0, 0, 0),
    });
  }

  return {
    upright: write('render-upright.pdf', await upright.document.save({ useObjectStreams: false })),
    rotated: write('render-rotated.pdf', await turned.document.save({ useObjectStreams: false })),
    cropped: write('render-cropped.pdf', await crop.document.save({ useObjectStreams: false })),
    standardFont: write(
      'render-standard-font.pdf',
      await fontDocument.save({ useObjectStreams: false }),
    ),
  };
}
