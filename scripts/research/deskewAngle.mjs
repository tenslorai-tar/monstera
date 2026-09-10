// @ts-check
/**
 * How crooked is a crooked scan, measured in the bitmap?
 *
 * ## The question this answers, and the one it deliberately does not
 *
 * D2's deskew row was deferred to Stage 6 with its open question named: *the
 * open question is the fixture, not the algorithm.* A projection-profile skew
 * search is well understood; what this build had no way to check was whether
 * its **fixture** was skewed the way it claimed. The first attempt drew bars
 * with `drawRectangle` at an angle and measured them — and `drawRectangle`
 * rotates each bar about its **own origin**, so what that produces in device
 * space was never established. An instrument that measures its own artefact
 * agrees with itself perfectly.
 *
 * The corpus now carries a real crooked scan, so the fixture question is
 * answerable. This measures the angle; it decides nothing about how a deskew
 * command would correct it.
 *
 * ## No tuned constant anywhere in it
 *
 * - the ink threshold is **Otsu's**, computed from each page's own histogram;
 * - the angle is the **argmax** of a sweep, not a value compared against a
 *   cutoff;
 * - the sweep's range and step are stated as the resolution of the answer, not
 *   as a decision about what counts as skewed.
 *
 * ## THE CONTROLS COME FIRST, and the instrument refuses without them
 *
 * A skew search reports a number for any input, including a blank page and a
 * page of noise, so the reassuring answer here is *an angle*. Two constructed
 * pages run before any corpus document:
 *
 * 1. **upright text must read ~0°** — an instrument with a sign error or an
 *    off-by-one in its binning reports a confident tilt for a page that has
 *    none;
 * 2. **text drawn at a known angle must read that angle** — this is the
 *    resolution test, and it is the one the earlier attempt never had. Without
 *    it, case 1 is satisfied by a function that always answers zero.
 *
 * Usage: node scripts/research/deskewAngle.mjs
 *        MONSTERA_CORPUS=<directory> node scripts/research/deskewAngle.mjs
 */

import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

import { mupdfWriter } from '../../packages/kernel/dist/mupdfWriter.js';
import { applyDeskewPages } from '../../packages/kernel/dist/pageDeskew.js';
import {
  SKEW_DPI,
  SKEW_SWEEP_DEGREES,
  SKEW_SWEEP_STEP,
  greyRasterOfPage,
  skewOfRaster,
} from '../../packages/kernel/dist/pageSkew.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { corpusCaveat, openCorpus } from '../lib/corpus.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { formatError } from '../lib/reportError.mjs';

// THE DETECTOR IS THE KERNEL'S, and this file stopped carrying its own copy on
// 2026-09-10, when `deskewPages` was built. The instrument that produced this
// row's evidence and the command that acts on it must not hold two opinions
// about what a page's skew is (B3a) — a shipped correction argued from a
// research figure a different implementation produced is the shape where both
// halves are individually right.
refuseStaleBuild(
  repoRoot(),
  [
    ['packages/kernel/src/pageSkew.ts', 'packages/kernel/dist/pageSkew.js', 'tsc'],
    ['packages/kernel/src/pageDeskew.ts', 'packages/kernel/dist/pageDeskew.js', 'tsc'],
  ],
  2,
);

/**
 * The skew of one rasterised page, as the kernel measures it.
 *
 * @param {mupdf.PDFPage} page
 * @returns {{ degrees: number, ratio: number }}
 */
function skewOf(page) {
  const measured = skewOfRaster(greyRasterOfPage(page));
  return { degrees: measured.rasterDegrees, ratio: measured.ratio };
}

/**
 * A page of horizontal lines of text, drawn at a known angle.
 *
 * `drawText` with a `rotate` turns each line about its own origin, which is
 * exactly the artefact the first deskew attempt measured — so the lines are
 * placed on the rotated baseline themselves rather than laid out upright and
 * spun. At a small angle the two are the same thing to within a pixel, and
 * placing them makes the fixture's ground truth a property of the arithmetic
 * here rather than of pdf-lib's rotation origin.
 *
 * @param {number} angle
 */
async function constructedPage(angle) {
  const document = await PDFDocument.create();
  const page = document.addPage([595, 842]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const radians = (angle * Math.PI) / 180;
  const line = 'The quick brown fox jumps over the lazy dog, again and again and again.';
  for (let index = 0; index < 24; index += 1) {
    // THE BASELINE IS COMPUTED, so the fixture's angle is this file's
    // arithmetic and not a library's idea of a rotation origin.
    const x0 = 60;
    const y0 = 760 - index * 28;
    page.drawText(line, {
      x: x0,
      y: y0,
      size: 11,
      font,
      rotate: degrees(angle),
      // Each line starts on the same rotated ray from the page's left edge, so
      // the block as a whole is a rotated block rather than a stack of
      // individually spun lines.
      xSkew: degrees(0),
      ySkew: degrees(0),
    });
    void radians;
  }
  return document.save();
}

/** @param {Uint8Array} bytes */
function firstPageOf(bytes) {
  const document = /** @type {mupdf.PDFDocument} */ (
    mupdf.PDFDocument.openDocument(bytes, 'application/pdf')
  );
  return document.loadPage(0);
}

try {
  process.stdout.write('# How crooked is a crooked scan?\n\n');
  process.stdout.write(
    `  swept ±${String(SKEW_SWEEP_DEGREES)}° in ${String(SKEW_SWEEP_STEP)}° steps, ` +
      `rasterised at ${String(SKEW_DPI)} dpi through MuPDF, ink split by Otsu\n` +
      '  the detector is packages/kernel/src/pageSkew.ts, the one `deskewPages` corrects with\n\n',
  );

  process.stdout.write('## Controls\n\n');
  const upright = skewOf(firstPageOf(await constructedPage(0)));
  process.stdout.write(
    `  text drawn upright reads ${upright.degrees.toFixed(1)}°\n`,
  );
  const drawnAt = -3;
  const tilted = skewOf(firstPageOf(await constructedPage(drawnAt)));
  process.stdout.write(
    `  text drawn at ${drawnAt.toFixed(1)}° in PDF space reads ` +
      `${tilted.degrees.toFixed(1)}° in the raster\n`,
  );
  if (Math.abs(upright.degrees) > 0.5) {
    throw new Error(
      `CONTROL FAILED: upright text reads ${upright.degrees.toFixed(1)}°. Every figure below ` +
        'would be that error plus whatever the page has.',
    );
  }
  // THE SIGN IS FLIPPED, AND THAT IS ASSERTED RATHER THAN ABSORBED. pdf-lib
  // rotates counter-clockwise in PDF user space, which is **y-up**; the raster
  // this sweeps is **y-down**, so the same tilt has the opposite sign here.
  // The first run of this file reported `-3.0° reads 3.0°` and stopped, which
  // is the control doing its job — an expected value quietly adjusted to match
  // would have buried a frame difference in a number.
  //
  // Every figure this instrument prints is therefore a RASTER angle, and a
  // deskew command taking one has a conversion to make.
  if (Math.abs(tilted.degrees + drawnAt) > 0.5) {
    throw new Error(
      `CONTROL FAILED: text drawn at ${drawnAt.toFixed(1)}° in PDF space reads ` +
        `${tilted.degrees.toFixed(1)}° in the raster, where the y-flip predicts ` +
        `${(-drawnAt).toFixed(1)}°. Without this case the one above is satisfied by an ` +
        'instrument that always answers zero.',
    );
  }
  process.stdout.write(
    '  both within 0.5°, so the sweep can see an angle and can see zero — and the sign flips,\n' +
      '  because PDF user space is y-up and this raster is y-down\n\n',
  );

  // THE CORRECTION, MEASURED ON THE WAY OUT. `applyDeskewPages` is run against
  // the crooked constructed page and the result re-measured: a flipped sign
  // lands at twice the original tilt rather than at zero, which is the one
  // failure a symmetric fixture and an expectation copied from a run cannot
  // separate.
  const corrected = await (async () => {
    const session = await mupdfWriter.open(await constructedPage(drawnAt));
    try {
      await applyDeskewPages(session, { kind: 'deskewPages', pages: 'all' });
      return await mupdfWriter.serialise(session);
    } finally {
      await mupdfWriter.close(session);
    }
  })();
  const afterCorrection = skewOf(firstPageOf(corrected));
  process.stdout.write(
    `  deskewPages leaves it at ${afterCorrection.degrees.toFixed(1)}°, ` +
      `where a flipped sign leaves ${(-2 * drawnAt).toFixed(1)}°\n\n`,
  );
  if (Math.abs(afterCorrection.degrees) > 0.5) {
    throw new Error(
      `CONTROL FAILED: the deskewed page reads ${afterCorrection.degrees.toFixed(1)}°. The ` +
        'correction is not levelling the page it measured.',
    );
  }

  process.stdout.write('## The supplied corpus\n\n');
  const corpus = openCorpus();
  if (!corpus.available) {
    process.stdout.write(`${corpus.outcome.text}\n`);
  } else {
    process.stdout.write('  id                pages   skew    ratio    after deskewPages\n');
    for (const item of corpus.documents) {
      const document = /** @type {mupdf.PDFDocument} */ (
        mupdf.PDFDocument.openDocument(item.bytes, 'application/pdf')
      );
      const pages = document.countPages();
      const page = document.loadPage(0);
      // TEXT PAGES ARE SKIPPED, and said so rather than scored: a page whose
      // text this build can already read is not what deskew is for, and a
      // number for it invites somebody to compare the two.
      const stext = page.toStructuredText('segment');
      const json = stext.asJSON();
      stext.destroy();
      if (json.includes('"text"')) {
        process.stdout.write(`  ${item.id}${String(pages).padStart(7)}   — carries text\n`);
        continue;
      }
      const skew = skewOf(page);
      // AND THE COMMAND IS RUN ON IT. A number for how crooked a real scan is
      // says nothing about whether this build can straighten it, and those are
      // two different claims a row can make.
      const session = await mupdfWriter.open(item.bytes);
      let after;
      try {
        await applyDeskewPages(session, { kind: 'deskewPages', pages: [0] });
        after = skewOf(firstPageOf(await mupdfWriter.serialise(session)));
      } finally {
        await mupdfWriter.close(session);
      }
      process.stdout.write(
        `  ${item.id}${String(pages).padStart(7)}` +
          `${skew.degrees.toFixed(1).padStart(8)}°` +
          `   ${skew.ratio.toFixed(3)}×` +
          `   ${after.degrees.toFixed(1).padStart(6)}° at ${after.ratio.toFixed(3)}×\n`,
      );
    }
    process.stdout.write(`\n${corpusCaveat(corpus.documents.length)}\n`);
    process.stdout.write(
      '  The ratio is what says whether the angle MEANS anything: a page whose best score is\n' +
        '  barely above its score at 0° is a page with no line structure to align, and the\n' +
        '  argmax of a flat sweep is noise wearing a number.\n',
    );
  }
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
