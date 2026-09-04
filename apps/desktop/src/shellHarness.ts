import { appendFileSync } from 'node:fs';

import { app, dialog } from 'electron';

import { createShellDependencies } from './composition.js';
import { createDocumentPicker } from './documentPicker.js';
import { startShell } from './main.js';
import { createRecentFiles } from './recentFiles.js';
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
  // THE READBACK AND THE QUIT PROBE ARE TWO RUNS, and this line is what keeps
  // them two.
  //
  // `report()` ends with `app.exit(0)` — an immediate termination that emits no
  // `before-quit` and no `will-quit`. Under `--quit-when-ready` that landed in
  // the middle of the teardown being measured, killing the process between the
  // 125ms tick and the 250ms finish, cleanly and at exit 0. CI failed on both
  // platforms for four commits and this machine passed every time, because
  // whether the readback finishes before or during the teardown is a race.
  //
  // Two guesses were pushed before the harness was made to record what actually
  // arrived; the marker sequence named it in one read —
  // `WINDOW_CREATED REQUESTED BEFORE_QUIT TEARDOWN_START [TICK]`, with no second
  // `before-quit` and no `will-quit`, which is the signature of `app.exit` and
  // of nothing else.
  //
  // A quit run has no readback to do: `readback()` has its own launch, and the
  // cases that read it are not the cases that read markers.
  //
  // NEITHER DOES AN INSTANCE RUN, and leaving that out reddened CI. The readback
  // ends with `app.exit(0)`, so a launch holding the single-instance lock **quit
  // itself** the moment its window finished loading — before the second launch
  // reached `requestSingleInstanceLock`. The loser then won the lock, built the
  // graph correctly, and the case reported the property broken.
  //
  // It passed locally because the race went the other way here. The subject is a
  // lock held across two processes, and a harness that ends itself cannot hold
  // one; the proof kills this process when it is done with it.
  if (quitProbe !== null || markInstance !== null) return;

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
/**
 * Drives a REAL quit, so the shutdown path is measured rather than simulated.
 *
 * `shellShutdown.test.ts` covers the decision against injected surfaces, and
 * cannot reach the two things that actually matter here: whether the shipped
 * Electron honours the `preventDefault` this shell issues, and whether the
 * process ends at 0 once the teardown settles. Both were carried as *not
 * established*, and a seam whose every test injects its surfaces is a seam
 * nobody has run.
 *
 * The markers are printed rather than counted because ORDER is the whole claim.
 * `MONSTERA_QUIT_WILL_QUIT` must arrive AFTER `MONSTERA_QUIT_TEARDOWN_DONE`: if
 * `preventDefault` were ignored, Electron would carry straight on and the pair
 * would invert — or the process would end mid-teardown and the DONE line would
 * never appear at all. An exit code of 0 alone proves nothing, because a
 * handler that does nothing also exits 0.
 *
 * The delay is real rather than a resolved promise. A microtask would settle
 * inside the same turn that raised the event, so the ordering would hold even
 * if nothing had deferred anything.
 */
function quitWhenAsked(): {
  readonly shutdown: () => Promise<void>;
  readonly mark: (marker: string) => void;
} | null {
  const at = process.argv.indexOf('--quit-when-ready');
  if (at === -1) return null;
  const markerFile = process.argv[at + 1];
  if (markerFile === undefined) {
    throw new Error('--quit-when-ready needs a path to write its markers to');
  }

  // A FILE, WRITTEN SYNCHRONOUSLY, and `process.stdout` is what this replaced.
  //
  // CI failed on both platforms with the markers stopping at TEARDOWN_START —
  // no DONE, no will-quit — while the process exited 0. An exit code of 0 means
  // the quit sequence completed, so those two lines were WRITTEN and lost:
  // `process.stdout` to a pipe is asynchronous, and nothing flushes it when
  // Electron ends the process.
  //
  // That is an instrument sharing its subject's failure. What is being measured
  // is the process shutting down, and the channel being measured on is one the
  // shutdown tears down — so the reading disappears exactly when it becomes
  // interesting, and reads as *it never happened*. `appendFileSync` returns
  // when the bytes are with the OS.
  const mark = (marker: string): void => {
    appendFileSync(markerFile, `${marker}\n`);
  };

  app.on('will-quit', () => {
    mark('MONSTERA_QUIT_WILL_QUIT');
  });

  // EVERY EVENT THAT COULD END THIS PROCESS, recorded rather than reasoned
  // about. Two fixes were pushed on hypotheses about what kills the process
  // between START and DONE and neither was right, so this run answers the
  // question instead of asking a third one: which events actually arrive, in
  // what order, and does a timer fire at all after the quit is prevented.
  //
  // These are the harness's, not the product's. They cost nothing when the
  // cases pass and they are the difference between a diagnosis and a guess when
  // they do not.
  app.on('browser-window-created', () => {
    mark('MONSTERA_QUIT_WINDOW_CREATED');
  });
  app.on('window-all-closed', () => {
    mark('MONSTERA_QUIT_ALL_CLOSED');
  });
  app.on('before-quit', () => {
    mark('MONSTERA_QUIT_BEFORE_QUIT');
  });

  return {
    mark,
    shutdown: async () => {
      mark('MONSTERA_QUIT_TEARDOWN_START');
      // A TICK AT HALF THE DELAY. If this arrives and DONE does not, the timer
      // loop is running and something ends the process partway; if neither
      // arrives, timers do not run once a quit has been prevented — which would
      // be a fact about the product, since its real teardown is asynchronous
      // too.
      await new Promise((resolve) => {
        setTimeout(resolve, 125);
      });
      mark('MONSTERA_QUIT_TEARDOWN_TICK');
      await new Promise((resolve) => {
        setTimeout(resolve, 125);
      });
      mark('MONSTERA_QUIT_TEARDOWN_DONE');
    },
  };
}

/**
 * Records whether the dependency FACTORY ran, for the single-instance ordering.
 *
 * `startShell` takes `() => ShellDependencies` so that a launch which loses the
 * lock reaches `app.quit()` having constructed nothing — two of those
 * constructors write to the session root this application owns, and one of them
 * now sweeps it. The type makes the ordering unrepresentable at both call sites
 * and **nothing proved it ran that way**, because `main.ts` imports Electron and
 * no unit test can load it.
 *
 * So it is proved where it can be driven: two real processes, one lock. The
 * marker is written as the factory's first statement, so what it records is the
 * call — not a state a losing launch would also arrive at by some other route.
 *
 * Same file-not-stdout mechanism as the quit probe, and for a sharper reason
 * here: a losing launch's whole job is to end immediately, so anything buffered
 * behind its exit is lost exactly when it matters.
 */
function instanceMarker(): ((marker: string) => void) | null {
  const at = process.argv.indexOf('--instance-marker');
  if (at === -1) return null;
  const markerFile = process.argv[at + 1];
  if (markerFile === undefined) {
    throw new Error('--instance-marker needs a path to write its markers to');
  }
  return (marker: string): void => {
    appendFileSync(markerFile, `${marker}\n`);
  };
}

const quitProbe = quitWhenAsked();
const markInstance = instanceMarker();

// BEFORE `startShell`, so the file distinguishes a losing launch from a process
// that never started. Without it, "no FACTORY_RAN" is also what a harness that
// crashed on load produces, and the case would pass for the wrong reason.
markInstance?.('MONSTERA_SHELL_STARTED');

startShell(() => {
  markInstance?.('MONSTERA_FACTORY_RAN');
  const dependencies = createShellDependencies(
    { version: app.getVersion(), installChannel: 'development' },
    () => {
      throw new Error('the shell harness has no picker: it does not exercise opening');
    },
    () => {
      throw new Error('the shell harness has no destination picker: it writes no copy');
    },
    // EPHEMERAL, so a harness run cannot configure the developer's application.
    // Not a throwing surface like the picker beside it: the renderer hydrates
    // from `settings.load` before its first render, so this one IS reached on
    // every launch, and a throw here would make the harness fail at startup for
    // a reason unrelated to what it measures.
    createEphemeralSettings(),
    // Ephemeral for the settings' reason, and with one of its own: this harness
    // exercises the QUIT path, which writes the clean-exit marker. A real store
    // here would leave the developer's own marker set by a harness run and make
    // the next crash-recovery offer silent.
    createRecentFiles(createEphemeralSettings()),
  );

  if (quitProbe === null) return dependencies;

  // THE SHUTDOWN IS REPLACED, and only under the flag. What is under test here
  // is the LIFECYCLE — that `before-quit` defers a real Electron quit until the
  // teardown settles, and that the process then ends at 0. The real teardown
  // closes open documents and the engine host, and this harness opens neither,
  // so it would complete inside one turn and the deferral it exists to
  // demonstrate would be invisible.
  //
  // What the real one does is proven where it can be: `compositionHost.test.ts`
  // asserts the whole close sequence in order. Neither half is evidence for the
  // other, and this comment is here so the substitution is not mistaken for one.
  return { ...dependencies, shutdown: quitProbe.shutdown };
});

// THE QUIT IS REQUESTED AFTER `startShell`, AND THE ORDER IS THE WHOLE FIX.
//
// This block sat above `startShell` with a comment claiming it ran "after
// ready, so the shell has registered `before-quit` before anything asks it to
// run". `before-quit` is registered synchronously inside `startShell`, so that
// much was true and it was not the ordering that mattered. The WINDOW is
// created in the shell's own `whenReady` handler — and `whenReady` callbacks
// run in registration order, so registering above `startShell` put this one
// FIRST: the quit was requested before the window existed, and the shell then
// created a window inside a quit it had just cancelled.
//
// CI showed it as non-determinism, which is what named it. The same commit
// produced DONE on one run and not the next with identical harness code, and a
// race is the only thing that does that. Registering here makes the sequence
// the one a user performs: window, then quit.
if (quitProbe !== null) {
  void app.whenReady().then(() => {
    quitProbe.mark('MONSTERA_QUIT_REQUESTED');
    app.quit();
  });
}
