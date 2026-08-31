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
 *
 * **And the lock is what everything below it may assume**, which is why the
 * graph arrives as a factory rather than as a value. A losing launch must reach
 * `app.quit()` having touched nothing this application owns on disk, and a
 * constructor evaluated as an argument runs first.
 */
/** Everything the shell needs, built by the composition root. */
export interface ShellDependencies {
  readonly handlers: ContractHandlers;
  readonly incidents: IncidentSink;
  readonly failures: ShellFailureSink;
}

/**
 * @param build The graph, DEFERRED — see the single-instance section above.
 */
export function startShell(build: () => ShellDependencies): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }

  // BUILT AFTER THE LOCK, and the parameter is a factory for that one reason.
  //
  // This used to take the graph itself, so `entry.ts` constructed it as an
  // argument and every constructor ran before the line above. Two of them touch
  // the filesystem this application owns: `createEngineHostPlatform` creates the
  // session root and writes the negative probe into it, and it now also SWEEPS
  // that root of pairs a dead run left behind.
  //
  // A second launch therefore reached the first instance's session root and
  // wrote to it before discovering it had to quit. That was harmless while the
  // only write was a probe with identical content — and it is the ordering, not
  // the harmlessness, that decided whether a sweep could ever live there. With
  // the sweep, the old order would have had a second launch delete the pairs of
  // a running instance's open documents.
  //
  // B5 over a comment: the graph cannot be constructed before the lock because
  // there is nothing to construct it from until this line.
  const deps = build();

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
