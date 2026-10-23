/** What starting a component found: it started, it could not, or there is nothing to start here. */
export type StartReading = 'started' | 'cannot-start' | 'not-checked';

/** A host that can be started ahead of its first call, by whoever asked. */
export interface StartsAhead {
  readonly starts: (asker: 'editing-mode') => Promise<StartReading>;
}

/**
 * The hosts an editing mode's first write uses, started as the mode is chosen (ADR-0048's correction of 2026-10-20, and
 * ADR-0237's of 2026-10-23), and answers whether the editing engine started.
 *
 * TWO HOSTS, because a PDFium write is preceded by ADR-0126's inline-image keeper, which runs in the COMPOSE host: left to
 * the first write, that host's start was 2.39 of the 2.55 s the write took in `main` (the PDFium apply inside it 60 ms;
 * `textHoldProbe`, dev build at 7b4cd7bc, 2026-10-23, a later start). Started together, so the mode waits for the slower
 * of the two rather than their sum. The answer is the writer's alone: a keeper that cannot start leaves the edit to run on
 * the image as it is (`keepInlineImages`), so it is never a reason to say editing is unavailable.
 */
export async function startEditingHosts(pdfium: StartsAhead | null, compose: StartsAhead | null): Promise<boolean> {
  // NO WRITER, NO WRITE: the keeper runs only before a PDFium write, so without one its host is started for nothing.
  if (pdfium === null) return false;
  const [writer] = await Promise.all([pdfium.starts('editing-mode'), compose?.starts('editing-mode')]);
  return writer === 'started';
}
