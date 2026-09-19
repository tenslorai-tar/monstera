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
 */
export interface CloseGate {
  /**
   * The platform asked the window to close. `true` lets it through; `false` means the caller
   * must prevent it, and the renderer has been asked.
   */
  readonly onCloseRequested: () => boolean;
  /** The renderer resolved every document: let the next close through, and close. */
  readonly confirm: () => void;
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
  return {
    onCloseRequested: () => {
      if (confirmed) return true;
      return !window.ask();
    },
    confirm: () => {
      confirmed = true;
      window.close();
    },
  };
}
