/**
 * What this window has in flight and has finished, by kind, on the root element: `data-<kind>` in flight and
 * `data-<kind>-done` finished. What a walk waits on instead of a sleep (the stage audit's GGGGGGGG-3): note the finished
 * count, act, then wait until it has passed the note with none in flight. The finished count only grows, so a reading
 * taken before the work began cannot pass for one after it (CLAUDE.md 4b: freshness by a marker that postdates the
 * action).
 *
 * ONE COUNTER FOR EVERY KIND, so a second kind is a name and not a second copy of the counting.
 *
 * - `writes`: every command (`applyDocumentCommand`), and Undo and Redo, which move the version through their own
 *   channels. NOT counted, said so a walk does not wait on them: the writes with channels of their own
 *   (`document.sign`, `placeSignature`, `placeImage`, `placeBarcode`, `pasteAnnotations`, `insertImage`, `optimize`,
 *   `unlock`, `restoreBackup`, `reimportExternalEdit`), which a walk waits for by what each shows.
 * - `works`: every piece of main's work run under a progress notice (`withWorkProgress`), from its ask until main
 *   answers, so a walk can read that a notice was NOT shown once the work has ended rather than after a pause.
 */
export type InFlightKind = 'writes' | 'works';

const counts: Record<InFlightKind, { inFlight: number; done: number }> = {
  writes: { inFlight: 0, done: 0 },
  works: { inFlight: 0, done: 0 },
};

/** Runs `work`, counted as `kind` from its start until it settles either way. */
export async function countedAs<T>(kind: InFlightKind, work: () => Promise<T>): Promise<T> {
  counts[kind].inFlight += 1;
  mark(kind);
  try {
    return await work();
  } finally {
    counts[kind].inFlight -= 1;
    counts[kind].done += 1;
    mark(kind);
  }
}

/** How many writes and works are in flight now, together: what a layer behind waits on before it parks (ADR-0129). */
export function inFlightNow(): number {
  return counts.writes.inFlight + counts.works.inFlight;
}

function mark(kind: InFlightKind): void {
  // NO DOCUMENT in a case run under Node, where the counts are kept and nothing is marked.
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(`data-${kind}`, String(counts[kind].inFlight));
  document.documentElement.setAttribute(`data-${kind}-done`, String(counts[kind].done));
}
