import { join } from 'node:path';

import { app, ipcMain, session } from 'electron';

import { createShellDependencies } from './composition.js';
import { createEphemeralSettings } from './settingsFile.js';
import { createMainWindow, senderCheckFor } from './window.js';
import { registerContractHandlers } from './registerHandlers.js';

/**
 * Drives the SHIPPED renderer to open a document and draw page 1, then counts
 * the pixels it drew.
 *
 * ## Why this exists, in one sentence
 *
 * A canvas that mounts, takes a page and draws nothing passes every test this
 * repository currently has, and *"shows page 1"* is the sentence the whole
 * render clause rests on. §10.4's wired-tools rule names that shape exactly — a
 * control that renders and does nothing, wearing a green check — and the only
 * observation that separates it from a working renderer is the pixels.
 *
 * ## What is shipped code here, and what is not
 *
 * Everything except the picker. `createShellDependencies`, `createMainWindow`
 * and `registerContractHandlers` are the same three calls `entry.ts` and
 * `main.ts` make, in the same order, against the same session — so the window,
 * its web preferences, its CSP, its preload, the channel schemas,
 * `DocumentService`, the range handler and the whole renderer bundle are the
 * artefacts the product runs.
 *
 * The one substitution is `PickDocument`, which is a function returning
 * `string | null` and is the seam `documentPicker.ts` was split out across for
 * exactly this reason. Electron's file dialog cannot be driven from a proof, and
 * it is the one part of opening that has no decision in it: what the dialog
 * returns is a path, and this harness returns one.
 *
 * **That substitution is the whole of what this proof does not cover**, and it
 * is covered elsewhere rather than left implicit — `docs/FEATURES.md`'s open row
 * carries a run-and-record gate for the dialog itself, on the hook-probe
 * pattern, because a real dialog needs a real person.
 *
 * ## No engine host, and the render does not want one
 *
 * `createShellDependencies` takes `enginePlatform = null` here. Opening still
 * succeeds — its own header says so — and the session creation that fails
 * afterwards is MuPDF's business. What the renderer draws from is
 * `document.readRange`, which `DocumentService` answers out of the canonical
 * bytes in main and which reaches no engine at all. So this measures the byte
 * channel and PDF.js, which is what the clause claims.
 *
 * ## The window is SHOWN, and that is a mechanism rather than a convenience
 *
 * PDF.js's display path schedules through `requestAnimationFrame`
 * (`useRequestAnimationFrame: !intentPrint`), and Chromium does not fire one in
 * a page whose `visibilityState` is `hidden` — measured 2026-08-29, where a
 * render against a hidden window never resolved and the hang was very nearly
 * blamed on the CSP. `createMainWindow` shows itself on `ready-to-show`, so the
 * shipped window is already the right one; on Linux the proof supplies the X
 * display that makes showing possible. Nothing here passes `intent: 'print'` to
 * dodge it, because the path that would skip is the path under test.
 */

/** The one line the proof reads. */
export const MARKER = 'MONSTERA_CANVAS_READBACK ';

/**
 * How long the renderer is given to open the document and finish drawing.
 *
 * A LIVENESS bound, not the correctness mechanism: reaching it means the canvas
 * genuinely never acquired pixels, and the readback says which of the three
 * states it stopped in, so "still parsing" is never reported as "drew nothing".
 * Deliberately generous — the fixture is 62 kB and resolves in well under a
 * second locally, and a bound that fails on a slow runner is the timeout someone
 * raises rather than reads.
 */
const DRAW_BOUND_MS = 60_000;

/** How often the poll below looks at the canvas. */
const POLL_MS = 100;

/** What the harness reports, and the only thing the proof may read. */
export interface CanvasReadback {
  /** Whether the shipped Open control was found on the start screen. */
  readonly dispatched: boolean;
  /** How the wait ended: the canvas acquired pixels, failed, or ran out. */
  readonly settledBy: 'drawn' | 'failed' | 'bound';
  /** The canvas's device-pixel size once the wait ended. */
  readonly width: number;
  readonly height: number;
  /** Non-white, non-transparent pixels on the rendered canvas. */
  readonly painted: number;
  /**
   * The same count, taken by the same function, on a blank canvas of the same
   * size — the separating control. See {@link countPainted}.
   */
  readonly blank: number;
  /** Total pixels, so the two counts above can be read as fractions. */
  readonly pixels: number;
  /** `true` when the renderer set `data-failed`, i.e. the parse threw. */
  readonly renderFailed: boolean;
  /** How long the wait took, so a bound that is being approached is visible. */
  readonly elapsedMs: number;
  /**
   * The same reading taken again after the shipped zoom control was clicked.
   *
   * **This is E1's headline clause and it is not the clause above.** *"Glyph
   * edges are pixel-exact at every zoom on every display"* is a statement about
   * zooms other than 1, and a canvas read at zoom 1 cannot make it — the scale
   * is the one number that is not exercised. The renderer's own cases prove the
   * right scale is handed to the rasteriser; this proves the rasteriser honours
   * it, in real Chromium, and the two together are the property.
   */
  readonly zoomed: ZoomedReadback;
}

/** A canvas reading taken after the zoom control was driven. */
export interface ZoomedReadback {
  /**
   * How many times the control was found and clicked.
   *
   * **Reported rather than assumed, because a control that is absent clicks
   * zero times and leaves the canvas at its original size** — which is also what
   * a renderer that ignored the zoom produces. Without this number the two are
   * one observation, and the reassuring one is the one that reads as a pass.
   */
  readonly clicks: number;
  /** How the wait ended: the canvas changed size, or the bound was reached. */
  readonly settledBy: 'resized' | 'bound';
  readonly width: number;
  readonly height: number;
  readonly painted: number;
  /**
   * The window's device-pixel ratio, so the expected size is readable.
   *
   * The renderer draws at `devicePixelRatio × zoom`, so a reading of 1190x1684
   * means one thing at a ratio of 1 and something else at 2. The proof asserts
   * the absolute size rather than deriving it from this — a derived expectation
   * would move with a misreported ratio, which is the mutation that cannot
   * separate anything — and reports the ratio so a failure is diagnosable.
   */
  readonly devicePixelRatio: number;
}

/**
 * The counter, as a source string evaluated inside the renderer.
 *
 * ## TWO things do not count, and leaving either one in inverts the result
 *
 * A pixel counts as painted when it is **neither transparent nor white**:
 *
 * - **transparent** is what an untouched canvas is. Alpha 0, RGB 0 — so a
 *   counter that asks only "is this pixel white?" reports every pixel of a
 *   canvas nothing has drawn on as painted, and the measurement then peaks
 *   before the render starts. Measured: the first version of this file did
 *   exactly that and reported a drawn page at 300x150, the element's default
 *   size, 134 ms in.
 * - **white** is what a blank page is once PDF.js has cleared it, so a counter
 *   that asks only "does this pixel have alpha?" is satisfied by a page that was
 *   prepared and never drawn — the fixture the defect handles correctly.
 *
 * Each exclusion alone produces the reassuring answer for one of the two ways
 * this can fail, and they are opposite ways, which is why both are here.
 *
 * ## One function for both canvases
 *
 * The rendered canvas and the blank control go through this same expression. Two
 * counters would let the control pass for a reason the measurement does not
 * share, which is the shape where a control certifies its own implementation
 * rather than the instrument.
 */
const COUNT_PAINTED = `(canvas) => {
  if (canvas === null || canvas === undefined) return -1;
  const context = canvas.getContext('2d');
  if (context === null) return -1;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let painted = 0;
  for (let at = 0; at < data.length; at += 4) {
    const alpha = data[at + 3];
    if (alpha === 0) continue;
    if (data[at] === 255 && data[at + 1] === 255 && data[at + 2] === 255 && alpha === 255) continue;
    painted += 1;
  }
  return painted;
}`;

/**
 * Evaluates `expression` in the renderer and refuses a shape it does not fit.
 *
 * `executeJavaScript` resolves `undefined` for a page that could not run the
 * expression, which is the same value a probe returns when it looked and found
 * nothing — so the shape is asserted rather than cast. A cast here would make
 * every case below readable as passing on a blank renderer.
 */
async function evaluate<T>(
  contents: Electron.WebContents,
  expression: string,
  fits: (value: unknown) => value is T,
  what: string,
): Promise<T> {
  const returned: unknown = await contents.executeJavaScript(expression);
  if (!fits(returned)) {
    throw new Error(
      `The ${what} probe returned ${JSON.stringify(returned)}, which is not the shape it ` +
        `reports in. Treating that as a result would let a broken probe answer for the ` +
        `property it was written to measure.`,
    );
  }
  return returned;
}

function isCanvasState(value: unknown): value is {
  present: boolean;
  width: number;
  height: number;
  failed: boolean;
} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['present'] === 'boolean' &&
    typeof candidate['width'] === 'number' &&
    typeof candidate['height'] === 'number' &&
    typeof candidate['failed'] === 'boolean'
  );
}

/** Resolves after `ms`. */
function settle(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Clicks a shipped control, by its accessible name.
 *
 * ## Found by ROLE AND NAME, never by a test id or a class
 *
 * The start screen is a projection of the command registry, and what a user
 * reaches for is a button whose name is the command's title. Selecting on a
 * class would tie this to a stylesheet and would pass for a control that is not
 * the one a user can see; selecting on a test id would add an affordance to the
 * product that exists only for this harness. The name comes from the message
 * catalogue, so it arrives through the same resolver the UI uses.
 *
 * A control that is not found is reported as `dispatched: false` rather than
 * thrown, because "the button is missing" and "the button did nothing" are
 * different defects and the proof says which.
 */
async function clickControl(
  contents: Electron.WebContents,
  name: string,
  what: string,
): Promise<boolean> {
  return evaluate(
    contents,
    `(() => {
       const wanted = ${JSON.stringify(name)};
       const controls = Array.from(document.querySelectorAll('button'));
       const target = controls.find((entry) => (entry.textContent ?? '').trim() === wanted);
       if (target === undefined) return false;
       target.click();
       return true;
     })()`,
    (value): value is boolean => typeof value === 'boolean',
    what,
  );
}

/**
 * Waits until the page canvas has been drawn on, failed, or run out of time.
 *
 * ## Polled on the CANVAS, not on a promise the renderer could resolve early
 *
 * There is no event for "PDF.js finished painting" that crosses to main, and
 * inventing one would mean adding a signal to the product for the harness to
 * read — which is the affordance that then gets fired in the wrong place. The
 * canvas's own pixels are the observable the clause is about, so they are what
 * is watched.
 *
 * ## Three outcomes, kept apart
 *
 * `failed` is read from `data-failed`, which `PageCanvas` sets when the parse
 * throws. Without it, a document that could not be opened and a document that
 * opened and drew nothing are one observation — and the first is a channel
 * defect while the second is a rendering one.
 */
async function waitForCanvas(
  contents: Electron.WebContents,
  /**
   * A width that does not count as settled, or `null` for the first draw.
   *
   * **The zoom wait cannot be "the canvas has pixels"** — it already has them,
   * from the draw before the zoom, and a poll on paint alone returns instantly
   * with the old bitmap. So the second wait excludes the size it started at, and
   * what it is waiting for is the SECOND rasterisation rather than any.
   *
   * Deliberately a width to reject rather than a width to expect: waiting for
   * 1190 would make the harness assert the number the proof exists to assert,
   * and a renderer that resized to something else would be reported as a
   * timeout rather than as the wrong size.
   */
  notWidth: number | null = null,
): Promise<{ settledBy: CanvasReadback['settledBy']; width: number; height: number; failed: boolean; elapsedMs: number }> {
  const startedAt = process.hrtime.bigint();
  const elapsed = (): number => Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

  for (;;) {
    const state = await evaluate(
      contents,
      `(() => {
         const canvas = document.querySelector('canvas.m-page');
         return {
           present: canvas !== null,
           width: canvas === null ? 0 : canvas.width,
           height: canvas === null ? 0 : canvas.height,
           failed: canvas !== null && canvas.dataset.failed === 'true',
         };
       })()`,
      isCanvasState,
      'canvas state',
    );

    if (state.failed) {
      return { settledBy: 'failed', width: state.width, height: state.height, failed: true, elapsedMs: elapsed() };
    }
    // POLLED ON THE PIXELS, not on the canvas's dimensions. `renderPage` sizes
    // the canvas before drawing, so a sized canvas is a draw that has begun and
    // not one that has finished — and the size it is sized to is a property of
    // the document, so "it is no longer the element default" is not a statement
    // anything can make about an arbitrary page. Paint is what finishing looks
    // like, and the counter above returns zero for both ways of not having done
    // it.
    if (state.present && state.width !== notWidth) {
      const painted = await evaluate(
        contents,
        // NULL-SAFE, because the canvas is absent on exactly the path this harness
    // exists to catch. `PageCanvas` is mounted only once a document is open, so
    // an Open control that dispatches into the void leaves no canvas at all —
    // and a probe that threw there would report "the harness broke" for the
    // defect it was written to find. Measured 2026-08-29 by making the start
    // screen's click handler return early: the run died on a null dereference
    // instead of naming the case.
    `(${COUNT_PAINTED})(document.querySelector('canvas.m-page') ?? null)`,
        (value): value is number => typeof value === 'number',
        'painted count',
      );
      if (painted > 0) {
        return { settledBy: 'drawn', width: state.width, height: state.height, failed: false, elapsedMs: elapsed() };
      }
    }
    if (elapsed() >= DRAW_BOUND_MS) {
      return {
        settledBy: 'bound',
        width: state.width,
        height: state.height,
        failed: state.failed,
        elapsedMs: elapsed(),
      };
    }
    await settle(POLL_MS);
  }
}

/**
 * How many times the shipped zoom-in control is clicked.
 *
 * **Three, because the shipped ladder is `[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]`**
 * (`packages/ui/src/commands/documentCommands.ts`) and a document opens at 1, so
 * three steps land on **2** — a whole-number scale whose expected canvas is a
 * doubling rather than a rounding, which keeps the assertion exact.
 *
 * The count is not derived from the ladder because this file cannot import the
 * renderer's module, and it does not need to be: a ladder that changes lands on
 * some other zoom, the canvas comes back a size the proof does not expect, and
 * the case fails naming both numbers. That is the loud direction.
 */
const ZOOM_CLICKS = 3;

/**
 * Drives the shipped zoom control and reads the canvas again.
 *
 * ## Why this waits for a SIZE CHANGE rather than for time
 *
 * The re-render is debounced, so a fixed sleep either races it or hides how long
 * it took. The observable is the canvas's backing store changing, which is the
 * second rasterisation arriving, and `waitForCanvas` already knows how to wait
 * for pixels — it only needed to be told which size means *not yet*.
 *
 * ## The clicks are counted, and that is the control
 *
 * A missing control, a control that is disabled, and a renderer that ignores the
 * zoom all leave the canvas at the size it already had. Counting successful
 * clicks separates the first from the other two, and the size assertion in the
 * proof separates the rest.
 */
async function readZoomed(
  contents: Electron.WebContents,
  name: string,
  beforeWidth: number,
): Promise<ZoomedReadback> {
  let clicks = 0;
  for (let step = 0; step < ZOOM_CLICKS; step += 1) {
    if (await clickControl(contents, name, 'zoom control')) clicks += 1;
  }

  const settled = await waitForCanvas(contents, beforeWidth);
  const painted = await evaluate(
    contents,
    `(${COUNT_PAINTED})(document.querySelector('canvas.m-page') ?? null)`,
    (value): value is number => typeof value === 'number',
    'zoomed painted count',
  );
  const ratio = await evaluate(
    contents,
    'window.devicePixelRatio',
    (value): value is number => typeof value === 'number',
    'device pixel ratio',
  );

  return {
    clicks,
    settledBy: settled.settledBy === 'drawn' ? 'resized' : 'bound',
    width: settled.width,
    height: settled.height,
    painted,
    devicePixelRatio: ratio,
  };
}

/**
 * Brings up the shipped shell against `fixture` and reports what was drawn.
 *
 * @param fixture absolute path to the document the substituted picker returns
 * @param openControlName the accessible name of the start screen's Open control
 */
export async function reportCanvasPixels(
  fixture: string,
  openControlName: string,
  zoomControlName: string,
): Promise<void> {
  await app.whenReady();

  // THE SHIPPED THREE CALLS, in the shipped order. `main.ts` creates the window
  // before registering, because the sender check needs a real `WebContents` id
  // to compare against; reproducing that order matters, since a harness that
  // registered first would be exercising a configuration the product never runs.
  const deps = createShellDependencies(
    { version: app.getVersion(), installChannel: 'development' },
    // THE ONE SUBSTITUTION, and it is a function returning a path because that
    // is exactly what `PickDocument` is. Nothing downstream can tell this from
    // `createDocumentPicker()` — which is the point of the seam, and the reason
    // the dialog is the only thing this proof does not reach.
    () => Promise.resolve(fixture),
    // EPHEMERAL, because this proof runs on a developer's machine and on CI, and
    // a harness that wrote into the real `userData` would leave the application
    // configured by a test run.
    createEphemeralSettings(),
    null,
  );
  const window = createMainWindow(session.defaultSession, deps.failures);
  registerContractHandlers(ipcMain, deps.handlers, deps.incidents, senderCheckFor(window));

  const contents = window.webContents;
  await new Promise<void>((resolve) => {
    contents.once('did-finish-load', () => {
      resolve();
    });
  });

  const dispatched = await clickControl(contents, openControlName, 'open control');
  const settled = await waitForCanvas(contents);

  const painted = await evaluate(
    contents,
    // NULL-SAFE, because the canvas is absent on exactly the path this harness
    // exists to catch. `PageCanvas` is mounted only once a document is open, so
    // an Open control that dispatches into the void leaves no canvas at all —
    // and a probe that threw there would report "the harness broke" for the
    // defect it was written to find. Measured 2026-08-29 by making the start
    // screen's click handler return early: the run died on a null dereference
    // instead of naming the case.
    `(${COUNT_PAINTED})(document.querySelector('canvas.m-page') ?? null)`,
    (value): value is number => typeof value === 'number',
    'painted count',
  );

  // THE CONTROL, and its direction is what makes it one.
  //
  // The answer this harness hopes for is a HIT — a large count — and a counter
  // that returns a large number for anything at all produces it just as well as
  // a renderer that drew. So the same expression is run against a canvas of the
  // same size that nothing has drawn on, and that count must be zero.
  //
  // Created here rather than reused from the page: clearing the real canvas
  // would destroy the evidence, and comparing against a *differently sized*
  // blank would let a counter keyed on dimensions separate them for the wrong
  // reason.
  const blank = await evaluate(
    contents,
    `(() => {
       const source = document.querySelector('canvas.m-page');
       if (source === null) return -1;
       const control = document.createElement('canvas');
       control.width = source.width;
       control.height = source.height;
       const context = control.getContext('2d');
       if (context === null) return -1;
       // Painted white, because that is what a BLANK PAGE looks like once PDF.js
       // has cleared it. An untouched canvas is transparent black, which the
       // counter would report as painted — a control that passes because the
       // thing it stands in for is a different colour proves nothing about the
       // measurement beside it.
       context.fillStyle = '#ffffff';
       context.fillRect(0, 0, control.width, control.height);
       return (${COUNT_PAINTED})(control);
     })()`,
    (value): value is number => typeof value === 'number',
    'blank control',
  );

  const zoomed = await readZoomed(contents, zoomControlName, settled.width);

  const readback: CanvasReadback = {
    dispatched,
    zoomed,
    settledBy: settled.settledBy,
    width: settled.width,
    height: settled.height,
    painted,
    blank,
    pixels: settled.width * settled.height,
    renderFailed: settled.failed,
    elapsedMs: settled.elapsedMs,
  };

  // EXIT ONLY ONCE THE LINE IS FLUSHED. `app.exit()` terminates immediately, and
  // when stdout is a pipe — which it always is under a proof — writes are
  // asynchronous. Exiting on the next line truncates the report the caller is
  // waiting for, and the caller then reports "no marker line", which is the same
  // output a harness that never ran produces.
  process.stdout.write(`${MARKER}${JSON.stringify(readback)}\n`, () => {
    app.exit(0);
  });
}

/** Where the fixture lives, resolved from the repository root the caller names. */
export function fixtureIn(repoRoot: string): string {
  return join(repoRoot, 'packages', 'testing', 'fixtures', 'generated', 'perf-baseline.pdf');
}
