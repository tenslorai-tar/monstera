import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useEffect, useState } from 'react';

import { type DocumentView, openDocumentView } from './documentView.js';

/**
 * One document's live parser, opened on mount and closed on the way out.
 *
 * ## Extracted for a SECOND caller, and that is the whole reason
 *
 * This was the body of `PageCanvas`, which is the right home while one
 * document is on screen. Side-by-side compare puts a second document in a
 * second pane, and that pane needs the same lifetime — the same cancellation,
 * the same close-on-the-late-path, the same clear-before-close. A copy would be
 * two opinions about when a parser dies (B3a), and the failure of the wrong one
 * is a leaked worker and transport that nothing reports.
 *
 * ## What the hazards are, kept from the original
 *
 * `stopped()` is READ THROUGH A CALL rather than as a variable, and the reason
 * is a narrowing that would delete a guard. There are two suspension points and
 * therefore two reads; after the first `if (stopped()) return`, TypeScript
 * narrows a boolean variable to `false` for the rest of the block and does not
 * widen it across an `await`, because it models no concurrent writer. The only
 * assignment it would learn from is in the cleanup, which flow analysis never
 * connects to this body. The second read then lints as always falsy, and both
 * obvious responses are wrong: deleting the guard removes the check that
 * matters most, and disabling the rule turns off a check that is right about
 * every other line here. A call has no narrowing to inherit.
 *
 * The late path CLOSES rather than returning: the cleanup has already run and
 * read `view` while it was still `undefined`, so a document closed while its
 * view was opening leaked a parser, a worker and a transport every time.
 *
 * The state is CLEARED BEFORE the close, so no render can hold a torn-down
 * view. Separating them is how a component draws through a closed parser for
 * one frame, which reads as an intermittent blank page.
 */
export function useDocumentView(
  client: ContractClient,
  document: {
    readonly docId: DocId;
    readonly version: DocVersion;
    readonly byteLength: number;
  },
  /**
   * Told when the parser reports a version the renderer had not seen.
   *
   * Required rather than optional: a caller that wanted to ignore it has to
   * say so, because a view whose version moves with nobody listening is a
   * renderer reading a document at a version it does not know it has.
   */
  onVersionMoved: (next: { readonly version: DocVersion; readonly byteLength: number }) => void,
): {
  /** The live view, or `undefined` while it opens or after it fails. */
  readonly ready: DocumentView | undefined;
  /** Whether the parse threw. Distinct from *not yet*, which `ready` says. */
  readonly failed: boolean;
} {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState<DocumentView | undefined>(undefined);

  const { docId, version, byteLength } = document;

  useEffect(() => {
    let cancelled = false;
    const stopped = (): boolean => cancelled;
    let view: DocumentView | undefined;

    const show = async (): Promise<void> => {
      try {
        view = await openDocumentView({ client, docId, version, byteLength, onVersionMoved });
        if (stopped()) {
          await view.close();
          return;
        }
        // HANDED ON, and this hook's job ends at a live view. The model read
        // lives in the scroller, because with continuous scroll the pages to
        // read rotations FOR are the ones on screen, and nothing here knows
        // which those are.
        setReady(view);
      } catch {
        // A parse that fails is a document this renderer cannot show. Not a
        // crash and not silence: the caller says so through `failed`, and the
        // diagnostic belongs to main, the only side that may hold one.
        if (!stopped()) setFailed(true);
      }
    };

    void show();

    return (): void => {
      cancelled = true;
      setReady(undefined);
      void view?.close();
    };
  }, [byteLength, client, docId, onVersionMoved, version]);

  return { ready, failed };
}
