import { type ContractHandlers, type IncidentSink } from '@monstera/contract';
import { app, ipcMain, session } from 'electron';

import { registerContractHandlers } from './registerHandlers.js';
import { createMainWindow, senderCheckFor } from './window.js';

/**
 * Brings up the hardened window and registers the contract over it.
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
export function startShell(handlers: ContractHandlers, sink: IncidentSink): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  void app.whenReady().then(() => {
    const window = createMainWindow(session.defaultSession);
    registerContractHandlers(ipcMain, handlers, sink, senderCheckFor(window));

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
