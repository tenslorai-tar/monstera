// @ts-check
/**
 * Proves the renderer's canvas carries the pixels of a real page, drawn by the
 * shipped code, from bytes that crossed the real channel.
 *
 * ## The defect this exists to make impossible
 *
 * A canvas element that mounts, receives a page and draws **nothing** passes
 * every other test in this repository. `renderPage.test.ts` runs against a
 * browser shim with no canvas implementation; `App.test.tsx` asserts the element
 * is in the tree; `proof:rendererpolicy` asserts the React shell mounted. All
 * three stay green for a renderer that shows a blank rectangle, and *"shows page
 * 1"* is the sentence the render clause rests on. §10.4's wired-tools rule names
 * that shape by hand — a control that renders and does nothing, wearing a green
 * check — and the pixels are the only observation that separates it.
 *
 * ## Everything under test is shipped, and the exception is named
 *
 * The harness makes the same three calls `entry.ts` and `main.ts` make, in the
 * same order, against the default session: `createShellDependencies`,
 * `createMainWindow`, `registerContractHandlers`. So the window's preferences,
 * its CSP, its preload, the channel schemas, `DocumentService`, the range
 * handler, the Vite bundle, `documentTransport`, `documentView` and `renderPage`
 * are all the artefacts the product runs.
 *
 * The one substitution is `PickDocument` — a function returning `string | null`,
 * which is the seam `documentPicker.ts` was split across for exactly this
 * reason. Electron's file dialog cannot be driven from a proof. That is the
 * whole of what this does not cover, and it is covered elsewhere rather than
 * left implicit: `docs/FEATURES.md`'s open row carries a run-and-record gate for
 * the dialog itself.
 *
 * ## The control, and why its DIRECTION is the interesting part
 *
 * The reassuring answer here is a **hit** — a large pixel count — not a silence,
 * so a positive control of the usual shape does nothing for it. A counter that
 * returns a big number for anything at all produces exactly the result this
 * proof was hoping for. The separating control is therefore the other way round:
 * the same expression, run against a canvas of the same size that has been
 * painted white, must return **zero**. White rather than untouched, because a
 * blank PDF page is white and an untouched canvas is transparent black — a
 * control that passes because the thing it stands in for is a different colour
 * proves nothing about the measurement beside it.
 *
 * Usage: node scripts/proofs/canvasPixels.proof.mjs
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANVAS_PIXELS_RUNTIME, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { controlName, readback } from '../lib/canvasReadback.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { partialOutcome } from '../lib/unverifiable.mjs';
import { buildLargeFixture } from '../perf/largeFixture.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// `HARNESS` and the readback marker live in `lib/canvasReadback.mjs` with the
// runner that uses them.
const HARNESS = join(REPO_ROOT, 'apps', 'desktop', 'dist', 'canvasHarnessMain.js');

/** The key whose English value names the start screen's Open control. */
const OPEN_KEY = 'command.open-document.title';

/** The key whose English value names the quick toolbar's zoom-in control. */
const ZOOM_IN_KEY = 'command.zoom-in.title';

/**
 * The document the substituted picker returns.
 *
 * ## BUILT, not read from disk — and CI is what proved that necessary
 *
 * This named `packages/testing/fixtures/generated/perf-baseline.pdf` directly,
 * which exists on a machine that has run the performance gate and on **no
 * runner**: that whole directory is gitignored, because a 62 kB PDF is a binary
 * and B10 does not commit those. So the proof passed here and failed on both
 * matrix legs at its first case — the developed-in world being the richer one,
 * which is the world that hides the defect (CLAUDE.md item 3's second half).
 *
 * `buildLargeFixture` is the writer of record for what a fixture PDF is, it
 * caches on its own generator's digest, and `documentHandlers.proof.mjs`
 * already calls it for exactly this reason. Calling it is B3a; writing a second
 * small-PDF emitter here would have been the second opinion.
 *
 * ## The shape of it is load-bearing rather than convenient
 *
 * One page whose entire content is a 144x144 uncompressed `DeviceRGB` image
 * scaled across the full 595x842 MediaBox. No font programme, no standard font
 * data — which PDF.js fetches over a seam `connect-src 'none'` refuses — and no
 * WebAssembly decoder. Every pixel it produces comes from bytes that crossed
 * `document.readRange`.
 *
 * A text fixture would have made this proof's failure mode "a font did not
 * arrive", which is a different finding wearing this one's clothes.
 *
 * The arguments are `budgetGate.mjs`'s for the same name, so the two share one
 * cached artefact instead of overwriting each other's.
 */
function buildFixture() {
  return buildLargeFixture({
    root: REPO_ROOT,
    targetBytes: 64 * 1024,
    pages: 1,
    name: 'perf-baseline.pdf',
  }).path;
}

/**
 * The canvas size {@link FIXTURE} must produce, in device pixels.
 *
 * Read from the fixture's own `/MediaBox [0 0 595 842]` — an A4 page — which
 * `page.getViewport({ scale: 1 })` turns into 595x842 and `renderPage` ceils
 * onto the canvas. So this is derived from the document rather than from a run,
 * which is what makes it an assertion instead of a record of what happened.
 *
 * It replaced `width > 300 && height > 150` — "not the element's default" — and
 * the reason is that the default is a legitimate size for some page, so that
 * comparison is a statement about this fixture pretending to be a general one.
 * If the fixture is ever replaced, this figure moves with it.
 */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

/**
 * The floor the painted count must clear.
 *
 * MEASURED, not modelled: the fixture covers the whole page with an image, and
 * this proof's own output on 2026-08-29 reads
 * `drew 500990 of 500990 pixels (100.00%) at 595x842 in 841ms; blank control 0`
 * — Windows 11, Electron 43.4.1, pdfjs-dist 6.2.108. The floor is set at a tenth
 * of the page rather than at that figure: what this case exists to reject is
 * *nothing was drawn*, and a threshold pinned to a full-coverage reading is one
 * that goes red the day the fixture changes or a renderer antialiases an edge.
 *
 * The count itself is reported on every run, so a drift from 99.95% toward the
 * floor is visible long before it fails.
 */
const PAINTED_FLOOR_FRACTION = 0.1;

/**
 * The zoom the harness drives to, and how many clicks reach it.
 *
 * **Both numbers are the shipped ladder's, not this file's.** `ZOOM_STEPS` is
 * `[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]` and a document opens at 1, so three
 * clicks of the zoom-in control land on 2 — a whole number, so the expected
 * canvas is an exact doubling rather than a rounding, and the assertion can be
 * `595 * 2` rather than a tolerance.
 *
 * `canvasHarness.ts` holds the same click count, because it is what performs
 * the clicks. That is a second copy and it is deliberate: neither file can
 * import the renderer's module, and a ladder that changes lands on some other
 * zoom, which comes back as a canvas size this proof names against the size it
 * expected. The copy fails loudly rather than silently, in the one direction
 * that matters.
 */
const ZOOM_TARGET = 2;
const ZOOM_CLICKS = 3;

const ELECTRON_BINARY = electronBinaryPath(REPO_ROOT);
const RUNTIME_PRESENT = existsSync(ELECTRON_BINARY) && existsSync(HARNESS);

/** @type {string[]} */
const failures = [];

/**
 * The cases that need a runtime, named ONCE.
 *
 * This list is the count, the UNVERIFIABLE listing, and the thing the runtime
 * branch is checked against — the shape `rendererPolicy.proof.mjs` arrived at
 * after its own block claimed eight of nine and called it nine.
 */
const RUNTIME_CASES = [
  'the shipped Open control is on the start screen, under the name a user reads',
  "the canvas is sized to the PAGE'S OWN box, which is renderPage reading a viewport",
  'the canvas CARRIES A DRAWN PAGE, which is what shows-page-1 means',
  'CONTROL: the same counter reports ZERO for a blank canvas of the same size',
  'CONTROL: a canvas this renderer FILLS and copies, as renderPage presents, is counted WHOLE',
  'CONTROL: a BITMAP made as PDF.js makes an image’s, drawn scaled across the page, is counted WHOLE',
  'CONTROL: the same bitmap made in a WORKER and posted to the page, as PDF.js’s worker posts one, is counted WHOLE',
  'the shipped zoom-in control was found and clicked, so the zoom reading means something',
  'the canvas is EXACTLY the page at the zoom, which is the rasteriser honouring the scale',
  'the zoomed canvas CARRIES A DRAWN PAGE, so the bigger bitmap is not a stretched empty one',
  'the window shows the CONTROLS OVERLAY, and leaves the menu bar a narrower area than the window',
  'the ground is read with NO DIALOG over the page, the state the controls sit on in use',
  'main PAINTED the overlay in a colour the page shows beneath the controls, read off the same running window',
  'CONTROL: the span beneath the controls REFUSES the overlay’s symbol colour, so a pass above means something',
  "the overlay SETTLES at the menu bar's own height, so the two do not grow each other",
];

/** Cases decidable without a runtime. These run on every machine. */
const STRING_CASES = 3;

const roster = createRoster(failures, {
  cases: RUNTIME_PRESENT ? STRING_CASES + RUNTIME_CASES.length : STRING_CASES,
});

/** @type {string[]} */
const recorded = [];

/**
 * Whether `hex` lies within `span` on every channel: a colour the page itself shows somewhere in the rectangle.
 *
 * @param {string} hex `#rrggbb`
 * @param {{ low: readonly number[], high: readonly number[] }} span
 */
function withinSpan(hex, span) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (match === null) return false;
  return [match[1], match[2], match[3]].every((pair, channel) => {
    const value = Number.parseInt(pair ?? '', 16);
    return value >= (span.low[channel] ?? 256) && value <= (span.high[channel] ?? -1);
  });
}

/**
 * What a canvas reading held and what the run's surroundings did, for a failure message.
 *
 * A page canvas at its page's size with no ink has drawn and presented, because `renderPage` sizes it only in the
 * step that copies a finished drawing onto it. So the question a failure leaves is which of two things the copy
 * held, and the tally answers it: WHITE is PDF.js having drawn the page's ground and not what is on it; TRANSPARENT
 * is a copy or a readback holding nothing, which the ink control then says of this renderer's canvas in general.
 * The two controls' readings go beside it, so the page's own line says which path held ink in the same run.
 *
 * @param {{ transparent: number, white: number, painted: number } | null} tally
 * @param {ReturnType<typeof readback>['environment']} environment
 * @param {Pick<ReturnType<typeof readback>, 'ink' | 'bitmapInk' | 'workerBitmapInk' | 'pixels'>} controls
 */
function describeRun(tally, environment, controls) {
  const counted =
    tally === null
      ? 'no canvas or no 2d context to tally'
      : `${String(tally.transparent)} transparent, ${String(tally.white)} white, ${String(tally.painted)} inked`;
  return (
    `tally: ${counted}.\n      ` +
    `controls of ${String(controls.pixels)}: copied ink ${String(controls.ink)}, bitmap ink ` +
    `${String(controls.bitmapInk)}, worker bitmap ink ${String(controls.workerBitmapInk)}.\n      ` +
    `renderer: visibility ${environment.visibility}; 2d_canvas ${environment.gpu.canvas2d}, gpu_compositing ` +
    `${environment.gpu.gpuCompositing}, rasterization ${environment.gpu.rasterization}; processes gone ` +
    `${JSON.stringify(environment.processesGone)}; render process gone ${JSON.stringify(environment.renderProcessGone)}.` +
    `\n      renderer warnings and errors: ${JSON.stringify(environment.console)}.`
  );
}

/** @param {string} label @param {boolean} condition @param {string} detail */
function check(label, condition, detail) {
  const mark = roster.mark();
  if (!condition) failures.push(`${label}\n      ${detail}`);
  recorded.push(label);
  roster.record(mark, label);
}

// `controlName` and `readback` moved to `scripts/lib/canvasReadback.mjs` when
// `renderGeometry.proof.mjs` became a second caller. Both drive the same
// harness with the same display handling and read the same marker; the two
// proofs differ in what they ASK, not in how the question is put (B3a).

try {
  // ---------------------------------------------------------------------------
  // Decidable without a runtime. Runs everywhere.
  // ---------------------------------------------------------------------------
  const name = controlName(OPEN_KEY);
  const zoomName = controlName(ZOOM_IN_KEY);

  // BUILT BEFORE THE CASE THAT CHECKS IT, so the case is about what the
  // generator produced rather than about whether somebody had run the
  // performance gate on this machine. That distinction is the whole of what
  // reddened both matrix legs at 46115e9.
  const fixture = buildFixture();

  check(
    'the fixture this proof renders exists and is the one it describes',
    existsSync(fixture) && statSync(fixture).size > 0,
    `${fixture} is missing or empty after the generator ran. The whole measurement is about the ` +
      `pixels this document produces, so a proof that could not find it must say so rather than ` +
      `report a renderer that drew nothing.`,
  );

  check(
    'the Open control has a name in the shipped catalogue, so there is something to click',
    name.length > 0,
    `the catalogue resolved "${name}" for "${OPEN_KEY}". An empty name would be handed to the ` +
      `harness, which would find no control and report the render clause broken — a reader ` +
      `failure wearing the finding's clothes.`,
  );

  check(
    'the zoom-in control has a name too, so the zoom half has something to click',
    zoomName.length > 0 && zoomName !== name,
    `the catalogue resolved "${zoomName}" for "${ZOOM_IN_KEY}" against "${name}" for ` +
      `"${OPEN_KEY}".\n      ` +
      `THE SECOND HALF IS WHY THIS IS NOT A COPY OF THE CASE ABOVE. The harness clicks by ` +
      `name, so two controls sharing one name would make the zoom phase click whichever came ` +
      `first in the document — and if that were the Open control, the zoom reading would be ` +
      `taken after three clicks that did nothing, which is indistinguishable from a renderer ` +
      `that ignores the zoom.`,
  );

  // ---------------------------------------------------------------------------
  // The runtime. PARTLY MEASURED rather than passed when it cannot run.
  // ---------------------------------------------------------------------------
  if (!RUNTIME_PRESENT) {
    // The string cases above have run, so the BLANK marker would be false here.
    // Through `unverifiable.mjs`, which owns both tokens (B3a).
    const partial = partialOutcome({
      required: false,
      ran: STRING_CASES,
      missed: RUNTIME_CASES,
      why:
        `${existsSync(ELECTRON_BINARY) ? 'The harness' : 'The Electron runtime'} is missing:\n` +
        `    ${existsSync(ELECTRON_BINARY) ? HARNESS : ELECTRON_BINARY}\n  Run ` +
        `\`npm run provision:electron\` and \`npm run build\`.\n\n  These are the only evidence ` +
        `that the render clause's UI half does anything at all — every other test of it stays ` +
        `green for a canvas that draws nothing.`,
      flag: '--require-runtime',
    });
    process.stdout.write(`${roster.format('canvas-pixel case')}${partial.text}`);
  } else {
    // Everything the harness executes, and the renderer bundle is the point of
    // the list: these cases read pixels the Vite build produced, so a `typecheck`
    // that did not rebuild it would have them passing about the previous shell.
    // THE LIST MOVED to `buildFreshness.mjs` and the COUNT stayed here
    // (PPPPP-2): `affectedProofs.mjs` reads the same edges, because a build is
    // a dependency it could not see and a copy there would be a second opinion.
    refuseStaleBuild(REPO_ROOT, CANVAS_PIXELS_RUNTIME, 6);

    const seen = readback(ELECTRON_BINARY, name, fixture, zoomName);
    const floor = Math.floor(seen.pixels * PAINTED_FLOOR_FRACTION);

    check(
      'the shipped Open control is on the start screen, under the name a user reads',
      seen.dispatched,
      `no button named "${name}" was found in the rendered start screen. The screen is a ` +
        `projection of the command registry, so this is either a command that failed to ` +
        `register or a catalogue whose English text has moved — and the harness clicks by ` +
        `NAME rather than by a test id precisely so that a control a user cannot identify is ` +
        `a failure here.\n      ` +
        `THIS CASE CLAIMS THE CONTROL EXISTS AND WAS CLICKED, and deliberately not that it ` +
        `dispatched: a button whose handler returns immediately is clicked just as ` +
        `successfully as one that opens a document. What observes the dispatch is the two ` +
        `cases below — no canvas at all is what a control dispatching into the void produces, ` +
        `which is §10.4's display-only sin and the reason the label was narrowed.`,
    );

    check(
      "the canvas is sized to the PAGE'S OWN box, which is renderPage reading a viewport",
      seen.width === PAGE_WIDTH && seen.height === PAGE_HEIGHT,
      `the canvas measured ${String(seen.width)}x${String(seen.height)} where the fixture's ` +
        `MediaBox gives ${String(PAGE_WIDTH)}x${String(PAGE_HEIGHT)}; it settled by ` +
        `"${seen.settledBy}" after ${String(seen.elapsedMs)}ms (renderFailed=` +
        `${String(seen.renderFailed)}).\n      ` +
        `300x150 is what an HTMLCanvasElement is before anything sizes it, so those dimensions ` +
        `mean \`renderPage\` never read a viewport and the parse did not reach it. Any OTHER ` +
        `size means the viewport was read and disagrees with the document — which is the ` +
        `coordinate defect \`PageTransform\` exists for, not a drawing one.`,
    );

    check(
      'the canvas CARRIES A DRAWN PAGE, which is what shows-page-1 means',
      seen.settledBy === 'drawn' && seen.painted > floor,
      `${String(seen.painted)} painted pixel(s) of ${String(seen.pixels)} — the wait settled by ` +
        `"${seen.settledBy}" after ${String(seen.elapsedMs)}ms, renderFailed=` +
        `${String(seen.renderFailed)}, floor ${String(floor)}.\n      ` +
        `THIS IS THE CASE THE CLAUSE RESTS ON. A canvas that mounted, took a page and drew ` +
        `nothing satisfies every other test of this renderer, and produces exactly this ` +
        `output.\n      ` +
        `\`settledBy\` says which failure it is: "failed" means \`PageCanvas\` set ` +
        `\`data-failed\`, so the parse threw and the defect is in the channel or the transport, ` +
        `not in drawing; "bound" means no ink arrived within the harness's liveness bound. A ` +
        `"bound" canvas still at 300x150 never presented a drawing; one at the page's size did, ` +
        `and the tally says what the drawing held.\n      ` +
        // EVERY PAGE CANVAS AT THE END OF THE WAIT, because a "bound" with no failure is otherwise silent about
        // which page was missing and whether any canvas existed at all (ubuntu, bf17dfc2, 2026-10-01: 0 pixels
        // after 60 s, renderFailed false, and nothing to say why). THE TALLY AND THE RENDERER'S SURROUNDINGS since
        // the second (ubuntu, d6228f28, 2026-10-03): the page canvas was at 595x842, so it had presented, and a
        // count of zero could not say whether what it presented was white or empty.
        `page canvases ${JSON.stringify(seen.pageCanvases)}.\n      ` +
        describeRun(seen.tally, seen.environment, seen),
    );

    check(
      'CONTROL: the same counter reports ZERO for a blank canvas of the same size',
      seen.blank === 0,
      `the counter reported ${String(seen.blank)} painted pixel(s) for a ` +
        `${String(seen.width)}x${String(seen.height)} canvas filled white and drawn on by ` +
        `nothing.\n      ` +
        `THE DIRECTION IS WHAT MAKES THIS A CONTROL. The answer this proof hopes for is a HIT, ` +
        `so a positive control that finds something known-present does nothing here — a counter ` +
        `returning a large number for any input produces the reassuring answer just as well as ` +
        `a renderer that drew. Zero on a blank canvas is the reading only a working counter ` +
        `produces.\n      ` +
        `-1 means the control canvas had no 2d context, or the page canvas was gone when the ` +
        `control was built; either is a broken probe rather than a failing measurement.`,
    );

    check(
      'CONTROL: a canvas this renderer FILLS and copies, as renderPage presents, is counted WHOLE',
      seen.ink === seen.pixels,
      `the counter reported ${String(seen.ink)} inked pixel(s) of ${String(seen.pixels)} for a canvas filled ` +
        `#3366cc on a scratch canvas and copied onto it with drawImage.\n      ` +
        `THE BLANK CONTROL'S OTHER HALF. That one proves the counter can say zero; this one proves this ` +
        `renderer's 2D canvas holds ink and gives it back, through the copy renderPage presents with. Red here ` +
        `and on the page means this renderer's canvas held nothing in this run, so the page's zero is not about ` +
        `the page; green here and red on the page means the page is what drew nothing.\n      ` +
        describeRun(seen.tally, seen.environment, seen),
    );

    check(
      'CONTROL: a BITMAP made as PDF.js makes an image’s, drawn scaled across the page, is counted WHOLE',
      seen.bitmapInk === seen.pixels,
      `the counter reported ${String(seen.bitmapInk)} inked pixel(s) of ${String(seen.pixels)} for a canvas a ` +
        `144x144 bitmap was drawn across: ink put into an OffscreenCanvas with putImageData, ` +
        `transferToImageBitmap, then drawImage scaled to the page.\n      ` +
        `THE FIXTURE'S ONLY CONTENT TAKES THIS PATH, and the ink control above does not: when OffscreenCanvas ` +
        `exists, PDF.js's worker hands the page a bitmap made this way for an image. Measured on ubuntu at ` +
        `ce194428 (2026-10-03): the page read all white while the ink control counted whole, so the ground was ` +
        `drawn and the image was not. Red here with the page red names the bitmap path; green here with the ` +
        `page red leaves the one difference this page cannot reach, that PDF.js makes its bitmap in a worker. ` +
        `-2 means no OffscreenCanvas, so PDF.js took its other path; -1 is a broken probe.\n      ` +
        describeRun(seen.tally, seen.environment, seen),
    );

    check(
      'CONTROL: the same bitmap made in a WORKER and posted to the page, as PDF.js’s worker posts one, is counted WHOLE',
      seen.workerBitmapInk === seen.pixels,
      `the counter reported ${String(seen.workerBitmapInk)} inked pixel(s) of ${String(seen.pixels)} for a canvas ` +
        `a 144x144 bitmap was drawn across, the bitmap made in a worker exactly as the control above makes it and ` +
        `transferred to the page with postMessage.\n      ` +
        `THE LAST STEP OF THE IMAGE'S PATH the page can reach. Red here with the control above green names the ` +
        `worker: a bitmap made off the page's thread arrives carrying nothing. Green here with the page red leaves ` +
        `PDF.js itself. -3 means the worker would not start or answered nothing, so this reading says nothing about ` +
        `the bitmap; -1 is a broken probe.\n      ` +
        describeRun(seen.tally, seen.environment, seen),
    );

    // -------------------------------------------------------------------------
    // E1's headline clause, which the four cases above cannot reach.
    //
    // "Glyph edges are pixel-exact at every zoom on every display"
    // (BUILD-PROMPT.md:544) is a statement about scales other than 1, and every
    // reading above is taken at 1 — the scale that is not exercised. The
    // renderer's own cases prove the right number is handed to the rasteriser;
    // these prove the rasteriser produces a bitmap of exactly that size and
    // fills it, in real Chromium.
    // -------------------------------------------------------------------------
    const zoomed = seen.zoomed;
    const zoomedPixels = zoomed.width * zoomed.height;
    const zoomedFloor = Math.floor(zoomedPixels * PAINTED_FLOOR_FRACTION);

    check(
      'the shipped zoom-in control was found and clicked, so the zoom reading means something',
      zoomed.clicks === ZOOM_CLICKS,
      `the harness clicked a control named "${zoomName}" ${String(zoomed.clicks)} time(s) of ` +
        `${String(ZOOM_CLICKS)}.\n      ` +
        `THIS IS THE POSITIVE CONTROL ON THE ZOOM HALF, and the direction is what makes it ` +
        `one: a control that is absent clicks zero times and leaves the canvas exactly as it ` +
        `was, which is also what a renderer ignoring the zoom produces. Without this count the ` +
        `two are one observation and the size case below would be blamed for a registration ` +
        `defect.`,
    );

    check(
      'the canvas is EXACTLY the page at the zoom, which is the rasteriser honouring the scale',
      zoomed.width === PAGE_WIDTH * ZOOM_TARGET && zoomed.height === PAGE_HEIGHT * ZOOM_TARGET,
      `the zoomed canvas measured ${String(zoomed.width)}x${String(zoomed.height)} where the ` +
        `fixture's MediaBox at ${String(ZOOM_TARGET)}x gives ` +
        `${String(PAGE_WIDTH * ZOOM_TARGET)}x${String(PAGE_HEIGHT * ZOOM_TARGET)}; it settled ` +
        `by "${zoomed.settledBy}" at devicePixelRatio ${String(zoomed.devicePixelRatio)}.\n      ` +
        `THE ABSOLUTE SIZE IS ASSERTED RATHER THAN A RATIO DERIVED FROM THE REPORTED RATIO. A ` +
        `derived expectation moves with a misreported ratio, so it agrees with the bug; the ` +
        `ratio is reported here only so a failure is diagnosable.\n      ` +
        `${String(PAGE_WIDTH)}x${String(PAGE_HEIGHT)} means the re-render never happened and ` +
        `the CSS stretch is all there is — a permanently blurry page, which is exactly what ` +
        `E1 bans as anything but transient. A size BETWEEN the two means the ladder no longer ` +
        `lands on ${String(ZOOM_TARGET)}x after ${String(ZOOM_CLICKS)} steps, so move the ` +
        `clicks rather than the expectation.`,
    );

    check(
      'the zoomed canvas CARRIES A DRAWN PAGE, so the bigger bitmap is not a stretched empty one',
      zoomed.settledBy === 'resized' && zoomed.painted > zoomedFloor,
      `${String(zoomed.painted)} painted pixel(s) of ${String(zoomedPixels)}, floor ` +
        `${String(zoomedFloor)}; the wait settled by "${zoomed.settledBy}".\n      ` +
        `THE SIZE CASE ALONE WOULD PASS FOR A RESIZED, BLANK CANVAS. Setting a canvas's width ` +
        `clears it, so a renderer that sized the backing store and then failed to draw ` +
        `produces exactly the dimensions asserted above — which is the display-only defect ` +
        `arriving inside the mechanism that measures it.\n      ` +
        describeRun(zoomed.tally, seen.environment, seen),
    );

    // §10.3's WINDOW CONTROLS OVERLAY, on the window this harness created the shipped way — the attach included.
    const { overlay } = seen;
    check(
      'the window shows the CONTROLS OVERLAY, and leaves the menu bar a narrower area than the window',
      overlay.visible === true &&
        overlay.areaWidth !== null &&
        overlay.areaWidth > 0 &&
        overlay.areaWidth < overlay.innerWidth,
      `navigator.windowControlsOverlay reported visible=${String(overlay.visible)}, menu bar area ` +
        `${String(overlay.areaWidth)} px of a ${String(overlay.innerWidth)} px window.\n      ` +
        `\`null\` is a window created without \`titleBarOverlay\`, where the API reports nothing; an area as wide as ` +
        `the window is one whose native caption is still there, so the controls sit above the row rather than ` +
        `over its end.`,
    );

    // THE STATE THE GROUND IS READ IN, asserted on what the harness passes rather than on what the read produces: the
    // colour case below passed with the first-run AI setup open over the page, its backdrop dimming and blurring the
    // ground, because the dimmed span still held the overlay's colour (2026-09-28). The harness starts past the first
    // run; this is what says it did.
    check(
      'the ground is read with NO DIALOG over the page, the state the controls sit on in use',
      overlay.dialogsOpen === 0,
      `${String(overlay.dialogsOpen)} dialog(s) were open when the ground beneath the controls was read. A fresh ` +
        `profile has no AI key, so the first-run setup opens over everything unless the harness stores what a Skip ` +
        `stores (\`AI_SETUP_AT_START_SETTING_ID\`, false).`,
    );

    const last = overlay.painted.at(-1);
    const span = overlay.groundBeneathControls;
    const spanText =
      span === null ? 'nothing (an empty capture)' : `R ${String(span.low[0])}–${String(span.high[0])}, G ` +
        `${String(span.low[1])}–${String(span.high[1])}, B ${String(span.low[2])}–${String(span.high[2])} over ` +
        `${String(span.pixels)} pixel(s)`;
    check(
      'main PAINTED the overlay in a colour the page shows beneath the controls, read off the same running window',
      last !== undefined && span !== null && withinSpan(last.color, span),
      `the attached window was asked to paint ${String(overlay.painted.length)} overlay(s), the last ` +
        `${JSON.stringify(last ?? null)}; beneath the controls the page shows ${spanText}.\n      ` +
        `A SPAN, NOT A PIXEL: the ground there is a gradient under a grain texture, so no one colour equals it ` +
        `everywhere, and the overlay can take only one. Until 2026-09-28 this compared one pixel, which equalled the ` +
        `overlay only by where the gradient's stops fell; the surface's height changed and it read #060a08 against ` +
        `#060b09, inside a span of R 6–9, G 10–13, B 7–10.\n      ` +
        `NONE means the renderer never reported, or the shell never attached — the channel answers \`applied: false\` ` +
        `for the second, which the renderer does not surface. A DIFFERENT colour means the renderer read something ` +
        `other than what shows there, or reported before the theme applied and never again.\n      ` +
        `THE PAGE, NOT THE BAR'S STYLE: v5's bar is transparent, so its computed background names a colour no ` +
        `overlay can take, and a comparison against it would share the renderer's own choice of box. ` +
        `The capture excludes the controls themselves — with nothing reported it read the ground (#050a08) while ` +
        `the buttons wore the system's colours, measured 2026-09-25.`,
    );

    // THE SPAN'S OWN CONTROL: it must separate a wrong colour, or `within` passes anything. The symbol colour is the
    // renderer's own other answer in the same request — the bar's text, which the ground is chosen to contrast with —
    // so a span wide enough to hold it would hold every overlay this case exists to refuse.
    check(
      'CONTROL: the span beneath the controls REFUSES the overlay’s symbol colour, so a pass above means something',
      last !== undefined && span !== null && !withinSpan(last.symbolColor, span),
      `the symbol colour ${String(last?.symbolColor)} lies within ${spanText}. A span that wide — the controls' own ` +
        `pixels captured, or a capture of the wrong rectangle — makes the colour case above unable to fail.`,
    );

    check(
      "the overlay SETTLES at the menu bar's own height, so the two do not grow each other",
      last !== undefined && overlay.barHeight !== null && last.height === Math.round(overlay.barHeight),
      `the last overlay painted was ${String(last?.height)} px tall and the menu bar measures ` +
        `${String(overlay.barHeight)} px, after ${String(overlay.painted.length)} report(s) at heights ` +
        `${overlay.painted.map((each) => String(each.height)).join(', ')}.\n      ` +
        `THE LOOP THIS GUARDS, found by reading mutation G2b-1's output: the bar's minimum height is the overlay's ` +
        `area, and the overlay's height is what the bar measures. If those two are different boxes, each report ` +
        `grows the other by the difference until the channel's bound refuses the next one — which the colour case ` +
        `above passes, because the colour is right at every step.`,
    );

    // The list and the branch, compared rather than trusted to match. The count
    // already comes from RUNTIME_CASES, so a case added without a line fails the
    // roster; this catches the other half, where four lines describe four
    // DIFFERENT things and the UNVERIFIABLE block gives a confident, wrong
    // account of what could not be looked at.
    const ran = recorded.slice(STRING_CASES);
    if (ran.length !== RUNTIME_CASES.length || ran.some((label, at) => label !== RUNTIME_CASES[at]))
      throw new Error(
        `RUNTIME_CASES does not describe the runtime branch.\n  declared:\n    ` +
          `${RUNTIME_CASES.join('\n    ')}\n  ran:\n    ${ran.join('\n    ')}\n` +
          `That list is what a machine WITHOUT a runtime prints as its account of what could ` +
          `not be evaluated. A wrong account there is worse than no account, because it reads ` +
          `as rigour.`,
      );

    process.stdout.write(
      failures.length > 0
        ? `${failures.length} canvas-pixel failure(s):\n\n  - ${failures.join('\n\n  - ')}\n\n`
        : `${roster.format('canvas-pixel case')}` +
            `  drew ${String(seen.painted)} of ${String(seen.pixels)} pixels ` +
            `(${((seen.painted / seen.pixels) * 100).toFixed(2)}%) at ` +
            `${String(seen.width)}x${String(seen.height)} in ${String(seen.elapsedMs)}ms; ` +
            `blank control ${String(seen.blank)}\n` +
            // REPORTED ON EVERY RUN, because a coverage that is drifting toward
            // the floor is visible long before it crosses it — and because the
            // device-pixel ratio is what makes the size above readable as a
            // scale rather than as a number that happened.
            `  zoomed to ${String(ZOOM_TARGET)}x in ${String(zoomed.clicks)} click(s): drew ` +
            `${String(zoomed.painted)} of ${String(zoomedPixels)} pixels ` +
            `(${((zoomed.painted / zoomedPixels) * 100).toFixed(2)}%) at ` +
            `${String(zoomed.width)}x${String(zoomed.height)} at devicePixelRatio ` +
            `${String(zoomed.devicePixelRatio)}\n` +
            // REPORTED ON EVERY RUN for the loop the settle case guards: a count of reports creeping up is visible
            // here before a height reaches the bound.
            `  title bar overlay: ${String(overlay.painted.length)} report(s) at heights ` +
            `${overlay.painted.map((each) => String(each.height)).join(', ')}; the bar measures ` +
            `${String(overlay.barHeight)} px, its area ${String(overlay.areaWidth)} of ${String(overlay.innerWidth)} px\n`,
    );
  }
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
if (failures.length > 0) process.exitCode = 1;
