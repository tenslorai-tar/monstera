import type { ContractHandlers, IncidentSink } from '@monstera/contract';
import { app, ipcMain, session } from 'electron';

import { registerContractHandlers } from './registerHandlers.js';
import { type ShellFailureSink, reportProcessFailures } from './shellFailure.js';
import { createMainWindow, senderCheckFor } from './window.js';

/**
 * Brings up the hardened window and registers the contract over it.
 *
 * ## Two sinks, because they carry opposite things
 *
 * `incidents` receives diagnostics that did **not** cross to the renderer, and
 * they are stripped of paths on the way (invariant 2). `failures` receives what
 * the Electron runtime announces about its own processes, which crosses nothing
 * and keeps its paths — an absolute preload path is what makes that channel
 * worth having. Routing both to one destination is the caller's business; making
 * them one type would not be.
 *
 * ## Why the handlers arrive as a parameter
 *
 * Assembling them needs a `DocumentCommands`, which needs a `CommandBus` carrying
 * the MuPDF writer, a `DocumentService`, a `CapabilityRegistry` and a session
 * lookup. **No composition root exists yet** — nothing in this repository
 * constructs a `DocumentService` outside a test.
 *
 * Building a stand-in here would register `document.execute` with something that
 * cannot execute, which is finding CC-2 exactly: a declared channel with nothing
 * behind it, where the type says the handler exists and the call fails at run
 * time. So the seam is explicit and the composition root is its own unit.
 *
 * ## Registration happens once, after the window exists
 *
 * The sender check needs something true to compare against — the window's
 * `WebContents` id — so the order is window first, handlers second. Registering
 * first would mean either an optional check or a mutable "the window, once we
 * have one", and both are the default nobody revisits.
 *
 * ## Single instance
 *
 * A second launch focuses the existing window. Not a convenience: the sender
 * check trusts exactly one `WebContents`, and per-document state is per `DocId`
 * in one process. Two shells over one document is the cross-instance race the
 * architecture makes unrepresentable *within* a process and cannot make
 * unrepresentable across two.
 */
/** Everything the shell needs, built by the composition root. */
export interface ShellDependencies {
  readonly handlers: ContractHandlers;
  readonly incidents: IncidentSink;
  readonly failures: ShellFailureSink;
}

export function startShell(deps: ShellDependencies): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  // Subscribed before the window, because a child process can die during
  // startup and `whenReady` is not early enough to hear it.
  reportProcessFailures(app, deps.failures);

  void app.whenReady().then(() => {
    const window = createMainWindow(session.defaultSession, deps.failures);
    registerContractHandlers(ipcMain, deps.handlers, deps.incidents, senderCheckFor(window));

    app.on('second-instance', () => {
      if (window.isMinimized()) window.restore();
      window.focus();
    });
  });

  // Windows and Linux: the app ends with its window. macOS is not a target
  // (ADR-0018 — the Microsoft Store is the only channel), so there is no
  // `activate` re-open branch and no platform check pretending to be one.
  app.on('window-all-closed', () => {
    app.quit();
  });
}
