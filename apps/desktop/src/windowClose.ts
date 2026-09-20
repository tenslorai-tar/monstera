/**
 * Whether the window may close now, or must first ask the renderer about unsaved work.
 *
 * ## The renderer decides, because the question is a dialog
 *
 * Closing a document that holds unsaved changes asks *Save / Don't save / Cancel*, for every
 * route a document can close by — its tab's ×, Ctrl+W, the window's own close, and quitting
 * (owner, 2026-09-19). The dialog is the renderer's, and so is the one close path every route
 * goes through (`App.tsx`' `requestClose`), which reads each document's dirty state from main
 * inside that document's lane. This gate is the window's half: it holds the platform's close
 * until the renderer has resolved every document, and then lets exactly the next one through.
 *
 * ## Quitting arrives here too
 *
 * Electron's `app.quit()` closes each window and abandons the quit when a window's `close` is
 * prevented, so the window's `close` event is the one place a quit, an Alt+F4, the caption's
 * close button and the taskbar's *Close window* all pass. Windows' own shutdown and log-off
 * arrive as `query-session-end`, which the shell binds to the same gate.
 *
 * ## A renderer that cannot answer does not hold the window
 *
 * `ask` answers `false` when the page is gone — crashed or destroyed — and then the close goes
 * through. Holding it would leave a window nobody can close, prompting from a page that no
 * longer exists. The unsaved work in that case is what the crash-recovery sidecars
 * (`BUILD-PROMPT.md`:397) exist for; this gate does not stand in for them.
 *
 * ## NOR DOES ONE THAT IS NOT LISTENING YET, and that is a page that EXISTS
 *
 * `ask` sends `window.close-requested` and answers whether there was a page to send it to — which
 * is not whether anything will answer. A page that has loaded but whose subscription has not been
 * made yet receives nothing: `ipcRenderer` replays no message, so the request is gone and this gate
 * holds the window for a `window.close` nobody will send. Measured 2026-09-19 on `proof:shell`: the
 * harness requests the quit at `app.whenReady()`, about 1.5 s before the renderer mounts, and the
 * process hung past the probe's 120 s bound — the window open, the page mounted, the quit stuck
 * between `before-quit` and `will-quit`. In the shipped app the same loss is Windows' own shutdown,
 * which arrives once.
 *
 * So the gate holds only for a renderer that has said it is listening. **Nothing is lost by letting
 * the earlier close through**: a document is opened through the renderer, so a page that has not
 * reached its own subscription has no document to resolve — the state this gate exists to protect
 * cannot exist yet. That is B5 over a retry: there is no queued request to deliver late, and no
 * second delivery path for one.
 */
export interface CloseGate {
  /**
   * The platform asked the window to close. `true` lets it through; `false` means the caller
   * must prevent it, and the renderer has been asked.
   */
  readonly onCloseRequested: () => boolean;
  /** The renderer resolved every document: let the next close through, and close. */
  readonly confirm: () => void;
  /** The renderer has subscribed to close requests, so it can answer one. */
  readonly listening: () => void;
}

/** What the gate needs from the window. `composition.ts` builds it from the attached one. */
export interface ClosingWindow {
  /** Asks the renderer to resolve its documents. `false` when there is no page to ask. */
  readonly ask: () => boolean;
  /** Closes the window, which raises the platform's close again. */
  readonly close: () => void;
}

export function createCloseGate(window: ClosingWindow): CloseGate {
  let confirmed = false;
  let announced = false;
  return {
    onCloseRequested: () => {
      if (confirmed) return true;
      // ASKED ONLY WHERE AN ANSWER CAN COME BACK — see the header. `ask` is not reached at all,
      // so a page that is not listening is not sent a request that would be dropped.
      if (!announced) return true;
      return !window.ask();
    },
    confirm: () => {
      confirmed = true;
      window.close();
    },
    listening: () => {
      announced = true;
    },
  };
}
