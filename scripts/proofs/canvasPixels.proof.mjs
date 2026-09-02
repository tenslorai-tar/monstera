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

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANVAS_PIXELS_RUNTIME, refuseStaleBuild } from '../lib/buildFreshness.mjs';
import { createRoster } from '../lib/passRoster.mjs';
import { formatError } from '../lib/reportError.mjs';
import { partialOutcome } from '../lib/unverifiable.mjs';
import { buildLargeFixture } from '../perf/largeFixture.mjs';
import { electronBinaryPath } from '../provision/electron.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HARNESS = join(REPO_ROOT, 'apps', 'desktop', 'dist', 'canvasHarnessMain.js');
const MARKER = 'MONSTERA_CANVAS_READBACK ';

/** The catalogue the control's name is read from. */
const CATALOGUE = join(REPO_ROOT, 'packages', 'ui', 'src', 'messages', 'en.ts');

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
  'the shipped zoom-in control was found and clicked, so the zoom reading means something',
  'the canvas is EXACTLY the page at the zoom, which is the rasteriser honouring the scale',
  'the zoomed canvas CARRIES A DRAWN PAGE, so the bigger bitmap is not a stretched empty one',
];

/** Cases decidable without a runtime. These run on every machine. */
const STRING_CASES = 3;

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

/**
 * The English name of a control, read from the catalogue that ships it.
 *
 * ## One resolver for both controls, rather than a second one beside it
 *
 * This took a key on 2026-09-02, when the zoom control became a second caller.
 * Copying the body for the second name would have been a second opinion about
 * how the catalogue spells a message — the shape B3a names — and the copy would
 * have agreed with this one until the catalogue's format moved.
 *
 * ## Read rather than spelt here, and it carries its own positive control
 *
 * This is a SEARCH, and its reassuring answer is a string — but a wrong pattern
 * returns nothing, and nothing would then be handed to the harness as the name
 * to click, producing "the control was not found" for a control that is there.
 * That is a broken instrument reporting the defect it was written to detect. So
 * a miss throws, naming the file and the key.
 *
 * The alternative was a literal in this file, which is a second spelling of a
 * string the catalogue owns; the drift would be silent here and loud in the
 * harness, which is the wrong way round.
 *
 * @param {string} key the dotted message key the control's title is minted from
 * @returns {string}
 */
function controlName(key) {
  const source = readFileSync(CATALOGUE, 'utf8');
  // The catalogue spells the value as `[SOME_KEY]: 'text',` under a computed
  // key, so the anchor is the key's own dotted name on the line that mints it,
  // and the English text is found by the constant that line binds.
  const minted = new RegExp(
    `export const (\\w+) = messageKey\\('${key.replace(/\./gu, '\\.')}'\\)`,
    'u',
  ).exec(source);
  if (minted === null) {
    throw new Error(
      `No constant in ${CATALOGUE} mints the key "${key}". This proof would otherwise ` +
        `hand the harness an empty name, and the harness would report that the control ` +
        `does not exist — a broken reader producing exactly the finding it exists to detect.`,
    );
  }
  const text = new RegExp(`\\[${minted[1]}\\]:\\s*'([^']+)'`, 'u').exec(source);
  if (text === null || text[1] === undefined) {
    throw new Error(
      `${CATALOGUE} mints ${minted[1]} for "${key}" but the EN catalogue has no entry for ` +
        `it. The resolver throws on a missing message at run time, so this is a renderer that ` +
        `cannot draw the surface that control sits on.`,
    );
  }
  return text[1];
}

/**
 * Runs the harness under a display and returns what the renderer reported.
 *
 * `xvfb-run -a` on Linux, because Electron needs an X display there and without
 * one it does not error — it HANGS. The wrapper is applied here rather than only
 * in the workflow so that running this proof by hand on Linux behaves the same
 * as running it in CI. Its absence is reported as itself rather than as ENOENT
 * from the spawn, which reads like the harness misbehaving.
 *
 * **The display is not optional here in the way it is for a policy read-back.**
 * PDF.js's display path schedules through `requestAnimationFrame`, and Chromium
 * fires none in a page whose `visibilityState` is `hidden` — so with no display
 * the render never completes and this proof reports a canvas that was never
 * drawn on, which is precisely the defect it is looking for. A false positive
 * about a working renderer, produced by the environment.
 *
 * @param {string} binary
 * @param {string} name the accessible name of the Open control
 * @param {string} fixture absolute path to the document to render
 * @param {string} zoomName the accessible name of the zoom-in control
 * @returns {{
 *   dispatched: boolean,
 *   settledBy: 'drawn' | 'failed' | 'bound',
 *   width: number,
 *   height: number,
 *   painted: number,
 *   blank: number,
 *   pixels: number,
 *   renderFailed: boolean,
 *   elapsedMs: number,
 *   zoomed: {
 *     clicks: number,
 *     settledBy: 'resized' | 'bound',
 *     width: number,
 *     height: number,
 *     painted: number,
 *     devicePixelRatio: number,
 *   },
 * }}
 */
function readback(binary, name, fixture, zoomName) {
  const needsDisplay = process.platform === 'linux' && process.env['DISPLAY'] === undefined;
  const XVFB = ['/usr/bin/xvfb-run', '/bin/xvfb-run', '/usr/local/bin/xvfb-run'];
  let wrapper;
  if (needsDisplay) {
    wrapper = XVFB.find((path) => existsSync(path));
    if (wrapper === undefined) {
      throw new Error(
        `Electron needs an X display on Linux and no xvfb-run was found. Tried:\n  ` +
          `${XVFB.join('\n  ')}\nInstall it (\`xvfb\` on Debian/Ubuntu) or export DISPLAY. ` +
          `Without one PDF.js's display path never fires a frame, so this proof would report ` +
          `an undrawn canvas for a renderer that works.`,
      );
    }
  }

  const args = [HARNESS, fixture, name, zoomName];
  const [command, spawnArgs] =
    wrapper === undefined ? [binary, args] : [wrapper, ['-a', binary, ...args]];

  const result = spawnSync(command, spawnArgs, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error(`Could not run the harness via ${command}`, { cause: result.error });
  }

  const line = `${result.stdout}`.split(/\r?\n/).find((entry) => entry.startsWith(MARKER));
  if (line === undefined) {
    // The harness reports its own failures on stderr with a marker, so "it broke
    // and said why" is separated from "it never spoke". Those need different
    // fixes and produce the same missing line.
    const spoke = `${result.stderr}`
      .split(/\r?\n/)
      .filter((entry) => entry.startsWith('MONSTERA_CANVAS_HARNESS_FAILED'))
      .join('\n');
    throw new Error(
      `The harness produced no ${MARKER.trim()} line (exit ${String(result.status)}${
        result.signal === null ? '' : `, signal ${result.signal}`
      }).\n` +
        (spoke === ''
          ? `It reported no failure of its own either, so it was killed or never started. ` +
            `A timeout here means the window never finished loading.\n`
          : `${spoke}\n`) +
        `command: ${command} ${spawnArgs.join(' ')}\n` +
        `stdout: ${result.stdout.slice(0, 1200)}\n` +
        `stderr: ${result.stderr.slice(-2400)}`,
    );
  }
  return JSON.parse(line.slice(MARKER.length));
}

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
        `not in drawing; "bound" means the canvas never acquired a pixel within the harness's ` +
        `liveness bound, which on Linux without a display is what a working renderer also ` +
        `produces.`,
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
        `arriving inside the mechanism that measures it.`,
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
            `${String(zoomed.devicePixelRatio)}\n`,
    );
  }
} catch (error) {
  process.stderr.write(`\n${formatError(error)}\n`);
  process.exitCode = 1;
}
if (failures.length > 0) process.exitCode = 1;
