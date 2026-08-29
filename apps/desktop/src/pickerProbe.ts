import { app, ipcMain, session } from 'electron';

import { createShellDependencies } from './composition.js';
import { createDocumentPicker } from './documentPicker.js';
import { createEphemeralSettings } from './settingsFile.js';
import { createMainWindow, senderCheckFor } from './window.js';
import { registerContractHandlers } from './registerHandlers.js';

/**
 * Brings up the shipped shell with the REAL picker, and reports what a person
 * choosing a file in it produced.
 *
 * ## The one thing no automated proof can reach
 *
 * `documentPicker.ts` is four lines around `dialog.showOpenDialog`, and it had
 * never executed anywhere: no test drives Electron's dialog, and
 * `proof:canvaspixels` deliberately substitutes the `PickDocument` seam for it.
 * So the one surface a user actually touches was the one nothing had run — the
 * display-only sin at the level of a whole module, and a row said **done**
 * above a paragraph saying exactly that.
 *
 * A dialog needs a person. That makes this the same class as the tool-use hook:
 * every part is proven and whether it is ever reached is not something a proof
 * can look at, so it is **executed once and recorded** rather than asserted.
 * `scripts/probes/recordPickerProbe.mjs` runs this, and `check:docs` refuses the
 * row's status without the record.
 *
 * ## THIS FILE CONTAINS NO PATH, AND THAT IS THE EVIDENCE
 *
 * `proof:canvaspixels` hands the shell a fixture path. This one hands it
 * `createDocumentPicker()` and nothing else, so there is no path anywhere in
 * this process for the report to be produced from. A recorded `opened` can
 * therefore only have come from a dialog that opened and a person who chose —
 * which is the hook probe's own property: nothing that failed to run the
 * mechanism can produce the mechanism's output.
 *
 * A `cancelled` is recorded just as faithfully. It is the ordinary case, it
 * exercises the branch `documentPicker.ts` reads `canceled` for, and it
 * satisfies no gate.
 *
 * ## What is NOT reported, deliberately
 *
 * The chosen path never leaves this process, and neither does its file name.
 * The record is a tracked file in a public repository, and a user's filesystem
 * layout is not something this project publishes to certify its own gate —
 * `pathArrived`, the byte length and the pixel count answer the question
 * completely without it.
 *
 * ## How far this is from `entry.ts`
 *
 * Three calls, in main's order, with the real picker: the difference from the
 * shipped entry point is the single-instance lock and the engine platform,
 * neither of which the picker can see. Everything the dialog touches — its
 * properties, its cancellation, `filePaths[0] ?? null`, the handle minting and
 * the open that follows — is the shipped path.
 */

/** The one line the recorder reads. */
export const MARKER = 'MONSTERA_PICKER_PROBE ';

/** How long the drawn page is waited for, once a document has been chosen. */
const DRAW_BOUND_MS = 60_000;

/** How often the poll below looks at the canvas. */
const POLL_MS = 200;

/** What one run of this probe observed. */
export interface PickerObservation {
  /** `opened` only when a path arrived AND the document opened and drew. */
  readonly outcome: 'opened' | 'cancelled' | 'not-drawn';
  /**
   * Whether the picker returned a path at all.
   *
   * The path itself is never reported. This is the self-certifying part: no path
   * exists anywhere in this process, so a `true` here cannot have been produced
   * by anything but a dialog return.
   */
  readonly pathArrived: boolean;
  /** Non-white, non-transparent pixels on the page canvas. */
  readonly painted: number;
  /** The canvas's device-pixel size. */
  readonly width: number;
  readonly height: number;
}

/** Resolves after `ms`. */
function settle(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Reads the page canvas's size and paint count.
 *
 * The counter is the one `canvasHarness.ts` documents and is spelt again here
 * rather than imported, because these two harnesses answer different questions
 * and a shared expression would tie a gate a person satisfies to a proof CI
 * runs. It excludes transparent and white for the reasons stated there: an
 * untouched canvas is transparent and a blank page is white, and a counter blind
 * to either one reports a drawn page for something that is not.
 */
async function readCanvas(
  contents: Electron.WebContents,
): Promise<{ painted: number; width: number; height: number }> {
  const value: unknown = await contents.executeJavaScript(
    `(() => {
       const canvas = document.querySelector('canvas.m-page');
       if (canvas === null) return { painted: -1, width: 0, height: 0 };
       const context = canvas.getContext('2d');
       if (context === null) return { painted: -1, width: canvas.width, height: canvas.height };
       const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
       let painted = 0;
       for (let at = 0; at < data.length; at += 4) {
         const alpha = data[at + 3];
         if (alpha === 0) continue;
         if (data[at] === 255 && data[at+1] === 255 && data[at+2] === 255 && alpha === 255) continue;
         painted += 1;
       }
       return { painted, width: canvas.width, height: canvas.height };
     })()`,
  );
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { painted?: unknown }).painted !== 'number' ||
    typeof (value as { width?: unknown }).width !== 'number' ||
    typeof (value as { height?: unknown }).height !== 'number'
  ) {
    throw new Error(
      `The canvas probe returned ${JSON.stringify(value)}, which is not the shape it reports ` +
        `in. Treating that as a result would let a broken probe satisfy a gate a person is ` +
        `standing at.`,
    );
  }
  return value as { painted: number; width: number; height: number };
}

/**
 * Runs the probe and writes its one line.
 *
 * The observation is taken from the renderer that the person is looking at, so
 * what the record certifies and what they saw are the same event.
 */
export async function reportPickerProbe(): Promise<void> {
  await app.whenReady();

  // THE ONE INSTRUMENTED SEAM, and it wraps the real picker rather than
  // replacing it. `createDocumentPicker()` is called, its dialog is what opens,
  // and its return value is what the shell receives — this only records that a
  // value came back. Substituting the picker is what the other harness does and
  // is exactly what this probe exists because of.
  const observed = { pathArrived: false };
  const realPicker = createDocumentPicker();

  const deps = createShellDependencies(
    { version: app.getVersion(), installChannel: 'development' },
    async () => {
      const picked = await realPicker();
      observed.pathArrived = picked !== null;
      return picked;
    },
    // EPHEMERAL, for the same reason the canvas harness uses one: a person runs
    // this on their own machine, and a probe that wrote into the real `userData`
    // would leave the application configured by having been measured.
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

  // SAYS WHEN IT IS READY, on stderr, and that is not decoration.
  //
  // The person is being asked to click something, so "the window is up and I am
  // waiting for you" is the one thing they need and cannot infer — a shell that
  // is still loading and a shell that is waiting look identical from outside.
  // It is also the only way the machinery below the click can be exercised
  // without one: a run killed after this line has demonstrably composed the
  // shell, created the window, loaded the renderer and constructed the real
  // picker, which is everything the probe does except the part that needs a
  // person. That is how this file was first executed at all.
  //
  // stderr rather than stdout, because stdout carries the marker line the
  // recorder parses and a second line there is a second thing to filter.
  process.stderr.write(
    'The shell is up and the probe is waiting. Click "Open a document" and choose a PDF.\n',
  );

  // WAITED ON THE PERSON, with no bound. They have to find the window, read the
  // start screen, click Open, and navigate a file dialog — and a probe that gave
  // up while somebody was choosing a directory would record `cancelled` for a
  // working picker, which is the reassuring answer arriving through impatience.
  // The recorder owns the outer limit, because only it knows whether anyone is
  // there. Once a path HAS arrived the drawing is a machine's job again, and
  // that half is bounded.
  while (!observed.pathArrived) {
    if (window.isDestroyed()) break;
    await settle(POLL_MS);
  }

  let outcome: PickerObservation['outcome'] = observed.pathArrived ? 'not-drawn' : 'cancelled';
  let canvas = { painted: 0, width: 0, height: 0 };

  if (observed.pathArrived && !window.isDestroyed()) {
    const startedAt = process.hrtime.bigint();
    for (;;) {
      canvas = await readCanvas(contents);
      if (canvas.painted > 0) {
        outcome = 'opened';
        break;
      }
      if (Number((process.hrtime.bigint() - startedAt) / 1_000_000n) >= DRAW_BOUND_MS) break;
      await settle(POLL_MS);
    }
  }

  const observation: PickerObservation = {
    outcome,
    pathArrived: observed.pathArrived,
    painted: canvas.painted,
    width: canvas.width,
    height: canvas.height,
  };

  // Flushed before exit, for the reason every harness here states: `app.exit()`
  // is immediate and a piped stdout is asynchronous, so exiting on the next line
  // truncates the report and the caller then reports a harness that never spoke.
  process.stdout.write(`${MARKER}${JSON.stringify(observation)}\n`, () => {
    app.exit(0);
  });
}
