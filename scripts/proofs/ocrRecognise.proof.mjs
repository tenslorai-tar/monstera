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

import { PDFDocument, PDFName, StandardFonts } from '@cantoo/pdf-lib';

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
 * The word drawn.
 *
 * All capitals, no descenders and no ambiguity between `l`, `1` and `I`: what
 * this file is about is the box, and a case that fails because the engine read
 * `MONSTERA` as `M0NSTERA` would be a coordinate proof reporting a recognition
 * result.
 */
const WORD = 'MONSTERA';

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
  // APPENDED RATHER THAN PUT FIRST, which is where it reads best: every label
  // above is indexed positionally by the case that asserts it, so inserting one
  // at the top would renumber eleven call sites for the sake of an ordering.
  'the core is the Tesseract the advisory register was triaged against',
]);

const roster = createRoster(failures, { cases: CASES.length });

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
 * Recognises page 0 of `bytes` through a real session.
 *
 * @param {Uint8Array} bytes
 * @param {{ page?: number, models?: string }} options
 */
async function recognise(bytes, options = {}) {
  const session = await mupdfWriter.open(bytes);
  try {
    return await recognisePage(session, {
      page: options.page ?? 0,
      language: 'eng',
      modelDirectory: options.models ?? MODELS,
    });
  } finally {
    await mupdfWriter.close(session);
  }
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
    CASES[11],
    version === CORE_VERSION,
    `the shipped core reports Tesseract ${JSON.stringify(version)} and the register was triaged ` +
      `against ${JSON.stringify(CORE_VERSION)}. Eight verdicts in ` +
      'docs/security/engine-advisories.json are about a crafted .traineddata parsed by THAT ' +
      'version; re-triage them and move this pin in the same commit. `bundledVersions` in the ' +
      'register cannot see this — it compares the libraries MuPDF vendors, and this engine is a ' +
      'WASM package.',
  );
  process.stdout.write(`  core Tesseract: ${version}\n\n`);

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
