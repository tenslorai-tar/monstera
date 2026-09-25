import type { DocId } from '@monstera/shared';

import type { AutosaveInterval } from './settings/saving.js';

/** The interval in milliseconds, or `null` for off. */
export function autosaveEvery(interval: AutosaveInterval): number | null {
  return interval === 'off' ? null : Number(interval) * 60_000;
}

export interface Autosave {
  /** One pass: save every document with unsaved changes that is not paused. Overlapping passes do nothing. */
  tick(): Promise<void>;
}

/**
 * Autosave's decision, apart from the timer that calls it (`App.tsx`'s `useAutosave`).
 *
 * ## It saves through Save's own path
 *
 * `save` is the Save command's `saveDocument` — the same channel, the same reading of the answer, the same
 * dialog for a refusal — so an autosave and a Ctrl+S cannot disagree about what saving means (B3a). Only the
 * toast differs: a *Saved* every few minutes would be noise, and the status bar already says *Saved just now*.
 *
 * ## A refused save PAUSES that document until it is clean again
 *
 * A refusal opens the save-problem dialog — the file changed on disk, or could not be written. Retrying on
 * the next tick would reopen that dialog every interval until the person gave in, so the document is skipped
 * until it has no unsaved changes, which a manual save that works (or an undo back to the saved state) makes
 * true. A document that is clean is never saved, so autosave writes nothing a person did not change.
 */
export function createAutosave(deps: {
  /** The open documents with unsaved changes, read at each pass. */
  readonly dirty: () => readonly DocId[];
  /** Saves one, answering whether it saved. */
  readonly save: (docId: DocId) => Promise<boolean>;
}): Autosave {
  const paused = new Set<DocId>();
  let running = false;
  return {
    tick: async () => {
      if (running) return;
      running = true;
      try {
        const dirty = deps.dirty();
        for (const docId of [...paused]) if (!dirty.includes(docId)) paused.delete(docId);
        for (const docId of dirty) {
          if (paused.has(docId)) continue;
          if (!(await deps.save(docId))) paused.add(docId);
        }
      } finally {
        running = false;
      }
    },
  };
}
