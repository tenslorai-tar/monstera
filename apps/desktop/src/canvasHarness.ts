import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { AI_SETUP_AT_START_SETTING_ID } from '@monstera/contract';
import { BrowserWindow, app, ipcMain, nativeImage, session } from 'electron';

import { createShellDependencies } from './composition.js';
import { harnessSurfaces } from './harnessComposition.js';
import { createEphemeralSettings } from './settingsFile.js';
import { createMainWindow, senderCheckFor } from './window.js';
import { RENDERER_WEB_PREFERENCES } from './windowPolicy.js';
import type { TitleBarOverlay } from './contractHandlers.js';
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
  /**
   * Where the canvas's own pixels were written, or `null` when none were asked
   * for.
   *
   * ## A FILE, and a COUNT was not enough
   *
   * Everything above this line is a count, and `docs/FEATURES.md`'s HD render
   * row says why that is a limit rather than a style: *it owes a
   * PDFium-against-PDF.js reading before it ships, `canvasReadback.mjs` carrying
   * pixels, not counts*. Two rasterisers that paint the same NUMBER of pixels
   * can paint entirely different ones, so a comparison between engines cannot
   * be made from anything on this interface as it stood.
   *
   * The pixels go to a file rather than onto the marker line because the marker
   * is one line a caller greps: a page at device scale is several megabytes, and
   * a reader's filter is per line.
   *
   * ## RGBA, straightened from what Electron hands back
   *
   * The canvas is captured as a PNG data URL and decoded by `nativeImage`,
   * which is a decoder this application already ships — the alternative was a
   * PNG decoder in a research script, which is a second implementation of
   * something Chromium is already carrying. `toBitmap()` answers **BGRA**, and
   * this writes **RGBA**, because a consumer comparing against another
   * rasteriser's buffer should not have to know which of the two orders it is
   * looking at. The swap happens once, here, at the point the fact is known.
   */
  readonly pixelsWritten: {
    readonly path: string;
    readonly width: number;
    readonly height: number;
  } | null;
  /** `true` when the renderer set `data-failed`, i.e. the parse threw. */
  readonly renderFailed: boolean;
  /** How long the wait took, so a bound that is being approached is visible. */
  readonly elapsedMs: number;
  /** Every page canvas as the wait settled — see {@link PAGE_CANVASES}. */
  readonly pageCanvases: readonly PageCanvasState[];
  /** The wait's own reading split three ways — see {@link TALLY_PIXELS}. `null` with no canvas or no context. */
  readonly tally: PixelTally | null;
  /**
   * The counter on a canvas of the page's size that this renderer FILLED and then copied, the way `renderPage`
   * presents a drawing: filled on a scratch canvas, then `drawImage` onto the measured one. It must equal `pixels`.
   *
   * The blank control proves the counter can say zero; this proves the renderer's 2D canvas can hold ink and give
   * it back, so a zero on the page is about the page. Without it, a canvas whose copy or readback holds nothing in
   * one environment reads exactly like a renderer that drew nothing (ubuntu, d6228f28, 2026-10-03).
   */
  readonly ink: number;
  /**
   * The counter on a canvas of the page's size that a BITMAP was drawn onto, made the way PDF.js's worker makes one
   * for an image when `OffscreenCanvas` exists: ink put into a 144 × 144 `OffscreenCanvas` with `putImageData`,
   * `transferToImageBitmap()`, then `drawImage` of the bitmap scaled across the page. It must equal `pixels`; `-2`
   * means this renderer has no `OffscreenCanvas`, so PDF.js took its other path.
   *
   * {@link ink} cannot see this path, and it is the one the fixture's only content takes. Measured on ubuntu at
   * ce194428 (2026-10-03): the page read 500990 white and 0 inked while {@link ink} counted whole, so the ground was
   * drawn and the image was not. This control is what separates *a bitmap made this way carries nothing here* from
   * the one difference it cannot reach, which is that PDF.js makes its bitmap in a worker.
   */
  readonly bitmapInk: number;
  /**
   * {@link bitmapInk}'s bitmap made in a WORKER and posted to the page, which is the step of PDF.js's image path that
   * control cannot take. It must equal `pixels`; `-3` means this renderer would not start the worker or it answered
   * nothing, so the reading says nothing about the bitmap.
   */
  readonly workerBitmapInk: number;
  /** The same control, made before any page existed. */
  readonly coldWorkerBitmapInk: number;
  /**
   * That bitmap drawn as PDF.js draws an image — flipped, smoothing off — on a canvas of the page's size. It must equal
   * `pixels`; red here with {@link workerBitmapInk} green names the draw.
   */
  readonly workerBitmapAsPdfjsInk: number;
  /** What the run's environment did around the draw, so a failure here can be attributed. */
  readonly environment: EnvironmentReadback;
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
  /**
   * The menu bar's Window Controls Overlay (the window's top row since ADR-0107), as Chromium reports it and as main
   * painted it.
   *
   * `visible` and `areaWidth` come from `navigator.windowControlsOverlay` in the page; `painted` is every overlay
   * the shell's attached window was asked to paint, recorded on the way through — so the proof compares what main
   * applied with what the bar computed, in one run, rather than trusting either half.
   */
  readonly overlay: OverlayReadback;
}

/** A canvas's pixels counted three ways, in one reading. */
export interface PixelTally {
  readonly transparent: number;
  readonly white: number;
  readonly painted: number;
}

/**
 * The renderer's surroundings during the run, reported rather than inferred.
 *
 * `processesGone` is every `child-process-gone` the app announced, the GPU process's among them, and
 * `renderProcessGone` the window's own; a 2D canvas whose GPU process died loses what it held. `gpu` is Chromium's
 * own account of which paths are accelerated, read at the end. `console` is the renderer's warnings and errors, so
 * a PDF.js warning about an image it skipped is in the report rather than on a channel nothing reads.
 */
export interface EnvironmentReadback {
  readonly visibility: string;
  readonly processesGone: readonly { readonly type: string; readonly reason: string; readonly exitCode: number }[];
  readonly renderProcessGone: readonly string[];
  readonly gpu: { readonly canvas2d: string; readonly gpuCompositing: string; readonly rasterization: string };
  readonly console: readonly string[];
  /**
   * The page's WORKERS, PDF.js's among them, reached over the window's debugger: how many attached, and the first
   * twenty lines they logged or threw. PDF.js decodes an image in its worker, and a failure there is a `console.warn`
   * in the worker, which `console-message` never reports. `attached: 0` means this reading could not look, not that the
   * worker was silent: PDF.js starts one for every document.
   */
  readonly workers: { readonly attached: number; readonly console: readonly string[] };
  /**
   * The bytes main served PDF.js, read on the way through `document.readRange`: how many ranges were asked for, how
   * many answered and refused, how many bytes went out of the file's whole, and when the first and last were asked
   * after the open was pressed. A white canvas with every byte served is a drawing that did not finish; one with
   * bytes still unserved is a page whose data never arrived, a different defect.
   */
  readonly ranges: {
    readonly asked: number;
    readonly answered: number;
    readonly refused: number;
    readonly bytes: number;
    readonly fileBytes: number;
    readonly firstMs: number | null;
    readonly lastMs: number | null;
  };
  /**
   * Animation frames during the canvas wait: one asked for at every poll, and how many of them ran. PDF.js's display
   * path continues a render from `requestAnimationFrame`, so frames that stop running stop a drawing half way.
   */
  readonly frames: { readonly asked: number; readonly ran: number };
}

/** Each channel's lowest and highest value over a captured rectangle, and how many pixels were read. */
export interface GroundSpan {
  readonly low: readonly [number, number, number];
  readonly high: readonly [number, number, number];
  readonly pixels: number;
}

/** The overlay half of a readback. `null` where the page has no `windowControlsOverlay` or no menu bar. */
export interface OverlayReadback {
  readonly visible: boolean | null;
  readonly areaWidth: number | null;
  readonly innerWidth: number;
  /**
   * What the page itself shows under the window controls — the rectangle from the menu bar's area to the window's
   * edge, the bar's height tall — as each channel's lowest and highest value over every pixel there, read off the
   * composited page rather than off any stylesheet. `null` when the capture came back empty.
   *
   * A SPAN, NOT A PIXEL. v5's ground there is a gradient under a grain texture, so no single colour equals it at
   * every point; the overlay can take one colour, and the property is that it is a colour the ground shows there.
   * One pixel equalled the overlay only by where a gradient's stops happened to fall: measured 2026-09-28, the
   * corner read #060a08 against #060b09 once the surface's height changed, with the span R 6–9, G 10–13, B 7–10.
   */
  readonly groundBeneathControls: GroundSpan | null;
  /** The bar's laid-out height in CSS pixels, unrounded — what the overlay's height has to settle on. */
  readonly barHeight: number | null;
  /**
   * How many dialogs the page held when the ground was read. A modal's backdrop dims and blurs everything beneath
   * it, so a ground read under one is not the ground the controls sit on in use — and the dimmed span happened to hold
   * the overlay's colour anyway (measured 2026-09-28), so only this count can say the read was made in the right state.
   */
  readonly dialogsOpen: number;
  readonly painted: readonly TitleBarOverlay[];
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
  /** The zoom wait's reading split three ways, as {@link CanvasReadback.tally}. */
  readonly tally: PixelTally | null;
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
 *
 * ## The two exclusions are COUNTED, not only skipped
 *
 * A page canvas at its page's size carrying no ink is two different failures: white is PDF.js having drawn the
 * page's ground and not what is on it, and transparent is a copy or a readback holding nothing at all. The count
 * alone reads zero for both (ubuntu, d6228f28, 2026-10-03), so {@link TALLY_PIXELS} keeps the three apart and the
 * count is its third.
 */
const TALLY_PIXELS = `(canvas) => {
  if (canvas === null || canvas === undefined) return null;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let transparent = 0;
  let white = 0;
  let painted = 0;
  for (let at = 0; at < data.length; at += 4) {
    const alpha = data[at + 3];
    if (alpha === 0) {
      transparent += 1;
      continue;
    }
    if (data[at] === 255 && data[at + 1] === 255 && data[at + 2] === 255 && alpha === 255) {
      white += 1;
      continue;
    }
    painted += 1;
  }
  return { transparent, white, painted };
}`;

const COUNT_PAINTED = `(canvas) => {
  const tally = (${TALLY_PIXELS})(canvas);
  return tally === null ? -1 : tally.painted;
}`;

/**
 * The bitmap control's bitmap made in a WORKER, as `pdf.worker.mjs` makes an image's, posted to a page and counted
 * across a canvas of `width` × `height`.
 *
 * ## In a window of its own, because the shipped page may not start this worker
 *
 * The renderer's policy gives workers `script-src 'self'`, so a worker from a `blob:` is refused there, and an
 * isolated world takes the page's policy when none is set for it (measured 2026-10-03: *"Creating a worker from
 * 'blob:file:///…' violates … script-src 'self'"*). Loosening the shipped policy for a probe is not available, so the
 * probe runs in a second window built from the same {@link RENDERER_WEB_PREFERENCES}, in a partition of its own, on
 * `about:blank`. The sandbox is a property of the renderer process those preferences launch, which is the property in
 * question; the page and its policy are not.
 *
 * ## Counted twice: upright, and as PDF.js draws an image
 *
 * PDF.js draws an image's bitmap flipped, through `drawImageAtIntegerCoords`, with smoothing off when it is drawn
 * larger than it is (`pdf.mjs`, 6.2.108). The upright count is the bitmap; the second is that draw, so on a run where
 * the first holds ink and the page does not, the second says whether the draw is what loses it.
 *
 * @returns each inked count; `-3` when the worker would not start or answered nothing, `-1` for a broken probe
 */
async function readWorkerBitmapInk(width: number, height: number): Promise<{ upright: number; asPdfjsDraws: number }> {
  const probe = new BrowserWindow({
    show: false,
    webPreferences: { ...RENDERER_WEB_PREFERENCES, session: session.fromPartition('canvas-worker-probe') },
  });
  try {
    await probe.loadURL('about:blank');
    return await evaluate(
      probe.webContents,
      `(async () => {
         const program = [
           'onmessage = () => {',
           '  const side = 144;',
           '  const offscreen = new OffscreenCanvas(side, side);',
           '  const drawing = offscreen.getContext("2d");',
           '  const image = drawing.createImageData(side, side);',
           '  for (let at = 0; at < image.data.length; at += 4) {',
           '    image.data[at] = 0x33; image.data[at + 1] = 0x66; image.data[at + 2] = 0xcc; image.data[at + 3] = 0xff;',
           '  }',
           '  drawing.putImageData(image, 0, 0);',
           '  const bitmap = offscreen.transferToImageBitmap();',
           '  postMessage(bitmap, [bitmap]);',
           '};',
         ].join(String.fromCharCode(10));
         let worker;
         try {
           worker = new Worker(URL.createObjectURL(new Blob([program], { type: 'text/javascript' })));
         } catch {
           return -3;
         }
         const bitmap = await new Promise((settle) => {
           worker.onmessage = (event) => settle(event.data);
           worker.onerror = () => settle(null);
           setTimeout(() => settle(null), 5000);
           worker.postMessage(0);
         });
         worker.terminate();
         if (bitmap === null) return { upright: -3, asPdfjsDraws: -3 };
         const canvasOfThePage = () => {
           const control = document.createElement('canvas');
           control.width = ${String(width)};
           control.height = ${String(height)};
           return control;
         };
         const upright = canvasOfThePage();
         const plain = upright.getContext('2d');
         if (plain === null) return { upright: -1, asPdfjsDraws: -1 };
         plain.drawImage(bitmap, 0, 0, upright.width, upright.height);
         // AS PDF.JS DRAWS AN IMAGE: drawImageAtIntegerCoords under the image's 1/w, -1/h scale, which on an upright
         // page is a y flip with its origin at the bottom edge, and smoothing off, since an image drawn larger than it
         // is with no /Interpolate is not smoothed (getImageSmoothingEnabled).
         const flipped = canvasOfThePage();
         const drawn = flipped.getContext('2d');
         if (drawn === null) return { upright: -1, asPdfjsDraws: -1 };
         drawn.imageSmoothingEnabled = false;
         drawn.setTransform(1, 0, 0, -1, 0, flipped.height);
         drawn.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, flipped.width, flipped.height);
         return { upright: (${COUNT_PAINTED})(upright), asPdfjsDraws: (${COUNT_PAINTED})(flipped) };
       })()`,
      (value): value is { upright: number; asPdfjsDraws: number } =>
        typeof value === 'object' && value !== null && 'upright' in value && 'asPdfjsDraws' in value,
      'worker bitmap control',
    );
  } finally {
    probe.destroy();
  }
}

/**
 * Writes the page canvas's own pixels to `path`, as RGBA.
 *
 * ## Through a PNG, and that is a decoder rather than a format choice
 *
 * The renderer has the pixels and cannot write a file — correctly; it holds no
 * path and `contextIsolation` is what keeps it that way. Carrying them out as
 * numbers is not available either: a page at device scale is several million
 * pixels, and `executeJavaScript` resolves through a JSON channel, so an array
 * of four million entries is a payload measured in tens of megabytes.
 *
 * A PNG data URL is the compact form the platform already produces, and
 * `nativeImage` is the decoder it already ships. Both sides of that round trip
 * are Chromium's, so nothing here re-implements an image format.
 *
 * ## The round trip is LOSSLESS, and that is what makes the comparison valid
 *
 * PNG is lossless and the canvas is `image/png`, so the bytes that come back are
 * the bytes the renderer drew. A JPEG here would put an encoder's own error into
 * a measurement of two rasterisers' disagreement, and the two would be
 * indistinguishable in the answer.
 *
 * @returns the file's dimensions, so a caller knows the buffer's shape without
 * re-deriving it from the file's length
 */
async function writePixels(
  contents: Electron.WebContents,
  path: string,
): Promise<{ path: string; width: number; height: number }> {
  const url = await evaluate(
    contents,
    `(() => {
       const canvas = document.querySelector('canvas.m-page');
       // AN EMPTY STRING FOR AN ABSENT CANVAS, never a throw: the canvas is
       // missing on exactly the path this harness exists to catch, and a
       // dereference there would report "the harness broke" for the defect.
       if (canvas === null) return '';
       return canvas.toDataURL('image/png');
     })()`,
    (value): value is string => typeof value === 'string',
    'canvas image',
  );
  if (url === '') {
    throw new Error(
      'The renderer has no page canvas, so there are no pixels to write. A reading taken here ' +
        'would be about a document that never opened.',
    );
  }

  const image = nativeImage.createFromDataURL(url);
  const size = image.getSize();
  const bgra = image.toBitmap();
  // BGRA -> RGBA, IN PLACE. `toBitmap` documents the order, and a consumer
  // comparing this against another rasteriser's RGBA buffer would otherwise
  // find every red and blue channel swapped — which reads as a large,
  // plausible, entirely artificial disagreement between two engines.
  for (let at = 0; at + 3 < bgra.length; at += 4) {
    const blue = bgra[at] ?? 0;
    bgra[at] = bgra[at + 2] ?? 0;
    bgra[at + 2] = blue;
  }
  await writeFile(path, bgra);
  return { path, width: size.width, height: size.height };
}

/** One console argument as text: its value when it has one, else what the debugger describes it as. */
function argumentText(argument: unknown): string {
  if (typeof argument !== 'object' || argument === null) return String(argument);
  const { value, description, type } = argument as { value?: unknown; description?: unknown; type?: unknown };
  if (value !== undefined) return typeof value === 'string' ? value : JSON.stringify(value);
  return typeof description === 'string' ? description : String(type);
}

/**
 * Reads what the page's WORKERS log and throw, through the window's own debugger.
 *
 * `console-message` is a frame's channel; a dedicated worker's console reaches only a debugger, so PDF.js's worker —
 * where it decodes an image and warns when it cannot — was a channel nothing in this harness read. The debugger is
 * told to attach to every worker the page starts (`Target.setAutoAttach`, flat sessions, never paused), and each
 * attached worker's `Runtime` reports its console calls and uncaught exceptions. The page's own session is never
 * enabled: the page's console is already read, and enabling it would be a second reader of the same lines.
 *
 * Bounded at twenty lines of three hundred characters, the page console's bound, so a worker logging in a loop cannot
 * make the marker line unreadable.
 */
async function watchWorkers(contents: Electron.WebContents): Promise<{ attached: number; readonly lines: string[] }> {
  const watched = { attached: 0, lines: [] as string[] };
  const push = (line: string): void => {
    if (watched.lines.length < 20) watched.lines.push(line.slice(0, 300));
  };
  const debug = contents.debugger;
  debug.attach('1.3');
  debug.on('message', (_event, method, params, sessionId) => {
    const p = params as {
      sessionId?: string;
      targetInfo?: { type?: string };
      type?: string;
      args?: unknown[];
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (method === 'Target.attachedToTarget' && p.targetInfo?.type === 'worker' && p.sessionId !== undefined) {
      watched.attached += 1;
      void debug.sendCommand('Runtime.enable', {}, p.sessionId).catch((error: unknown) => {
        push(`runtime not enabled: ${String(error)}`);
      });
      return;
    }
    // THE PAGE'S OWN SESSION is the empty id, and it is never enabled; only a worker's session reaches below.
    if (sessionId === '') return;
    if (method === 'Runtime.consoleAPICalled') {
      push(`${String(p.type)}: ${(p.args ?? []).map(argumentText).join(' ')}`);
    } else if (method === 'Runtime.exceptionThrown') {
      push(`thrown: ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? 'unknown'}`);
    }
  });
  await debug.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  return watched;
}

/**
 * One composited pixel of the page at CSS position (`x`, `y`), as `#rrggbb`, or `null` for an empty capture.
 *
 * `capturePage` reads the page's own surface, so this is the colour a person sees there with no stylesheet
 * consulted — the independent side of a comparison whose other side is a colour the renderer computed. It does
 * not include the window controls: the corner under them reads as the page's ground while they still wear the
 * system's colours (measured 2026-09-25 with the renderer reporting nothing, see `canvasPixels.proof.mjs`).
 * `toBitmap` is BGRA, so the channels are taken 2, 1, 0.
 */
/** The span of the page's own colours over a rectangle, or `null` when the capture came back empty. */
async function pageSpan(
  contents: Electron.WebContents,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): Promise<GroundSpan | null> {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const bgra = (await contents.capturePage(rect)).toBitmap();
  const low: [number, number, number] = [255, 255, 255];
  const high: [number, number, number] = [0, 0, 0];
  let pixels = 0;
  for (let at = 0; at + 3 < bgra.length; at += 4) {
    // BGRA, which is `toBitmap`'s order.
    const rgb = [bgra[at + 2] ?? 0, bgra[at + 1] ?? 0, bgra[at] ?? 0] as const;
    for (let channel = 0; channel < 3; channel += 1) {
      low[channel] = Math.min(low[channel] ?? 255, rgb[channel] ?? 0);
      high[channel] = Math.max(high[channel] ?? 0, rgb[channel] ?? 0);
    }
    pixels += 1;
  }
  return pixels === 0 ? null : { low, high, pixels };
}

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

/** One page canvas as the wait settled: which page, its size, and its failure marker with the reason the page gave. */
export interface PageCanvasState {
  readonly page: string | null;
  readonly width: number;
  readonly height: number;
  readonly failed: boolean;
  readonly reason: string | null;
}

/**
 * EVERY page canvas in the document, not the first: the readings above take `querySelector`'s first, and a run that
 * settled on a 300 × 150 canvas carrying ink (CI, Windows, 2026-10-01) could not say whether that was the page asked
 * about or another one mounted before it. Bounded, so a long document cannot grow the marker line.
 */
const PAGE_CANVASES = `[...document.querySelectorAll('canvas.m-page')].slice(0, 8).map((canvas) => ({
  page: canvas.dataset.pageCanvas ?? null,
  width: canvas.width,
  height: canvas.height,
  failed: canvas.dataset.failed === 'true',
  reason: canvas.dataset.failedReason ?? null,
}))`;

function isPageCanvases(value: unknown): value is PageCanvasState[] {
  return (
    Array.isArray(value) &&
    value.every((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return false;
      const candidate = entry as Record<string, unknown>;
      return (
        (typeof candidate['page'] === 'string' || candidate['page'] === null) &&
        typeof candidate['width'] === 'number' &&
        typeof candidate['height'] === 'number' &&
        typeof candidate['failed'] === 'boolean' &&
        (typeof candidate['reason'] === 'string' || candidate['reason'] === null)
      );
    })
  );
}

function isCanvasState(value: unknown): value is {
  present: boolean;
  width: number;
  height: number;
  failed: boolean;
  painted: number;
  tally: PixelTally | null;
} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['present'] === 'boolean' &&
    typeof candidate['width'] === 'number' &&
    typeof candidate['height'] === 'number' &&
    typeof candidate['failed'] === 'boolean' &&
    typeof candidate['painted'] === 'number' &&
    (candidate['tally'] === null || isPixelTally(candidate['tally']))
  );
}

function isPixelTally(value: unknown): value is PixelTally {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['transparent'] === 'number' &&
    typeof candidate['white'] === 'number' &&
    typeof candidate['painted'] === 'number'
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
 *
 * ## The NAME is `aria-label` when there is one, and the text otherwise
 *
 * That is the accessible-name computation's order for a button, and it is what
 * this function always claimed to match. It compared `textContent` alone until
 * 2026-09-15, which agreed with the name for as long as every control it clicked
 * carried visible text; design pass F made the quick toolbar's zoom control an
 * icon button whose name lives only in `aria-label`, and the harness then found
 * it zero times.
 *
 * ## And the text is the text a screen reader reads — `aria-hidden` subtrees excluded
 *
 * The same computation leaves out a descendant hidden from the accessibility tree. `textContent` does not, so on
 * 2026-09-15 the start screen's Open button, which gained its chord as an `aria-hidden` `<kbd>` (design pass H1a),
 * read "Open PDF…Ctrl+O" here while its name stayed "Open PDF…", and the harness found it zero times — the canvas
 * proof's first case reported *no button named "Open PDF…"*, which is the control for this clause.
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
       const visibleText = (entry) => {
         const copy = entry.cloneNode(true);
         for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
         return copy.textContent ?? '';
       };
       const nameOf = (entry) => (entry.getAttribute('aria-label') ?? visibleText(entry)).trim();
       const target = controls.find((entry) => nameOf(entry) === wanted);
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
): Promise<{
  settledBy: CanvasReadback['settledBy'];
  width: number;
  height: number;
  failed: boolean;
  /** Counted in the same reading as the size, so the two describe one canvas at one moment. */
  painted: number;
  /** That reading's whole tally, `null` with no canvas or no context. */
  tally: PixelTally | null;
  elapsedMs: number;
}> {
  const startedAt = process.hrtime.bigint();
  const elapsed = (): number => Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

  for (;;) {
    // THE SIZE AND THE PIXELS IN ONE READING, because a page can be drawn between two. `renderPage` presents a
    // finished drawing in one task — the resize and the copy together — so a size read in one `evaluate` and a
    // count read in the next could straddle it: the default 300 x 150 before, the ink after, returned as one
    // settled canvas. Measured 2026-10-01 on a merge of the flicker and screens branches: 1 render-geometry run
    // in 30 failed that way, and 5 in 5 with a 1.5 s pause put between the two reads, each reporting 300 x 150 for
    // a canvas the next read found at its page's size. One script runs in one task, so nothing can draw inside it.
    const state = await evaluate(
      contents,
      `(() => {
         const canvas = document.querySelector('canvas.m-page');
         const tally = (${TALLY_PIXELS})(canvas);
         window.__monsteraFramesAsked = (window.__monsteraFramesAsked ?? 0) + 1;
         requestAnimationFrame(() => {
           window.__monsteraFramesRan = (window.__monsteraFramesRan ?? 0) + 1;
         });
         return {
           present: canvas !== null,
           width: canvas === null ? 0 : canvas.width,
           height: canvas === null ? 0 : canvas.height,
           failed: canvas !== null && canvas.dataset.failed === 'true',
           painted: tally === null ? -1 : tally.painted,
           tally,
         };
       })()`,
      isCanvasState,
      'canvas state',
    );
    const reading = (settledBy: CanvasReadback['settledBy']) => ({
      settledBy,
      width: state.width,
      height: state.height,
      failed: state.failed,
      painted: state.painted,
      tally: state.tally,
      elapsedMs: elapsed(),
    });

    if (state.failed) return reading('failed');
    // POLLED ON THE PIXELS, not on the canvas's dimensions. A sized canvas says
    // nothing about whether a draw finished, and the size it is sized to is a
    // property of the document, so "it is no longer the element default" is not
    // a statement anything can make about an arbitrary page. Paint is what
    // finishing looks like, and the counter returns no positive count for any way
    // of not having done it — including no canvas at all, the path an Open control that
    // dispatches into the void leaves (measured 2026-08-29: a probe that threw
    // there reported "the harness broke" for the defect it exists to find).
    if (state.present && state.width !== notWidth && state.painted > 0) return reading('drawn');
    if (elapsed() >= DRAW_BOUND_MS) return reading('bound');
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
    painted: settled.painted,
    tally: settled.tally,
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
  pixelPath?: string,
): Promise<void> {
  // SUBSCRIBED BEFORE READY, because the GPU process starts with the app and a death there is the first thing a
  // blank canvas would want to be asked about.
  const processesGone: { type: string; reason: string; exitCode: number }[] = [];
  app.on('child-process-gone', (_event, details) => {
    processesGone.push({ type: details.type, reason: details.reason, exitCode: details.exitCode });
  });
  await app.whenReady();
  // THE WORKER BITMAP CONTROL BEFORE ANY PAGE EXISTS. The same control is read again below, after the page; a blank
  // reading here is the engine's own first worker bitmap, with none of this repository's code in the path, and a
  // failure report that carries both says which side of the page the blankness is on.
  // Electron quits when its last window closes unless something listens, and the probe's window is the only one yet.
  const keepAlive = (): void => undefined;
  app.on('window-all-closed', keepAlive);
  const cold = await readWorkerBitmapInk(595, 842);
  app.off('window-all-closed', keepAlive);

  // THE SHIPPED THREE CALLS, in the shipped order. `main.ts` creates the window
  // before registering, because the sender check needs a real `WebContents` id
  // to compare against; reproducing that order matters, since a harness that
  // registered first would be exercising a configuration the product never runs.
  // PAST THE FIRST RUN, as a Skip leaves it. The settings are ephemeral, so every launch is a first run with no AI
  // key, and the first-run setup's modal then covered the page this harness reads: its backdrop dims and blurs every
  // pixel beneath it, including the ground under the window controls (measured 2026-09-28). The first run is its own
  // case, in the browser harness (`renderedScreen.pw.ts`).
  const settings = createEphemeralSettings();
  settings.write({ [AI_SETUP_AT_START_SETTING_ID]: false });
  const deps = createShellDependencies({
    ...harnessSurfaces('the canvas harness'),
    settings,
    // A FIXED NAME in the harness, so what it stamps does not depend on who ran it.
    appInfo: { version: app.getVersion(), installChannel: 'development', userName: 'Canvas Harness' },
    // THE ONE SUBSTITUTION, and it is a function returning a path because that
    // is exactly what `PickDocument` is. Nothing downstream can tell this from
    // `createDocumentPicker()` — which is the point of the seam, and the reason
    // the dialog is the only thing this proof does not reach.
    pickDocument: () => Promise.resolve(fixture),
  });
  // NO MEMORY: the harness opens the same way every run, whatever a person left a window at on this machine.
  const window = createMainWindow(session.defaultSession, deps.failures, undefined);
  // THE SHIPPED ORDER includes the attach, so the overlay this harness reads is the one the product paints —
  // recorded on the way through and passed to the real window unchanged.
  const overlaysPainted: TitleBarOverlay[] = [];
  deps.attachWindow({
    setTitleBarOverlay: (overlay) => {
      overlaysPainted.push(overlay);
      window.setTitleBarOverlay(overlay);
    },
    close: () => {
      window.close();
    },
    // NOBODY TO ASK: this harness closes its window when its reading is done, and a held close
    // would leave it waiting on a question no case answers.
    askToClose: () => false,
    edit: (action) => {
      window.webContents[action]();
    },
  });
  // THE RANGES MAIN SERVES, recorded on the way through and handed on unchanged, as the overlays are above: the shipped
  // handler answers, and the harness only counts what it answered.
  const fileBytes = (await stat(fixture)).size;
  const ranges = { asked: 0, answered: 0, refused: 0, bytes: 0, fileBytes, firstMs: null as number | null, lastMs: null as number | null };
  let openedAt: bigint | null = null;
  const sinceOpen = (): number | null => (openedAt === null ? null : Number((process.hrtime.bigint() - openedAt) / 1_000_000n));
  const readRange = deps.handlers['document.readRange'];
  const handlers: typeof deps.handlers = {
    ...deps.handlers,
    'document.readRange': async (params) => {
      ranges.asked += 1;
      ranges.firstMs ??= sinceOpen();
      ranges.lastMs = sinceOpen();
      const answer = await readRange(params);
      if (answer.ok && answer.value.kind === 'bytes') {
        ranges.answered += 1;
        ranges.bytes += answer.value.bytes.byteLength;
      } else {
        ranges.refused += 1;
      }
      return answer;
    },
  };
  registerContractHandlers(ipcMain, handlers, deps.incidents, senderCheckFor(window));

  const contents = window.webContents;
  const renderProcessGone: string[] = [];
  contents.on('render-process-gone', (_event, details) => {
    renderProcessGone.push(`${details.reason} (exit ${String(details.exitCode)})`);
  });
  // THE FIRST TWENTY warnings and errors, each cut to a line: enough to name an image the page's thread skipped or a
  // lost context, and bounded so a renderer logging in a loop cannot make the one marker line unreadable. The PAGE's
  // only: `console-message` reports a frame, and PDF.js's worker logs elsewhere — read below.
  const consoleLines: string[] = [];
  contents.on('console-message', (event) => {
    if ((event.level === 'warning' || event.level === 'error') && consoleLines.length < 20) {
      consoleLines.push(`${event.level}: ${event.message}`.slice(0, 300));
    }
  });
  await new Promise<void>((resolve) => {
    contents.once('did-finish-load', () => {
      resolve();
    });
  });
  // ATTACHED BEFORE THE OPEN, which is when PDF.js starts its worker, so the worker is reached from its first line.
  const workers = await watchWorkers(contents);

  openedAt = process.hrtime.bigint();
  const dispatched = await clickControl(contents, openControlName, 'open control');
  const settled = await waitForCanvas(contents);
  const frames = await evaluate(
    contents,
    '({ asked: window.__monsteraFramesAsked ?? 0, ran: window.__monsteraFramesRan ?? 0 })',
    (value): value is { asked: number; ran: number } =>
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { asked?: unknown }).asked === 'number' &&
      typeof (value as { ran?: unknown }).ran === 'number',
    'animation frames',
  );
  const pageCanvases = await evaluate(contents, PAGE_CANVASES, isPageCanvases, 'page canvases');
  // THE WAIT'S OWN COUNT, taken in the reading that gave the size: a second count read here would pair the size
  // from one moment with the ink from another, which is the defect `waitForCanvas` reads both at once to prevent.
  const { painted } = settled;

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

  // THE OTHER DIRECTION, through `present()`'s own path: filled on a canvas nobody sees, then copied onto the one that
  // is counted. Not white and not transparent, so every pixel of it is ink only a canvas that holds pixels gives back.
  const ink = await evaluate(
    contents,
    `(() => {
       const source = document.querySelector('canvas.m-page');
       if (source === null) return -1;
       const scratch = document.createElement('canvas');
       scratch.width = source.width;
       scratch.height = source.height;
       const drawing = scratch.getContext('2d');
       if (drawing === null) return -1;
       drawing.fillStyle = '#3366cc';
       drawing.fillRect(0, 0, scratch.width, scratch.height);
       const control = document.createElement('canvas');
       control.width = source.width;
       control.height = source.height;
       const context = control.getContext('2d');
       if (context === null) return -1;
       context.drawImage(scratch, 0, 0);
       return (${COUNT_PAINTED})(control);
     })()`,
    (value): value is number => typeof value === 'number',
    'ink control',
  );

  // THE IMAGE'S OWN PATH, as far as this page can reach it: the bitmap PDF.js's worker hands the page for an image
  // (`pdf.worker.mjs`, `transferToImageBitmap` after `putImageData` on an `OffscreenCanvas`), drawn scaled as the
  // fixture's 144-pixel image is. The colour is the ink control's, so the two read the same when both paths work.
  const bitmapInk = await evaluate(
    contents,
    `(async () => {
       const source = document.querySelector('canvas.m-page');
       if (source === null) return -1;
       if (typeof OffscreenCanvas === 'undefined') return -2;
       const side = 144;
       const offscreen = new OffscreenCanvas(side, side);
       const drawing = offscreen.getContext('2d');
       if (drawing === null) return -1;
       const image = drawing.createImageData(side, side);
       for (let at = 0; at < image.data.length; at += 4) {
         image.data[at] = 0x33;
         image.data[at + 1] = 0x66;
         image.data[at + 2] = 0xcc;
         image.data[at + 3] = 0xff;
       }
       drawing.putImageData(image, 0, 0);
       const bitmap = offscreen.transferToImageBitmap();
       const control = document.createElement('canvas');
       control.width = source.width;
       control.height = source.height;
       const context = control.getContext('2d');
       if (context === null) return -1;
       context.drawImage(bitmap, 0, 0, control.width, control.height);
       bitmap.close();
       return (${COUNT_PAINTED})(control);
     })()`,
    (value): value is number => typeof value === 'number',
    'bitmap control',
  );

  const worker = await readWorkerBitmapInk(settled.width, settled.height);

  const zoomed = await readZoomed(contents, zoomControlName, settled.width);
  const pixelsTo = pixelPath === undefined ? null : await writePixels(contents, pixelPath);

  // READ LAST, long after the renderer's first report: the menu bar mounts with the start screen and a document
  // has opened and zoomed since. THE MENU BAR since v5-14 (ADR-0107): it is the row the controls are drawn over.
  const overlayPage = await evaluate(
    contents,
    `(() => {
       const controls = navigator.windowControlsOverlay;
       const bar = document.querySelector('.m-menu-bar');
       return {
         visible: controls === undefined ? null : controls.visible,
         areaWidth: controls === undefined ? null : controls.getTitlebarAreaRect().width,
         innerWidth: window.innerWidth,
         barHeight: bar === null ? null : bar.getBoundingClientRect().height,
         dialogsOpen: document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length,
       };
     })()`,
    (value): value is Omit<OverlayReadback, 'painted' | 'groundBeneathControls'> =>
      typeof value === 'object' && value !== null && 'innerWidth' in value && 'dialogsOpen' in value,
    'overlay',
  );
  // THE CONTROLS' OWN RECTANGLE: from where the menu bar's area ends to the window's edge, the bar's height tall.
  // `capturePage` reads the page alone, so the buttons drawn over it are not in what it answers.
  const controlsStart = Math.ceil(overlayPage.areaWidth ?? overlayPage.innerWidth);
  const groundBeneathControls = await pageSpan(contents, {
    x: controlsStart,
    y: 0,
    width: overlayPage.innerWidth - controlsStart,
    height: Math.floor(overlayPage.barHeight ?? 0),
  });

  const visibility = await evaluate(
    contents,
    'document.visibilityState',
    (value): value is string => typeof value === 'string',
    'visibility',
  );
  const gpuStatus = app.getGPUFeatureStatus();

  const readback: CanvasReadback = {
    tally: settled.tally,
    ink,
    bitmapInk,
    workerBitmapInk: worker.upright,
    workerBitmapAsPdfjsInk: worker.asPdfjsDraws,
    coldWorkerBitmapInk: cold.upright,
    environment: {
      visibility,
      processesGone,
      renderProcessGone,
      gpu: {
        canvas2d: gpuStatus['2d_canvas'],
        gpuCompositing: gpuStatus.gpu_compositing,
        rasterization: gpuStatus.rasterization,
      },
      console: consoleLines,
      workers: { attached: workers.attached, console: [...workers.lines] },
      ranges: { ...ranges },
      frames,
    },
    dispatched,
    zoomed,
    overlay: { ...overlayPage, groundBeneathControls, painted: overlaysPainted },
    settledBy: settled.settledBy,
    width: settled.width,
    height: settled.height,
    painted,
    blank,
    pixels: settled.width * settled.height,
    pixelsWritten: pixelsTo,
    renderFailed: settled.failed,
    elapsedMs: settled.elapsedMs,
    pageCanvases,
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
