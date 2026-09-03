// @ts-check
/**
 * ADR-0006's row 1, executed: *"`page.render({ canvas, viewport })` renders a
 * rotated, cropped page correctly; the four runtime asset dirs resolve"*.
 *
 * ## What was already proven, and what this adds
 *
 * `proof:canvaspixels` renders one upright A4 page and counts what was drawn.
 * That establishes the render path exists and produces ink, which is the clause
 * D1's render row rests on. It says nothing about the two properties the spike's
 * row names, and both are ones a wrong implementation gets wrong silently:
 *
 * - **Rotation.** A page carrying `/Rotate 90` must come out landscape. A
 *   renderer that ignores it draws a correct-looking portrait page, and every
 *   pixel count agrees.
 * - **The crop box.** A page with a `/CropBox` smaller than its `/MediaBox`
 *   must render the crop. A renderer using the MediaBox draws MORE of the
 *   document, which looks like a page rather than like a defect.
 *
 * Both are read as the canvas's SIZE, which is the one observation that
 * separates them: the fixtures are 400x600, so a rotation shows as 600x400 and
 * the crop as 200x300. A square page or a crop at the origin would make either
 * reading agree with the bug (checklist 4's *never build a fixture the bug also
 * handles correctly*).
 *
 * ## The four runtime asset directories, answered rather than asserted
 *
 * The spike's environment note says pdfjs-dist ships `wasm/`, `cmaps/`,
 * `standard_fonts/` and `iccs/`, that each needs a URL, and that a missing one
 * **silently degrades**. This build sets none of them, and two of the four are
 * already settled in `documentView.ts` against invariant 27's CSP: `useWasm` is
 * off and ICC is unreachable because `connect-src 'none'` refuses the fetch.
 *
 * That leaves `standard_fonts/` and `cmaps/`, and the honest way to close them
 * is to render a document that needs one. The last case here draws text in a
 * NAMED, NON-EMBEDDED Helvetica — the case `standardFontDataUrl` exists for —
 * and reports what the shipped renderer produced. It is written to record the
 * measurement rather than to assume it: if the glyphs are there the directory is
 * not needed on this path, and if they are not, the reading is the finding.
 *
 * Usage: node scripts/proofs/renderGeometry.proof.mjs
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANVAS_PIXELS_RUNTIME, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { HARNESS, controlName, readback } from '../lib/canvasReadback.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import {
  CROP_HEIGHT,
  CROP_WIDTH,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  buildRenderGeometryFixtures,
} from '../lib/renderGeometryFixtures.mjs';
import { partialOutcome } from '../lib/unverifiable.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The key whose English value names the start screen's Open control. */
const OPEN_KEY = 'command.open-document.title';

/** The key whose English value names the quick toolbar's zoom-in control. */
const ZOOM_IN_KEY = 'command.zoom-in.title';

/**
 * The floor a drawn page's painted count must clear.
 *
 * A tenth of the canvas, matching `canvasPixels.proof.mjs`: what these cases
 * reject is *nothing was drawn*, and a threshold pinned to a measured coverage
 * is one that goes red the day a renderer antialiases an edge. The counts are
 * printed on every run, so drift toward the floor is visible long before it
 * fails.
 */
const PAINTED_FLOOR_FRACTION = 0.1;

const ELECTRON_BINARY = electronBinaryPath(REPO_ROOT);
const RUNTIME_PRESENT = existsSync(ELECTRON_BINARY) && existsSync(HARNESS);

/** @type {string[]} */
const failures = [];

/**
 * The cases that need a runtime, named ONCE — the count, the UNVERIFIABLE
 * listing, and what the runtime branch is checked against.
 */
const RUNTIME_CASES = [
  'CONTROL: the upright page renders at its own MediaBox, so a size means something here',
  'the upright page CARRIES INK, so the sizes below are read off a page that drew',
  'a /Rotate 90 page renders LANDSCAPE, which is the renderer honouring the page tree',
  'the rotated page carries ink too, so the swap is not a resized blank',
  'a /CropBox smaller than the MediaBox renders THE CROP, not the whole page',
  'the cropped page carries ink, so the smaller canvas is a page and not an empty one',
  'a page whose only ink is a NAMED, NON-EMBEDDED standard font draws glyphs',
];

/** Cases decidable without a runtime. These run on every machine. */
const STRING_CASES = 1;

const roster = createRoster(failures, {
  cases: RUNTIME_PRESENT ? STRING_CASES + RUNTIME_CASES.length : STRING_CASES,
});

/** @type {string[]} */
const recorded = [];

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  recorded.push(label);
  roster.record(mark, label);
}

try {
  const name = controlName(OPEN_KEY);
  const zoomName = controlName(ZOOM_IN_KEY);
  const fixtures = await buildRenderGeometryFixtures({ root: REPO_ROOT });

  check(
    'the three geometry fixtures exist and are the ones this proof describes',
    [fixtures.upright, fixtures.rotated, fixtures.cropped, fixtures.standardFont].every((path) =>
      existsSync(path),
    ),
    `one of the generated fixtures is missing after the builder ran:\n      ` +
      `${Object.values(fixtures).join('\n      ')}\n      ` +
      `Every case below is a statement about what the renderer did with these documents, so a ` +
      `missing one would be a proof about nothing.`,
  );

  if (!RUNTIME_PRESENT) {
    // The string case above has run, so the BLANK marker would be false here.
    // Through `unverifiable.mjs`, which owns both tokens (B3a).
    const partial = partialOutcome({
      required: false,
      ran: STRING_CASES,
      missed: RUNTIME_CASES,
      why:
        `${existsSync(ELECTRON_BINARY) ? 'The harness' : 'The Electron runtime'} is missing:\n` +
        `    ${existsSync(ELECTRON_BINARY) ? HARNESS : ELECTRON_BINARY}\n  Run ` +
        `\`npm run provision:electron\` and \`npm run build\`.\n\n  These are the only cases ` +
        `that read the rotation and the crop, and both are properties a wrong renderer gets ` +
        `wrong SILENTLY — the page looks like a page either way.`,
      flag: '--require-runtime',
    });
    process.stdout.write(`${roster.format('render-geometry case')}${partial.text}`);
    process.exit(failures.length > 0 ? 1 : 0);
  }

  // The same edge list `canvasPixels.proof.mjs` names, for the same reason: these
  // cases read pixels the Vite build produced, so a `typecheck` that did not
  // rebuild would have them passing about the previous shell.
  refuseStaleBuild(REPO_ROOT, CANVAS_PIXELS_RUNTIME, 6);

  const upright = readback(ELECTRON_BINARY, name, fixtures.upright, zoomName);
  const rotated = readback(ELECTRON_BINARY, name, fixtures.rotated, zoomName);
  const cropped = readback(ELECTRON_BINARY, name, fixtures.cropped, zoomName);
  const fonted = readback(ELECTRON_BINARY, name, fixtures.standardFont, zoomName);

  /** @param {{ width: number, height: number }} seen */
  const size = (seen) => `${String(seen.width)}x${String(seen.height)}`;
  /** @param {{ painted: number, width: number, height: number }} seen */
  const floor = (seen) => Math.floor(seen.width * seen.height * PAINTED_FLOOR_FRACTION);

  check(
    'CONTROL: the upright page renders at its own MediaBox, so a size means something here',
    upright.width === PAGE_WIDTH && upright.height === PAGE_HEIGHT,
    `the upright fixture is ${String(PAGE_WIDTH)}x${String(PAGE_HEIGHT)} and rendered at ` +
      `${size(upright)}.\n      ` +
      `THIS IS THE CONTROL FOR THE TWO CASES BELOW. They read a rotation and a crop as a ` +
      `canvas SIZE, and a size only carries that meaning if the plain case produces the plain ` +
      `answer — a renderer that always drew 600x400 would satisfy the rotation case exactly.`,
  );

  check(
    'the upright page CARRIES INK, so the sizes below are read off a page that drew',
    upright.painted > floor(upright) && upright.blank === 0,
    `${String(upright.painted)} painted of ${String(upright.pixels)}; blank control ` +
      `${String(upright.blank)}; settled by "${upright.settledBy}".`,
  );

  check(
    'a /Rotate 90 page renders LANDSCAPE, which is the renderer honouring the page tree',
    rotated.width === PAGE_HEIGHT && rotated.height === PAGE_WIDTH,
    `the fixture is ${String(PAGE_WIDTH)}x${String(PAGE_HEIGHT)} with /Rotate 90, so a reader ` +
      `honouring it draws ${String(PAGE_HEIGHT)}x${String(PAGE_WIDTH)}; this rendered ` +
      `${size(rotated)}.\n      ` +
      `${size(upright)} here means the rotation was IGNORED — which draws a page that looks ` +
      `perfectly correct and is sideways, and which no pixel count can see.`,
  );

  check(
    'the rotated page carries ink too, so the swap is not a resized blank',
    rotated.painted > floor(rotated) && rotated.blank === 0,
    `${String(rotated.painted)} painted of ${String(rotated.pixels)}; blank control ` +
      `${String(rotated.blank)}; settled by "${rotated.settledBy}".\n      ` +
      `Setting a canvas's width clears it, so a renderer that sized the backing store from the ` +
      `rotated viewport and then failed to draw produces exactly the dimensions asserted above.`,
  );

  check(
    'a /CropBox smaller than the MediaBox renders THE CROP, not the whole page',
    cropped.width === CROP_WIDTH && cropped.height === CROP_HEIGHT,
    `the fixture's CropBox is ${String(CROP_WIDTH)}x${String(CROP_HEIGHT)} inside a ` +
      `${String(PAGE_WIDTH)}x${String(PAGE_HEIGHT)} MediaBox, at a NON-ZERO origin; this ` +
      `rendered ${size(cropped)}.\n      ` +
      `${size(upright)} means the MediaBox was used, which shows the reader more of the ` +
      `document than its author published — and looks like a page rather than like a defect.`,
  );

  check(
    'the cropped page carries ink, so the smaller canvas is a page and not an empty one',
    cropped.painted > floor(cropped) && cropped.blank === 0,
    `${String(cropped.painted)} painted of ${String(cropped.pixels)}; blank control ` +
      `${String(cropped.blank)}; settled by "${cropped.settledBy}".`,
  );

  check(
    'a page whose only ink is a NAMED, NON-EMBEDDED standard font draws glyphs',
    fonted.painted > 0 && fonted.blank === 0 && !fonted.renderFailed,
    `${String(fonted.painted)} painted of ${String(fonted.pixels)}; blank control ` +
      `${String(fonted.blank)}; settled by "${fonted.settledBy}"; renderFailed ` +
      `${String(fonted.renderFailed)}.\n      ` +
      `THIS IS THE spike's "the four runtime asset dirs resolve", ASKED WHERE IT BITES. The ` +
      `document names Helvetica and embeds nothing, so the glyph outlines have to come from ` +
      `pdfjs-dist's own \`standard_fonts/\` — which this build sets no URL for. Zero painted ` +
      `pixels here is that directory being needed and absent, and it is a SILENT degradation: ` +
      `the page renders, the parse succeeds, and the text is missing.\n      ` +
      `A floor of ZERO rather than a fraction, deliberately: text covers a few percent of a ` +
      `page, so the fraction the other cases use would reject a page that drew perfectly.`,
  );

  const ran = recorded.slice(STRING_CASES);
  if (ran.length !== RUNTIME_CASES.length || ran.some((label, at) => label !== RUNTIME_CASES[at])) {
    throw new Error(
      `RUNTIME_CASES does not describe the runtime branch.\n  declared:\n    ` +
        `${RUNTIME_CASES.join('\n    ')}\n  ran:\n    ${ran.join('\n    ')}\n` +
        `That list is what a machine WITHOUT a runtime prints as its account of what could not ` +
        `be evaluated. A wrong account there is worse than no account, because it reads as ` +
        `rigour.`,
    );
  }

  process.stdout.write(
    failures.length > 0
      ? `${failures.length} render-geometry failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
      : `${roster.format('render-geometry case')}` +
          `  upright  ${size(upright)}  ${String(upright.painted)} painted\n` +
          `  rotated  ${size(rotated)}  ${String(rotated.painted)} painted\n` +
          `  cropped  ${size(cropped)}  ${String(cropped.painted)} painted\n` +
          `  standard font  ${size(fonted)}  ${String(fonted.painted)} painted\n`,
  );
  process.exit(failures.length > 0 ? 1 : 0);
} catch (error) {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
}
