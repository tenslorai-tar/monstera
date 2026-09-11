// @ts-check
/**
 * Recognition answers text, and answers it in the page's own coordinates.
 *
 * ## The case this file exists for is the COORDINATE one
 *
 * Tesseract answers in raster pixels, y-down from the top-left; a PDF content
 * stream is points, y-up from the displayed box's origin. `ocrRecognise.ts`
 * converts, and that conversion is the wired pair's stated blind spot — *where
 * the two halves speak different coordinate systems, it proves nothing until
 * something names both numbers in one place*.
 *
 * So the fixture draws one word at a **known, off-centre** point and requires
 * the returned box to contain it, **and** requires it not to contain the
 * y-mirrored point. The second half is what makes the first non-vacuous: on a
 * page whose text sits at the middle, a flipped y produces the same box, and
 * the case passes under either convention.
 *
 * ## It runs the real engine, not a stub
 *
 * There is nothing to stub. The question is whether this build's own conversion
 * is right about what Tesseract returns, and a fake Tesseract would be this file
 * asserting against its own idea of the answer.
 *
 * Usage: node scripts/proofs/ocrRecognise.proof.mjs
 *        MONSTERA_CORPUS=<directory> node scripts/proofs/ocrRecognise.proof.mjs
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PDFDocument, PDFName, StandardFonts, degrees } from '@cantoo/pdf-lib';

import { mupdfWriter } from '../../packages/kernel/dist/mupdfWriter.js';
import { loadedCore, recognisePage } from '../../packages/kernel/dist/ocrRecognise.js';
import { refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { corpusCaveat, openCorpus } from '../lib/corpus.mjs';
import { repoRoot } from '../lib/gitScope.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { tessdataDirectory } from '../provision/tessdata.mjs';

const ROOT = repoRoot();

refuseStaleBuild(
  ROOT,
  [
    ['packages/kernel/src/ocrRecognise.ts', 'packages/kernel/dist/ocrRecognise.js', 'tsc'],
    ['packages/kernel/src/pageBoxes.ts', 'packages/kernel/dist/pageBoxes.js', 'tsc'],
  ],
  2,
);

const MODELS = tessdataDirectory(ROOT);

/** The page the coordinate cases are taken on. */
const PAGE_WIDTH = 400;
const PAGE_HEIGHT = 300;

/**
 * Where the word is drawn, and it is deliberately NOT the middle.
 *
 * A word at the vertical centre has a box a flipped y reproduces exactly. This
 * one sits in the upper third, so the mirror is 100 points away — an order of
 * magnitude past any rounding in the raster.
 */
const DRAWN_X = 40;
const DRAWN_BASELINE = 230;
const DRAWN_SIZE = 28;

/**
 * Where the word sits on the quarter-turned page, and why not the same place.
 *
 * On a `/Rotate 90` page the word advances along user **+y**, so it needs room
 * above `ROTATED_Y` rather than to the right of an x — and it is placed where
 * **swapping its coordinates lands off the word**, so the control below is about
 * a box too big to separate an axis rather than about the defect's own reading.
 */
const ROTATED_X = 220;
const ROTATED_Y = 40;

/**
 * The second word's user x on a turned page — 90 points of clear space away.
 *
 * On `/Rotate 90` the reader's vertical axis is user **x**, so this is what
 * *further down the page* means here, and it is the separation the region case
 * needs: close enough to fit, far enough that a rectangle around one word cannot
 * catch the other by rounding.
 */
const SECOND_ROTATED_X = 130;

/**
 * The word drawn.
 *
 * All capitals, no descenders and no ambiguity between `l`, `1` and `I`: what
 * this file is about is the box, and a case that fails because the engine read
 * `MONSTERA` as `M0NSTERA` would be a coordinate proof reporting a recognition
 * result.
 */
const WORD = 'MONSTERA';

/**
 * The second word, and its baseline, for the region cases.
 *
 * Near the bottom of the page and as unmistakable as the first: what the region
 * cases assert is which of the two came back, so a pair a reader could confuse
 * would make a correct region look like a failed one.
 */
const SECOND_WORD = 'DELICIOSA';
const SECOND_BASELINE = 60;

/** @type {string[]} */
const failures = [];

/**
 * The Tesseract the shipped core actually is, read from it on 2026-09-11.
 *
 * **`tesseract.js-core@7.0.0` carries Tesseract 5.1.0-288-g2a9c1** — four minor
 * versions BEHIND the 5.5.2 MuPDF vendors, measured by calling
 * `TessBaseAPI.Version()` rather than inferred from the npm version.
 *
 * It is pinned here because `docs/security/engine-advisories.json` carries eight
 * verdicts reached **about this version** (the 2026-09-10 `.traineddata` class),
 * and the register's own version mechanism cannot see it: `bundledVersions`
 * compares MuPDF's vendored libraries, and this engine is a WASM package. So a
 * core bump would otherwise leave eight verdicts attached to code nobody ships —
 * exactly what that comparison exists to prevent for the DLL.
 */
const CORE_VERSION = '5.1.0-288-g2a9c1';

const CASES = /** @type {const} */ ([
  'a constructed page is recognised, and the word drawn on it comes back',
  'THE BOX IS IN PDF USER SPACE, containing the point the word was drawn at',
  'CONTROL: and it does NOT contain the y-mirrored point, which a flipped sign would',
  'every recognised word carries a box with area and a confidence',
  'the page confidence is a real reading rather than a zero',
  'A CROPBOX ORIGIN MOVES THE BOXES, which a page at the origin cannot show',
  'a page index outside the document is refused',
  'a model directory this process was not granted is refused, and says which kind of problem it is',
  'CONTROL: the granted directory is accepted, so the refusal above is not a constant',
  'every corpus page yields words rather than nothing',
  'CONTROL: and the confidence VARIES across them, so it is measuring the page',
  'A REGION READS ONLY WHAT IS INSIDE IT, on a page carrying two words',
  'CONTROL: and the whole page reads BOTH, so the region is what excluded one',
  'a region that lands off the page is refused rather than read as the whole of it',
  // APPENDED RATHER THAN PUT FIRST, which is where it reads best: every label
  // above is indexed positionally by the case that asserts it, so inserting one
  // at the top would renumber eleven call sites for the sake of an ordering.
  // APPENDED LAST, after the region cases, for the reason the comment below gave
  // when it was appended after the corpus ones: every label above is indexed
  // positionally, and inserting one renumbers the call sites.
  'the core is the Tesseract the advisory register was triaged against',
  'A ROTATED PAGE READS INTO THE PAGE’S OWN SPACE, not the raster’s',
  'CONTROL: and the box does NOT contain the point with its coordinates SWAPPED',
  'A REGION ON A ROTATED PAGE excludes the other word, which is the same fix the other way',
]);

/**
 * THE ANCHOR, PAID 2026-09-11 (finding FFFFFF-2).
 *
 * This read `cases: CASES.length`, which is audit item 4c in the direction the
 * rule warns about: **derive from a set only when the failure you fear makes that
 * set BIGGER.** The fear here is a case going quiet, which makes it smaller.
 *
 * Deleting a label alone is red, and deleting a call site alone is red. Deleting
 * **both** — which is what removing a case actually looks like — shrinks the two
 * sides together and the roster agrees, because both came from `CASES`. A literal
 * cannot agree, and that is the whole of it.
 *
 * `check:proofanchors` reported the derived form as anchored, because its rule is
 * *does this file declare a count*. It was not wrong; its question is one step
 * short of the property, so the file passed while carrying the shape the anchor
 * exists to remove. Written here one directory from
 * `blockEscapeResolvingWrites.proof.mjs`, which paid the identical debt eleven
 * commits earlier in the same range.
 *
 * **15, a literal, measured 2026-09-11 by running this file.** Adding a case is a
 * two-line diff — the label and this number — and removing one is red.
 */
const DECLARED_CASES = 18;

// AND THE LIST IS HELD TO THE SAME NUMBER, because the labels are indexed
// POSITIONALLY by the calls below: a label added without a call, or removed from
// under one, renames every case after it rather than reporting anything. The
// roster cannot see that — it counts calls — so the length is asserted here.
if (CASES.length !== DECLARED_CASES) {
  throw new Error(
    `${String(CASES.length)} case labels against ${String(DECLARED_CASES)} declared. The labels ` +
      'are indexed positionally, so a mismatch means every case after the change is reporting ' +
      'under the wrong name.',
  );
}

const roster = createRoster(failures, { cases: DECLARED_CASES });

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  roster.record(mark, label);
}

/**
 * A page carrying one word at a known point.
 *
 * @param {{ cropBox?: readonly number[] }} options
 * @returns {Promise<Uint8Array>}
 */
async function constructedPage(options = {}) {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(WORD, { x: DRAWN_X, y: DRAWN_BASELINE, size: DRAWN_SIZE, font });
  if (options.cropBox !== undefined) {
    page.node.set(PDFName.of('CropBox'), document.context.obj([...options.cropBox]));
  }
  return document.save();
}

/**
 * The same word on a page turned a quarter, **upright on screen**.
 *
 * Two halves, and only together are they the fixture this needs. `/Rotate 90`
 * turns the sheet, and the text is drawn rotated by the same quarter so that it
 * comes out horizontal in the raster — because a sideways word is one Tesseract
 * would simply fail to read, and a fixture that recognises nothing tests the
 * engine's tolerance rather than this build's arithmetic.
 *
 * `rotate: degrees(90)` means text space +x is user +y, so the word advances
 * UPWARD in user space from `(ROTATED_X, ROTATED_Y)` and its glyph bodies lie
 * between `ROTATED_X − DRAWN_SIZE` and `ROTATED_X`.
 *
 * @returns {Promise<Uint8Array>}
 */
async function rotatedPage() {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.setRotation(degrees(90));
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(WORD, {
    x: ROTATED_X,
    y: ROTATED_Y,
    size: DRAWN_SIZE,
    font,
    rotate: degrees(90),
  });
  return document.save();
}

/**
 * Two upright words on a quarter-turned page, far apart — the region fixture.
 *
 * **THE FIX WENT BOTH WAYS AND THE CASES WENT ONE**, which is the asymmetry this
 * closes: the rotation case above reads a box coming OUT of the raster, and a
 * region goes the other way, through the same matrix inverted. A page whose boxes
 * are right and whose regions are not is unrepresentable now — and *unrepresentable*
 * is a claim about the code that nothing in the file asserted until this fixture.
 *
 * The two words are separated along user **x**, because on a `/Rotate 90` page that
 * is the axis the reader sees as vertical: `SECOND_X` sits a clear 90 points below
 * `ROTATED_X` in display terms, which a region drawn around one of them excludes.
 *
 * @returns {Promise<Uint8Array>}
 */
async function rotatedTwoWordPage() {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  page.setRotation(degrees(90));
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const [text, x] of [
    [WORD, ROTATED_X],
    [SECOND_WORD, SECOND_ROTATED_X],
  ]) {
    page.drawText(String(text), {
      x: Number(x),
      y: ROTATED_Y,
      size: DRAWN_SIZE,
      font,
      rotate: degrees(90),
    });
  }
  return document.save();
}

/**
 * Recognises page 0 of `bytes` through a real session.
 *
 * @param {Uint8Array} bytes
 * @param {{ page?: number, models?: string, region?: [number, number, number, number] }} options
 */
async function recognise(bytes, options = {}) {
  const session = await mupdfWriter.open(bytes);
  try {
    return await recognisePage(session, {
      page: options.page ?? 0,
      language: 'eng',
      ...(options.region === undefined ? {} : { region: options.region }),
      modelDirectory: options.models ?? MODELS,
    });
  } finally {
    await mupdfWriter.close(session);
  }
}

/**
 * A page with one word near the top and a different one near the bottom.
 *
 * Two words far apart is what a region case needs: a rectangle over one of them
 * either excludes the other or the region does nothing, and those are the two
 * readings a fixture with one word cannot tell apart.
 *
 * @returns {Promise<Uint8Array>}
 */
async function twoWordPage() {
  const document = await PDFDocument.create();
  const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(WORD, { x: DRAWN_X, y: DRAWN_BASELINE, size: DRAWN_SIZE, font });
  page.drawText(SECOND_WORD, { x: DRAWN_X, y: SECOND_BASELINE, size: DRAWN_SIZE, font });
  return document.save();
}

/**
 * @param {readonly number[]} box
 * @param {number} x
 * @param {number} y
 */
function contains(box, x, y) {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = box;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/** @param {unknown} value */
function messageOf(value) {
  return value instanceof Error ? value.message : String(value);
}

try {
  process.stdout.write('# Recognition, and the frame its boxes come back in\n\n');

  // NO MODEL IS NOT A PASS, and it is not a failure either. A runner that
  // provisions nothing cannot look, and `CLAUDE.md`'s rule is that *could not
  // look* and *looked and found nothing* must not produce the same output. Every
  // case is recorded as not applicable and the run exits 0 — which is why the
  // `eng` model alone is provisioned on the board's Windows leg, 1,984,273
  // bytes, so the coordinate control runs somewhere other than a developer's
  // machine.
  if (!existsSync(join(MODELS, 'eng.traineddata.gz'))) {
    for (const label of CASES) roster.record(roster.mark(), label, false);
    process.stdout.write(
      `  no eng model under ${MODELS}, so nothing here can be measured. Run\n` +
        '  `node scripts/provision/tessdata.mjs --only=eng` to fetch the one this file needs.\n',
    );
    process.stdout.write(`\n${roster.format('recognition case')}`);
    process.exit(0);
  }

  const plain = await recognise(await constructedPage());
  const words = plain.lines.flatMap((line) => line.words);
  const found = words.find((word) => word.text.replace(/\W/gu, '') === WORD);

  check(
    CASES[0],
    found !== undefined,
    `the page was read as ${String(words.length)} word(s) and none of them is ${WORD}: ` +
      `[${words.map((word) => JSON.stringify(word.text)).join(', ')}]. Every case below reads ` +
      'that word, so this one failing makes the rest unverifiable rather than green.',
  );

  // The point tested is INSIDE the glyphs: a little right of the left edge and
  // a little above the baseline. Not a corner, which rounding can put on either
  // side of.
  const inside = { x: DRAWN_X + 10, y: DRAWN_BASELINE + 8 };
  const mirrored = { x: inside.x, y: PAGE_HEIGHT - inside.y };
  const box = found?.box ?? [0, 0, 0, 0];

  check(
    CASES[1],
    found !== undefined && contains(box, inside.x, inside.y),
    `the word's box is [${box.map((value) => value.toFixed(1)).join(', ')}] and it does not ` +
      `contain (${String(inside.x)}, ${String(inside.y)}), where the word was drawn. The page is ` +
      `${String(PAGE_WIDTH)}x${String(PAGE_HEIGHT)} and the raster is ${String(200)} dpi.`,
  );

  check(
    CASES[2],
    found !== undefined && !contains(box, mirrored.x, mirrored.y),
    `the word's box also contains (${String(mirrored.x)}, ${String(mirrored.y)}), the point the ` +
      'same distance from the other edge. A box that contains both is a box tall enough to make ' +
      'the case above pass whichever way the sign runs, so neither of them separates anything.',
  );

  const boxless = words.filter(
    (word) => word.box[2] <= word.box[0] || word.box[3] <= word.box[1] || word.confidence <= 0,
  );
  check(
    CASES[3],
    words.length > 0 && boxless.length === 0,
    `${String(boxless.length)} of ${String(words.length)} word(s) came back with an empty box or ` +
      'a confidence of zero. D6 rows 3, 4 and 6 all consume the geometry, so a word without one ' +
      'is a word those rows cannot place.',
  );

  check(
    CASES[4],
    plain.confidence > 0 && plain.confidence <= 100,
    `the page confidence is ${String(plain.confidence)}, which is outside 0 to 100 exclusive of ` +
      'zero. A zero here is what a page that recognised nothing also reports.',
  );

  // A CROPBOX WHOSE ORIGIN IS NOT ZERO. `toPixmap` rasterises the DISPLAYED
  // bounds, so pixel (0, 0) is that box's top-left rather than the sheet's, and
  // a conversion that forgot the origin puts every box 30 points out on x and
  // 20 on y — invisible on every fixture pdf-lib builds.
  const CROP = [30, 20, PAGE_WIDTH, PAGE_HEIGHT];
  const cropped = await recognise(await constructedPage({ cropBox: CROP }));
  const croppedWord = cropped.lines
    .flatMap((line) => line.words)
    .find((word) => word.text.replace(/\W/gu, '') === WORD);
  const croppedBox = croppedWord?.box ?? [0, 0, 0, 0];
  check(
    CASES[5],
    croppedWord !== undefined && contains(croppedBox, inside.x, inside.y),
    `with /CropBox [${CROP.join(' ')}] the word's box is ` +
      `[${croppedBox.map((value) => value.toFixed(1)).join(', ')}], which does not contain the ` +
      `point it is drawn at. The word did not move: the box the raster came from did.`,
  );

  let refusedIndex = '';
  try {
    await recognise(await constructedPage(), { page: 7 });
  } catch (error) {
    refusedIndex = messageOf(error);
  }
  check(
    CASES[6],
    /outside this document/u.test(refusedIndex),
    `a page index of 7 on a one-page document was answered with ${JSON.stringify(refusedIndex)}, ` +
      'where the refusal must name the document rather than failing later inside the engine.',
  );

  let refusedModels = '';
  try {
    // A DIRECTORY THAT EXISTS AND HOLDS NO MODEL, not a nonsense path: a path
    // that cannot exist is refused by the filesystem, and the two outcomes read
    // the same. This one separates "no grant" from "no such place".
    await recognise(await constructedPage(), { models: ROOT });
  } catch (error) {
    refusedModels = messageOf(error);
  }
  check(
    CASES[7],
    /provisioning or a grant problem/u.test(refusedModels),
    `a model directory holding no models was answered with ${JSON.stringify(refusedModels)}. The ` +
      'message has to say which kind of problem it is, because a recognition failure and a ' +
      'missing grant are answered by different people.',
  );

  check(
    CASES[8],
    plain.lines.length > 0,
    'the granted directory produced no lines, so the refusal above is what this build does for ' +
      'every directory and the case proves nothing.',
  );

  // ── D6 ROW 6: A REGION ────────────────────────────────────────────────────
  //
  // The rectangle is in PDF user space and `ocrRecognise.ts` converts it into the
  // raster's frame — the inverse of the conversion the box cases above assert, in
  // the same module because *where on the raster is this part of the page* has one
  // answer. A region over the upper word must exclude the lower one.
  const twoWords = await twoWordPage();
  const upper = { x0: 0, y0: DRAWN_BASELINE - 10, x1: PAGE_WIDTH, y1: DRAWN_BASELINE + 40 };
  const inRegion = await recognise(twoWords, {
    region: [upper.x0, upper.y0, upper.x1, upper.y1],
  });
  const regionText = inRegion.lines.map((line) => line.text).join(' ');
  check(
    CASES[11],
    regionText.includes(WORD) && !regionText.includes(SECOND_WORD),
    `a region over the upper word read ${JSON.stringify(regionText)}. It has to contain ` +
      `${WORD} and NOT ${SECOND_WORD}: a region that read both did nothing, and one that read ` +
      'neither was converted into the wrong part of the raster — the y-flip this module owns.',
  );

  const wholePage = await recognise(twoWords);
  const wholeText = wholePage.lines.map((line) => line.text).join(' ');
  check(
    CASES[12],
    wholeText.includes(WORD) && wholeText.includes(SECOND_WORD),
    `the same page read without a region answered ${JSON.stringify(wholeText)}. Without this the ` +
      'case above passes on a page whose lower word was never legible, which is a fixture ' +
      'problem reading as a working region.',
  );

  let offPage = '';
  try {
    await recognise(twoWords, { region: [PAGE_WIDTH + 50, 0, PAGE_WIDTH + 100, 20] });
  } catch (error) {
    offPage = messageOf(error);
  }
  check(
    CASES[13],
    /has no area on page/u.test(offPage),
    `a region entirely off the page answered ${JSON.stringify(offPage)}. Clamping it to the ` +
      'raster leaves a rectangle of no area, and recognising the whole page instead would be the ' +
      'widest possible answer to a request nothing on the page can satisfy.',
  );

  // THE ENGINE'S OWN VERSION, asked of the engine. `tesseract.js-core`'s npm
  // version says nothing about which Tesseract is inside it — 7.0.0 carries
  // 5.1.0 — and the advisory register's eight `.traineddata` verdicts were
  // reached about the answer below.
  const core = await loadedCore();
  const api = new core.TessBaseAPI();
  let version;
  try {
    version = api.Version();
  } finally {
    api.End();
  }
  check(
    CASES[14],
    version === CORE_VERSION,
    `the shipped core reports Tesseract ${JSON.stringify(version)} and the register was triaged ` +
      `against ${JSON.stringify(CORE_VERSION)}. Eight verdicts in ` +
      'docs/security/engine-advisories.json are about a crafted .traineddata parsed by THAT ' +
      'version; re-triage them and move this pin in the same commit. `bundledVersions` in the ' +
      'register cannot see this — it compares the libraries MuPDF vendors, and this engine is a ' +
      'WASM package.',
  );
  process.stdout.write(`  core Tesseract: ${version}\n\n`);

  // THE THIRD FRAME, added 2026-09-11 for finding FFFFFF-1. `toPixmap`
  // rasterises the page AS DISPLAYED, so on a `/Rotate 90` page the raster's axes
  // are transposed against the page's own space — and the conversion this replaced
  // read the displayed box in user space, which is correct for `/Rotate 0` and
  // wrong for every other value. Measured before the fix: 600x400 of raster
  // against a 400x600 frame, and a word near one edge converting to a coordinate
  // beyond the page's width.
  const turned = await recognise(await rotatedPage());
  const turnedWord = turned.lines
    .flatMap((line) => line.words)
    .find((word) => word.text.replace(/\W/gu, '') === WORD);
  const turnedBox = turnedWord?.box ?? [0, 0, 0, 0];
  // INSIDE THE GLYPHS on the turned page: a little along the advance, which is
  // user +y here, and a little into the bodies, which lie below ROTATED_X.
  const turnedInside = { x: ROTATED_X - 8, y: ROTATED_Y + 10 };
  check(
    CASES[15],
    turnedWord !== undefined && contains(turnedBox, turnedInside.x, turnedInside.y),
    `on a /Rotate 90 page the word's box is ` +
      `[${turnedBox.map((value) => value.toFixed(1)).join(', ')}], which does not contain ` +
      `(${String(turnedInside.x)}, ${String(turnedInside.y)}) where it was drawn. The page read ` +
      `as [${turned.lines.flatMap((line) => line.words).map((word) => JSON.stringify(word.text)).join(', ')}].`,
  );

  // WHAT THIS CONTROL DOES AND DOES NOT DO, because the first wording claimed
  // more than the measurement supports. Run against the conversion this replaced,
  // the case above fails with the box at [42.1, 79.3, 198.4, 100.9] — which does
  // not contain the swapped point either, so this control does not separate that
  // defect and no comment here should say it does. What it separates is a box big
  // enough to contain the point on EITHER axis, which would make the case above
  // pass whichever frame the conversion used — the same service `CASES[2]` does
  // for the flip on an unrotated page.
  check(
    CASES[16],
    turnedWord !== undefined && !contains(turnedBox, turnedInside.y, turnedInside.x),
    `the box also contains (${String(turnedInside.y)}, ${String(turnedInside.x)}), the same point ` +
      'with its coordinates swapped. A box containing both is one the case above passes for on ' +
      'the transposed axis as well, so it would separate nothing.',
  );

  // AND THE REGION, THE OTHER WAY THROUGH THE SAME MATRIX. The case above reads a
  // box coming out of the raster; this one puts a rectangle in. Both directions
  // were fixed together and only one had a case, which is the asymmetry that lets
  // a half-fix look whole.
  const turnedPair = await rotatedTwoWordPage();
  // A BAND ACROSS THE FIRST WORD ONLY, in user space: on this page the glyph
  // bodies of a word drawn at `x` occupy `x - DRAWN_SIZE` to `x`, and the two
  // words are 90 points apart, so a band around one cannot reach the other.
  const turnedRegion = await recognise(turnedPair, {
    region: [ROTATED_X - DRAWN_SIZE - 6, 0, ROTATED_X + 6, PAGE_HEIGHT],
  });
  const turnedRegionText = turnedRegion.lines.map((line) => line.text).join(' ');
  check(
    CASES[17],
    turnedRegionText.includes(WORD) && !turnedRegionText.includes(SECOND_WORD),
    `a region over one word of a /Rotate 90 page read ${JSON.stringify(turnedRegionText)}, and ` +
      `it has to contain ${WORD} and not ${SECOND_WORD}. Reading both means the rectangle did ` +
      'nothing; reading neither means it landed on the wrong part of the raster — which is what ' +
      'the conversion this replaced did on every rotated page.',
  );

  process.stdout.write('## The supplied corpus\n\n');
  const corpus = openCorpus();
  if (!corpus.available) {
    // RULE 3: an absent corpus is UNVERIFIABLE, never a pass.
    // NINE AND TEN, not *the rest*: the version case is appended after them and
    // does not need a corpus, so a bare `slice(9)` would record it as not
    // applicable on every machine without one — which is a case going quiet.
    for (const label of CASES.slice(9, 11)) roster.record(roster.mark(), label, false);
    process.stdout.write(`${corpus.outcome.text}\n`);
  } else {
    process.stdout.write('  id                 lines   words   confidence\n');
    /** @type {{ id: string, lines: number, words: number, confidence: number }[]} */
    const read = [];
    for (const item of corpus.documents) {
      const session = await mupdfWriter.open(item.bytes);
      try {
        const answer = await recognisePage(session, {
          page: 0,
          language: 'eng',
          modelDirectory: MODELS,
        });
        // A PAGE THIS BUILD CAN ALREADY READ IS NOT WHAT OCR IS FOR, and the
        // classification is `pageKindOf`'s rather than a second one here — so
        // this loop recognises everything and reports, and the case below asks
        // only about the pages that carry no text.
        const wordCount = answer.lines.reduce((total, line) => total + line.words.length, 0);
        read.push({
          id: item.id,
          lines: answer.lines.length,
          words: wordCount,
          confidence: answer.confidence,
        });
        process.stdout.write(
          `  ${item.id}${String(answer.lines.length).padStart(8)}` +
            `${String(wordCount).padStart(8)}${String(answer.confidence).padStart(13)}\n`,
        );
      } finally {
        await mupdfWriter.close(session);
      }
    }

    const silent = read.filter((entry) => entry.words === 0);
    check(
      CASES[9],
      read.length > 0 && silent.length === 0,
      `${String(silent.length)} of ${String(read.length)} corpus page(s) came back with no words ` +
        `at all: ${silent.map((entry) => entry.id).join(', ')}. A page this build cannot read a ` +
        'single word from is the case D6 row 2 exists for.',
    );

    // EVERY PAGE HERE IS READ WITH THE ENGLISH MODEL, including the
    // right-to-left document — the hardest fixture this row has. What that
    // asserts is not that the reading is good: it is that the wrong model
    // produces a LOW confidence rather than a crash, an empty answer or a
    // plausible number, which is the behaviour the language picker depends on.
    //
    // A SPREAD, not a floor. A set where every page reads at 94 is a set where
    // the confidence is not measuring the page, and a floor alone would be
    // satisfied by a constant. Both ends are asserted.
    const confidences = read.map((entry) => entry.confidence);
    const lowest = Math.min(...confidences);
    const highest = Math.max(...confidences);
    check(
      CASES[10],
      read.length >= 5 && lowest < 60 && highest > 90,
      `confidence across ${String(read.length)} document(s) runs ${String(lowest)} to ` +
        `${String(highest)}. Read with one model, a real corpus must produce both a good reading ` +
        'and a poor one — the corpus holds a right-to-left image-only document and the English ' +
        'model cannot read it well. A narrow spread means the number is not about the page.',
    );

    process.stdout.write(`\n${corpusCaveat(corpus.documents.length)}\n`);
  }

  if (failures.length > 0) {
    process.stderr.write(
      `\nRecognition — ${String(failures.length)} failure(s):\n\n` +
        failures.map((failure) => `  - ${failure}`).join('\n\n') +
        '\n\n',
    );
    process.exit(1);
  }

  process.stdout.write(`\n${roster.format('recognition case')}`);
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
