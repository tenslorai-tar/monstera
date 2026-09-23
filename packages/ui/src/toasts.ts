import type { MessageKey } from '@monstera/shared';
import { type StoreApi, createStore } from 'zustand/vanilla';

import type { ToastKind, ToastMessage } from './primitives/Toast.js';

/**
 * The brief confirmations along the bottom of the window, and the queue that holds them.
 *
 * ## Why a toast exists at all, and why it took until now
 *
 * `docs/FEATURES.md`' toasts row was triaged to *first use* because §10 already decided the
 * question: `Toast` is named among the primitives that *"are added the first time a feature
 * needs them, in the package, never ad hoc in the feature."* The first use arrived with the
 * owner's report that a save changes nothing on screen — so this lands as a primitive with a
 * store behind it, not as a `<div>` inside the save command.
 *
 * The shape and the rule about what a toast may say live with the primitive that draws them,
 * in `primitives/Toast.tsx`. This file is the queue.
 *
 * ## A problem is NOT silent, and is not a toast on its own where it is actionable
 *
 * A save that failed reaches the save-problem dialog, because the person can act on it. The
 * `problem` kind is here for the failures with nothing to decide — a copy that could not be
 * written to a place the person already chose — so that *nothing on screen changed* can never
 * be the whole report of a failure.
 */

/** How long one toast stays, in milliseconds. */
export const TOAST_LIFETIME = 4000;

/** How many toasts may be on screen; the oldest leaves when a newer one arrives. */
export const TOAST_LIMIT = 3;

export interface ToastState {
  /** Oldest first, which is the order they are drawn in and the order they leave. */
  readonly toasts: readonly ToastMessage[];
}

export interface ToastActions {
  /**
   * Puts one message on screen and answers its id, which {@link ToastActions.dismiss} takes.
   *
   * **Newest last, oldest dropped past {@link TOAST_LIMIT}.** A run of saves must not grow a
   * column up the window; three is what fits above the status bar at the 720 px floor.
   */
  readonly show: (kind: ToastKind, message: MessageKey) => number;
  /** Takes one toast off, by the id `show` answered. Unknown ids are ignored. */
  readonly dismiss: (id: number) => void;
}

export type ToastStore = StoreApi<ToastState & ToastActions>;

/**
 * Creates the window's one toast queue.
 *
 * One per window rather than one per document: a toast reports an action the person just took,
 * and the action's document is already the focused one. A per-document queue would hold
 * messages for a tab nobody is looking at, which is a notification centre and not this.
 */
export function createToastStore(): ToastStore {
  let next = 0;
  return createStore<ToastState & ToastActions>()((set) => ({
    toasts: [],
    show: (kind, message) => {
      next += 1;
      const id = next;
      set((state) => ({ toasts: [...state.toasts, { id, kind, message }].slice(-TOAST_LIMIT) }));
      return id;
    },
    dismiss: (id) => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
    },
  }));
}

/**
 * What a command needs to raise one — the whole of it, so a command's dependency bag names
 * this and never the store.
 *
 * A command that could `dismiss` could take another command's toast off screen, and nothing
 * in the feature set wants that; handing out only `show` makes it unrepresentable rather than
 * merely unused (B5).
 */
export type ShowToast = (kind: ToastKind, message: MessageKey) => void;
