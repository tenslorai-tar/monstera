import { app } from 'electron';

import { createShellDependencies } from './composition.js';
import { startShell } from './main.js';

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
startShell(createShellDependencies({ version: app.getVersion(), installChannel: 'development' }));
