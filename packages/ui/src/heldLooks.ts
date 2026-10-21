import type { DocVersion } from '@monstera/shared';

import type { MarkLook } from './markLook.js';

/**
 * A document's ONE holder of released marks in their final look, until its pages draw them
 * ([ADR-0257](../../../docs/DECISIONS/0257-a-released-mark-is-held-in-its-final-look-until-the-page-draws-it.md)).
 *
 * Every route that ends a mark holds through it — a drawing tool's release, a text selection's markup, a writer, a
 * stamp, a signature — so no route keeps a second. Each entry is shown by its page while that page is drawn from the
 * version the mark was released over, and dropped when the page draws a newer one.
 *
 * ## A store of its own, beside the document's, and why
 *
 * The application subscribes to the document's store whole, so a write there renders the whole shell. A hold is made in
 * the frame of a release and must be painted within it: measured 2026-10-21 on pinned Chromium, a look held through the
 * document's store reached the screen 33 to 167 ms after the release (13 tools, three runs each), the long ones the
 * shell's own render. Only the page slots subscribe here, so a hold renders the page it is on and nothing else.
 */

/** A mark held in its final look on one page, from the version it was released over. */
export interface HeldLook {
  readonly page: number;
  readonly look: MarkLook;
  /** The version the page showed when the mark was released: a page drawn from a newer one draws the mark itself. */
  readonly at: DocVersion;
}

export interface HeldLooks {
  /** Every look held on this document, for `useSyncExternalStore`: a new array on every change, the same one between. */
  readonly getSnapshot: () => readonly HeldLook[];
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Holds `look` on `page` until that page is drawn from a version newer than the document's now, and answers the
   * entry, which {@link letGo} takes to drop it sooner — a command refused, which made nothing.
   */
  readonly hold: (page: number, look: MarkLook) => HeldLook;
  /** Drops a held look: refused, or drawn by its page. Idempotent, so the page and a refusal may both drop it. */
  readonly letGo: (entry: HeldLook) => void;
}

/** A holder for one document, which reads the document's version at each hold. */
export function createHeldLooks(version: () => DocVersion): HeldLooks {
  let looks: readonly HeldLook[] = [];
  const listeners = new Set<() => void>();
  const changed = (next: readonly HeldLook[]): void => {
    looks = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => looks,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hold: (page, look) => {
      const entry: HeldLook = { page, look, at: version() };
      changed([...looks, entry]);
      return entry;
    },
    letGo: (entry) => {
      if (!looks.includes(entry)) return;
      changed(looks.filter((each) => each !== entry));
    },
  };
}

/**
 * Resolves after the next frame has been painted: a frame's callback, then a task after it.
 *
 * A held look is sent its command only after this (ADR-0257). Measured 2026-10-21 on pinned Chromium: the answer to a
 * command arrives 33 to 99 ms after the release and the shell's handling of it is a task of 60 to 110 ms; where the
 * answer came before the first frame after the release, that task ran first and the look was painted 99 to 153 ms
 * after the release instead of 12 to 30. Sent after a painted frame, the answer cannot come before the look is on
 * screen; the command waits one frame, and only when a look was held.
 */
export function afterNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * Sends a command whose mark is held in its final look meanwhile: the look held, painted, then the command sent, and the
 * look dropped if the command made nothing. The one sequence for every route that is not the drawing overlay's — a text
 * selection's markup from the tool or the menu, a placed stamp or signature — so none of them orders it differently.
 *
 * @returns whether the document's version moved, as `send` answers it.
 */
export async function sendHeld(
  holder: Pick<HeldLooks, 'hold' | 'letGo'> | undefined,
  page: number,
  look: MarkLook | undefined,
  send: () => Promise<boolean>,
  afterPaint: () => Promise<void> = afterNextPaint,
): Promise<boolean> {
  const entry = look === undefined || holder === undefined ? undefined : holder.hold(page, look);
  if (entry !== undefined) await afterPaint();
  const moved = await send();
  if (!moved && entry !== undefined) holder?.letGo(entry);
  return moved;
}

/**
 * The looks a page shows: its own, each released over a version this page still shows. A page drawn from a NEWER
 * version draws the marks itself, so the look is no longer shown in the render that carries that drawing — the one rule
 * for when a held look leaves, which the page applies and {@link released} names for the holder to drop.
 */
export function heldOnPage(looks: readonly HeldLook[], page: number, drawn: DocVersion | undefined): readonly HeldLook[] {
  return looks.filter((entry) => entry.page === page && (drawn === undefined || drawn <= entry.at));
}

/** The looks of `page` its drawing at version `drawn` has replaced, for the holder to drop. */
export function released(looks: readonly HeldLook[], page: number, drawn: DocVersion): readonly HeldLook[] {
  return looks.filter((entry) => entry.page === page && entry.at < drawn);
}
