import { app, dialog } from 'electron';

import { createShellDependencies } from './composition.js';
import { createDocumentPicker } from './documentPicker.js';
import { startShell } from './main.js';
import { createEphemeralSettings } from './settingsFile.js';

/**
 * Runs the REAL composition root and asks the renderer to use the contract.
 *
 * ## Why this exists at all
 *
 * A composition root that is only known to typecheck is a composition root
 * nobody has run — and this repository has now found that exact defect twice in
 * a week, in a preload that had never executed and in a failure channel nobody
 * subscribed to. Both passed every static check about them, correctly.
 *
 * So this starts the shell the way `entry.ts` does, from the same two functions,
 * and then makes the page call `app.info` **across the real bridge, through the
 * real `ipcMain` registration, into the real handler**. Nothing here rebuilds
 * the graph: rebuilding it would prove that a copy works.
 *
 * ## Attaching without a hook in production code
 *
 * `startShell` creates the window inside `whenReady` and returns nothing, and
 * adding an accessor so a test could reach it would be production code shaped by
 * a test. `app.on('browser-window-created')` is Electron telling us, so the
 * harness listens rather than the shell exposing.
 *
 * ## Both answers are reported, including the unhappy one
 *
 * `app.info` should succeed. `document.execute` should FAIL — there is no engine
 * host, so the session lookup misses by design (see `composition.ts`). Reporting
 * only the success would leave the proof unable to tell a wired contract from
 * one where every channel happens to answer, and the failing channel is the
 * honest state of this stage rather than a defect to hide.
 */
const MARKER = 'MONSTERA_SHELL_READBACK ';

interface Readback {
  /** What `app.info` returned, as the renderer received it. */
  readonly appInfo: unknown;
  /** What `document.execute` returned for a document that is not open. */
  readonly execute: unknown;
  /** Whether the page could see the bridge at all — the control. */
  readonly bridgePresent: boolean;
  /** What {@link exercisePicker} observed. */
  readonly picker: PickerReadback;
}

/** What the picker asked Electron for, and what it answered. */
interface PickerReadback {
  /** Whether the real `dialog` object carries `showOpenDialog` as a function. */
  readonly apiPresent: boolean;
  /** The options object the picker handed the dialog, first call. */
  readonly options: unknown;
  /** Its answers to a dismissal, an empty selection, and a real path. */
  readonly answers: (string | null)[];
}

/**
 * Runs `documentPicker.ts`'s body — which nothing has ever done (finding B4).
 *
 * The module is imported by `entry.ts` and its factory is called there, so
 * `createDocumentPicker()` runs in production; the function it RETURNS has
 * never been invoked anywhere, and everything the module's own comments claim
 * lives inside that function. A dialog that could return a directory, or one
 * that quietly writes to the operating system's recent-documents list, is
 * exactly the `available: true` shape at a boundary nobody has crossed.
 *
 * ## What this proves and what it does not, stated because the difference matters
 *
 * `dialog.showOpenDialog` is replaced for the duration, so what runs is the
 * real module against a scripted answer. That proves the body executes, what it
 * hands Electron, and how it reads all three result shapes. **It does not prove
 * Electron honours the options** — nothing headless can, since a real dialog
 * blocks on a window nobody can dismiss.
 *
 * `apiPresent` is the piece that would otherwise be assumed: it reads the
 * function off the real `dialog` before replacing it, so a renamed or removed
 * Electron API fails here rather than passing against a stub that was happy to
 * be called by any name.
 */
async function exercisePicker(): Promise<PickerReadback> {
  // Read as a PROPERTY rather than as a method. `const x = dialog.showOpenDialog`
  // detaches it from its object, which is a real hazard here and not a lint
  // formality: the value is put back on `dialog` at the end, and anything that
  // called the detached copy in between would call it with the wrong `this`.
  // Restoring the same value re-binds it, so only the read needs saying.
  const original: unknown = Reflect.get(dialog, 'showOpenDialog');
  const apiPresent = typeof original === 'function';

  const calls: unknown[] = [];
  // Dismissal; a selection that came back empty, which is the same outcome by a
  // second route; and two paths, because `multiSelections` being off is a
  // property of the options rather than a guarantee about the answer.
  const scripted = [
    { canceled: true, filePaths: [] },
    { canceled: false, filePaths: [] },
    { canceled: false, filePaths: ['/tmp/one.pdf', '/tmp/two.pdf'] },
  ];
  let call = 0;

  const stub = (options: unknown): Promise<unknown> => {
    calls.push(options);
    const answer = scripted[call] ?? { canceled: true, filePaths: [] };
    call += 1;
    return Promise.resolve(answer);
  };
  Reflect.set(dialog, 'showOpenDialog', stub);

  try {
    const pick = createDocumentPicker();
    const answers = [await pick(), await pick(), await pick()];
    return { apiPresent, options: calls[0] ?? null, answers };
  } finally {
    Reflect.set(dialog, 'showOpenDialog', original);
  }
}

function report(readback: Readback): void {
  process.stdout.write(`${MARKER}${JSON.stringify(readback)}\n`, () => {
    app.exit(0);
  });
}

app.on('browser-window-created', (_event, window) => {
  const { webContents } = window;
  webContents.once('did-finish-load', () => {
    void (async () => {
      try {
        const seen: unknown = await webContents.executeJavaScript(
          `(async () => {
             const bridge = globalThis['monstera'];
             if (bridge === undefined) return { bridgePresent: false };
             return {
               bridgePresent: true,
               appInfo: await bridge.invoke('app.info', {}),
               execute: await bridge.invoke('document.execute', {
                 docId: 'ZG9jdW1lbnQtdGhhdC1pcy1ub3Qtb3Blbg',
                 command: { kind: 'rotatePages', pages: [0], quarterTurns: 1 },
               }),
             };
           })()`,
        );
        const shaped = seen as Partial<Readback> | null;
        report({
          appInfo: shaped?.appInfo ?? null,
          execute: shaped?.execute ?? null,
          bridgePresent: shaped?.bridgePresent === true,
          // Main-side, not from the page: the picker is main's and the renderer
          // must never be able to reach it.
          picker: await exercisePicker(),
        });
      } catch (error) {
        process.stderr.write(
          `MONSTERA_SHELL_HARNESS_FAILED ${error instanceof Error ? error.message : String(error)}\n`,
        );
        app.exit(70);
      }
    })();
  });
});

// The same two calls `entry.ts` makes, in the same order, with the same values.
//
// The picker is the ONE value this harness does not take from `entry.ts`. It
// drives the shell headlessly, so a real `showOpenDialog` would block forever
// on a window nobody can dismiss — and every case this harness runs is about
// the shell starting and the boundary registering, not about opening. It
// throws rather than returning `null`: a silent cancel would let a case about
// opening pass here while proving nothing, which is the display-only shape.
//
// NO ENGINE HOST PLATFORM EITHER, and that is a choice rather than an omission.
// Supplying one would have this proof create a real contained process on every
// run, which is a different subject with a different cost — and the cases here
// never open a document, so nothing would ask it for a session. The absent
// fourth argument is the same `null` every unit test passes.
//
// A LAMBDA, for `entry.ts`'s reason and with a second one here: this harness
// runs alongside a developer's own application, and the losing instance of a
// single-instance app must reach `app.quit()` having built nothing.
startShell(() =>
  createShellDependencies(
    { version: app.getVersion(), installChannel: 'development' },
    () => {
      throw new Error('the shell harness has no picker: it does not exercise opening');
    },
    // EPHEMERAL, so a harness run cannot configure the developer's application.
    // Not a throwing surface like the picker beside it: the renderer hydrates
    // from `settings.load` before its first render, so this one IS reached on
    // every launch, and a throw here would make the harness fail at startup for
    // a reason unrelated to what it measures.
    createEphemeralSettings(),
  ),
);
