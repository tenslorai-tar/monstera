// @ts-check
/**
 * Which frame MuPDF's structured text reports boxes in, at all four rotations.
 *
 * ## The contradiction that made this necessary
 *
 * The text layer has to place a DOM element over each line, and the renderer's
 * one conversion runs from a coordinate the kernel sends. Two modules in this
 * repository already read MuPDF geometry and they disagree about what frame it
 * is in:
 *
 * - `textStructure.ts` types the substrate's boxes as **`FitzRect`**, and
 *   `@monstera/shared`'s `fromFitz` converts one by flipping y about the crop
 *   box. It does **not** undo rotation.
 * - `flatFields.ts` reads path and text geometry off a `mupdf.Device` and
 *   converts with **`toPdf(viewportPoint(…), transform)`**, which does undo
 *   rotation, because `toPdf` switches on `transform.rotation`.
 *
 * On an unrotated page the two agree, and every fixture in this repository that
 * touches either is unrotated. On a `/Rotate 90` page at most one of them can be
 * right, and the wrong one places every line of the text layer somewhere the
 * text is not — which looks exactly like a working feature until someone opens a
 * landscape scan.
 *
 * This project has paid for this once already, on `/Rect`: a rule at user
 * (150,700)–(540,700) with `/Rotate 90` arrives at display
 * (699.5,149.5)–(700.5,540.5). The lesson recorded then was to write the
 * argument as **a pre-image checked against all four turns** rather than
 * extrapolated from one, so that is what this does.
 *
 * ## The fixture, and why it is not the obvious one
 *
 * A page that draws upright ink and declares `/Rotate 90` reads sideways, and a
 * measurement on it answers a question nobody asked. So each fixture draws the
 * SAME text at the SAME user-space position and differs only in `/Rotate`. The
 * pre-image — where the ink is in user space — is therefore identical across all
 * four, and any difference in the reported box is the frame moving rather than
 * the content.
 *
 * ## What is printed
 *
 * For each rotation: the raw box MuPDF reports, and the two candidate
 * conversions back to user space. Exactly one of them should return the known
 * user-space position on all four turns; the other will agree at 0 and diverge.
 * The script names which, and refuses to conclude if neither does.
 *
 * Run: node scripts/research/textFrames.mjs
 *
 * It prints readings, never a verdict.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import * as mupdf from 'mupdf';

import {
  fitzPoint,
  fromFitz,
  pageTransform,
  toPdf,
  viewportPoint,
} from '../../packages/shared/dist/index.js';
import {
  STEXT_OPTION_STRING,
  linesOf,
  parsePageText,
} from '../../packages/kernel/dist/textStructure.js';
import { SHARED_INDEX, TEXT_STRUCTURE, refuseStaleBuild } from '../lib/buildFreshness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// TWO EDGES, because this instrument reads the parse from one build and the
// coordinate conversion from another, and a stale `shared` would move the
// answer without touching the parser. Added by finding CCCCCC-4.
refuseStaleBuild(root, [...TEXT_STRUCTURE, ...SHARED_INDEX], 2);

/** A deliberately non-square page, so a swapped axis cannot hide. */
const PAGE = { width: 400, height: 700 };

/** Where the run is drawn, in PDF user space. The pre-image. */
const DRAWN = { x: 60, baseline: 600, size: 14 };

/** The text, chosen to be findable and to have no repeated substring. */
const TEXT = 'FRAME PROBE';

/**
 * One fixture: the same ink, one `/Rotate`.
 *
 * @param {number} rotation
 * @returns {Promise<Uint8Array>}
 */
async function fixture(rotation) {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE.width, PAGE.height]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(TEXT, { x: DRAWN.x, y: DRAWN.baseline, size: DRAWN.size, font });
  page.setRotation(degrees(rotation));
  return document.save();
}

/**
 * The line the SUBSTRATE reports for the probe text.
 *
 * Read through `parsePageText` and `linesOf` rather than by walking MuPDF's
 * JSON here. The first version of this did walk it, spelt the fields wrong and
 * reported that the text was absent — a second opinion about a format
 * `textStructure.ts` owns (B3a), producing the finding it was written to detect.
 * Going through the parser also means the numbers below are the ones a text
 * layer would actually be handed.
 *
 * @param {Uint8Array} bytes
 * @returns {{ box: { x0: number, y0: number, x1: number, y1: number },
 *             crop: readonly number[], rotation: number }}
 */
function probe(bytes) {
  const document = mupdf.PDFDocument.openDocument(bytes, 'application/pdf');
  if (!(document instanceof mupdf.PDFDocument)) throw new Error('not a PDF');
  try {
    const page = document.loadPage(0);
    const parsed = parsePageText(page.toStructuredText(STEXT_OPTION_STRING).asJSON());
    const line = linesOf(parsed).find((entry) => entry.text.includes(TEXT));
    if (line === undefined) {
      throw new Error(
        `the substrate does not report ${JSON.stringify(TEXT)} on this fixture, so there is no ` +
          'box to convert and every reading below would be about a missing line. It reported: ' +
          JSON.stringify(linesOf(parsed).map((entry) => entry.text)),
      );
    }
    const object = page.getObject();
    const media = object.getInheritable('MediaBox');
    const crop = [0, 1, 2, 3].map((at) => media.get(at).asNumber());
    const inherited = object.getInheritable('Rotate');
    return {
      box: {
        x0: line.box.topLeft.x,
        y0: line.box.topLeft.y,
        x1: line.box.bottomRight.x,
        y1: line.box.bottomRight.y,
      },
      crop,
      rotation: inherited.isNumber() ? inherited.asNumber() : 0,
    };
  } finally {
    document.destroy();
  }
}

/** Rounds for printing, so a floating-point tail does not read as a difference. */
const round = (/** @type {number} */ value) => Math.round(value * 100) / 100;

/**
 * Whether a converted rectangle lands on the drawn run.
 *
 * The test is the run's LEFT EDGE and its BASELINE, not the whole box: a line's
 * reported height includes the font's ascent and descent, which is a fact about
 * the font rather than about the frame, and requiring it to match would make
 * every candidate fail for a reason that is not the one under test.
 *
 * @param {{ x0: number, y0: number, x1: number, y1: number }} rect
 * @returns {boolean}
 */
function landsOnTheRun(rect) {
  const left = Math.min(rect.x0, rect.x1);
  const bottom = Math.min(rect.y0, rect.y1);
  const top = Math.max(rect.y0, rect.y1);
  // The baseline sits inside the box, between the descender and the ascender,
  // and the left edge is the drawn x within a point.
  return (
    Math.abs(left - DRAWN.x) < 2 &&
    bottom < DRAWN.baseline + 1 &&
    top > DRAWN.baseline &&
    top - bottom < DRAWN.size * 2
  );
}

async function main() {
  console.log('# Which frame MuPDF reports structured text in');
  console.log('');
  console.log(`  page ${String(PAGE.width)}×${String(PAGE.height)}pt, the run drawn at user ` +
    `(${String(DRAWN.x)}, ${String(DRAWN.baseline)}) at ${String(DRAWN.size)}pt`);
  console.log(`  repository: ${root}`);
  console.log('');
  console.log('  THE PRE-IMAGE IS THE SAME ON ALL FOUR: each fixture draws identical ink and');
  console.log('  differs only in /Rotate, so a moving box is the frame and not the content.');
  console.log('');

  /** @type {{ rotation: number, fromFitz: boolean, toPdf: boolean }[]} */
  const outcomes = [];

  for (const rotation of [0, 90, 180, 270]) {
    const bytes = await fixture(rotation);
    const { box, crop, rotation: declared } = probe(bytes);
    console.log(`## /Rotate ${String(rotation)}  (the file declares ${String(declared)})`);
    console.log(
      `  substrate box: (${String(round(box.x0))}, ${String(round(box.y0))})–` +
        `(${String(round(box.x1))}, ${String(round(box.y1))})`,
    );

    const transform = pageTransform(
      { x0: crop[0] ?? 0, y0: crop[1] ?? 0, x1: crop[2] ?? 0, y1: crop[3] ?? 0 },
      rotation,
      1,
    );

    // CANDIDATE A — the substrate's own type: FitzPoint, y flipped about the
    // crop box, rotation untouched.
    const a0 = fromFitz(fitzPoint(box.x0, box.y0), transform);
    const a1 = fromFitz(fitzPoint(box.x1, box.y1), transform);
    const viaFitz = { x0: a0.x, y0: a0.y, x1: a1.x, y1: a1.y };

    // CANDIDATE B — `flatFields.ts`' reading: MuPDF's device output is DISPLAY
    // space, so it is a viewport point at scale 1 and `toPdf` undoes the turn.
    const b0 = toPdf(viewportPoint(box.x0, box.y0), transform);
    const b1 = toPdf(viewportPoint(box.x1, box.y1), transform);
    const viaViewport = { x0: b0.x, y0: b0.y, x1: b1.x, y1: b1.y };

    const okFitz = landsOnTheRun(viaFitz);
    const okPdf = landsOnTheRun(viaViewport);
    console.log(
      `  fromFitz  → (${String(round(viaFitz.x0))}, ${String(round(viaFitz.y0))})–` +
        `(${String(round(viaFitz.x1))}, ${String(round(viaFitz.y1))})  ` +
        `${okFitz ? 'ON THE RUN' : 'elsewhere'}`,
    );
    console.log(
      `  toPdf     → (${String(round(viaViewport.x0))}, ${String(round(viaViewport.y0))})–` +
        `(${String(round(viaViewport.x1))}, ${String(round(viaViewport.y1))})  ` +
        `${okPdf ? 'ON THE RUN' : 'elsewhere'}`,
    );
    console.log('');
    outcomes.push({ rotation, fromFitz: okFitz, toPdf: okPdf });
  }

  console.log('## Which candidate survives all four turns');
  const fitzAll = outcomes.every((item) => item.fromFitz);
  const pdfAll = outcomes.every((item) => item.toPdf);
  console.log(`  fromFitz: ${outcomes.filter((i) => i.fromFitz).length} of 4`);
  console.log(`  toPdf:    ${outcomes.filter((i) => i.toPdf).length} of 4`);

  // THE CONTROL THIS COMPARISON NEEDS, and it is the unrotated row. If NEITHER
  // candidate lands at /Rotate 0 the fixture, the probe or the transform is
  // wrong and the three rotated rows say nothing about frames.
  const upright = outcomes.find((item) => item.rotation === 0);
  if (upright === undefined || (!upright.fromFitz && !upright.toPdf)) {
    throw new Error(
      'neither conversion lands on the run at /Rotate 0, where the two are arithmetically the ' +
        'same operation. So the fixture, the probe or the transform is wrong, and nothing above ' +
        'is a reading about rotation.',
    );
  }

  // AND THE OTHER DIRECTION: if BOTH survive all four, this instrument cannot
  // separate them and the contradiction it was written for is undecided.
  if (fitzAll && pdfAll) {
    throw new Error(
      'both conversions land on the run at every rotation, so this fixture does not separate ' +
        'them — the run is probably too near the page centre, or the page is square. The whole ' +
        'point is a fixture where the two differ.',
    );
  }
}

await main();
