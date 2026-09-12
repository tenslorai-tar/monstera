import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useEffect, useState } from 'react';

import { type DocumentView, needsPasswordToParse, openDocumentView } from './documentView.js';

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
  /**
   * Asks a person for this document's password, or answers `undefined` when
   * they decline
   * ([ADR-0055](../../../../docs/DECISIONS/0055-a-password-crosses-into-the-host-and-unlocking-is-an-open.md)).
   *
   * **A parameter rather than a dialog opened here**, for `onVersionMoved`'s
   * reason: `App.tsx`'s `ask` is bound to the dialog host for that render, and
   * a hook that reached for one would be a second wiring place. `retry` is
   * passed so the second prompt can say what happened to the first.
   *
   * Required, not optional. A caller that wants to refuse the whole flow has to
   * say so by answering `undefined`, because a hook that silently skipped the
   * prompt would report an encrypted document as one this renderer cannot show
   * — which is the sentence a person sees instead of being asked.
   */
  requestPassword: (retry: boolean) => Promise<string | undefined>,
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

    /**
     * Opens the view, asking for a password if the parser cannot proceed
     * without one.
     *
     * ## MAIN IS ASKED FIRST, every time, and that ordering is the design
     *
     * `document.unlock` is what decides whether a password is right, because
     * MuPDF is the writer of record for encryption and PDF.js is never a source
     * of truth (§3.2). Only a password main accepted reaches `getDocument`, so
     * the two parsers cannot end up disagreeing in the direction that matters —
     * a page drawn from a document main could not open.
     *
     * It also does the necessary work either way: main has no engine session
     * for this document until somebody unlocks it, so a renderer that gave the
     * password only to PDF.js would show a document that refuses every command.
     *
     * ## The loop is bounded by the PERSON, not by a count
     *
     * A dismissal ends it. There is no attempt limit, because there is nothing
     * here for one to protect: the document is already on this machine, in this
     * process, and a person guessing at their own file is not an attacker. A
     * cap would only lock somebody out of their own document and make them
     * close and reopen it.
     */
    const openWithPassword = async (): Promise<DocumentView | undefined> => {
      let retry = false;
      for (;;) {
        const password = await requestPassword(retry);
        // DISMISSED. Not a failure to report — a person who changes their mind
        // about opening a protected document has not hit an error — but there
        // is no view, so the caller shows the same *cannot display* surface a
        // failed parse produces.
        if (password === undefined) return undefined;
        if (stopped()) return undefined;

        const unlocked = await client['document.unlock']({ docId, password });
        if (stopped()) return undefined;
        // A REFUSAL FROM THE CHANNEL ITSELF — the document closed while
        // somebody was typing — ends the loop rather than asking again. There
        // is nothing left to unlock.
        if (!unlocked.ok) return undefined;
        if (unlocked.value.kind === 'wrong-password') {
          retry = true;
          continue;
        }
        // `not-locked` reaches here too, and it is not a contradiction: the
        // engine may have had no `/Encrypt` dictionary at all while PDF.js
        // refused for a reason of its own. Handing the password to the parser
        // is still the right next step, and if the parser refuses again the
        // loop asks again.
        return openDocumentView({
          client,
          docId,
          version,
          byteLength,
          onVersionMoved,
          password,
        });
      }
    };

    const show = async (): Promise<void> => {
      try {
        try {
          view = await openDocumentView({ client, docId, version, byteLength, onVersionMoved });
        } catch (cause) {
          // THE ONE FAILURE THAT IS A QUESTION rather than a defect. Everything
          // else falls through to the outer catch and becomes `failed`.
          if (!needsPasswordToParse(cause)) throw cause;
          if (stopped()) return;
          view = await openWithPassword();
          if (view === undefined) {
            if (!stopped()) setFailed(true);
            return;
          }
        }
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
  }, [byteLength, client, docId, onVersionMoved, requestPassword, version]);

  return { ready, failed };
}
