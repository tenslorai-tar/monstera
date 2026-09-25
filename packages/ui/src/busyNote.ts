import type { MessageKey } from '@monstera/shared';

/**
 * A line saying what the application is doing while it waits on something that has no progress to
 * report and cannot be cancelled — a cloud file downloading before its tab appears (the Stage 9 run
 * measured about sixteen seconds of nothing on screen).
 *
 * ## Not a running task, and not a toast
 *
 * A running task (`runningTask.ts`) carries a cancel that must work, and `cloud.open` has none to
 * offer; a progress bar with a dead Cancel is the display-only defect with a bar attached. A toast
 * leaves on its own after a few seconds and says a thing happened, never that one is happening. So
 * this is its own: text, no control, up for exactly as long as the work.
 *
 * ## The raiser ends it, and only its own
 *
 * `ShowBusy` answers the function that takes the note down. A later note replaces an earlier one on
 * screen, and the earlier one's end then does nothing — so a slow first download finishing after a
 * second began cannot take the second's line away.
 */
export interface BusyNote {
  readonly message: MessageKey;
  readonly values: Readonly<Record<string, string>>;
}

/** Raises the note and answers the function that ends it. */
export type ShowBusy = (message: MessageKey, values: Readonly<Record<string, string>>) => () => void;

/**
 * `ShowBusy` over a state setter the shell owns — `useState`'s shape, so App holds one value and this is
 * the whole of the plumbing.
 */
export function busyOver(
  set: (update: (current: BusyNote | undefined) => BusyNote | undefined) => void,
): ShowBusy {
  return (message, values) => {
    const note: BusyNote = { message, values };
    set(() => note);
    return () => {
      set((current) => (current === note ? undefined : current));
    };
  };
}
