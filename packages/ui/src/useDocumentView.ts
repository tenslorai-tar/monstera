import type { ContractClient } from '@monstera/contract';
import type { DocId, DocVersion } from '@monstera/shared';
import { useEffect, useRef, useState } from 'react';

import type { ViewKeys } from './documentKeys.js';
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
 * ## A NEW VERSION REPLACES the shown view; it never empties it first
 *
 * Every command moves the version, and a moved version needs a new parser
 * (ADR-0031: the old one's byte offsets belong to bytes that no longer exist).
 * This hook used to clear the shown view in the effect's cleanup and then open
 * the next, so for the whole parse the caller had no view and rendered an empty
 * page area: every edit blanked the pages and then drew them again.
 *
 * So the shown view stays until the next one HAS OPENED, and is then replaced in
 * one state change. The old view is closed by the effect that owns the shown
 * view, whose cleanup React runs after the commit that shows its successor, so
 * no committed render holds a view that has been closed.
 *
 * What makes keeping it legal under ADR-0031 is that the old view is not asked
 * for anything new. Its pages are already pixels on screen, and pixels need no
 * range. A draw it does start in the gap (a page scrolled into the margin while
 * the next view parses) asks for a range at the old version, which main refuses
 * with `stale` exactly as before; the transport then closes that view itself,
 * the page's draw fails without touching its canvas (`renderPage` presents a
 * drawing only once it is whole), and the successor redraws it a moment later.
 * Main's rule is unchanged and still decides: no byte of the new version is
 * ever read through the old view's offsets.
 *
 * A view that opened after its version was already superseded is closed by the
 * effect that opened it and never shown.
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
  /**
   * The passwords this person typed for THIS document, and where a newly accepted one is kept
   * ([ADR-0171](../../../docs/DECISIONS/0171-the-password-is-held-in-main-while-the-document-is-open.md) Decision 7).
   *
   * Required, for `requestPassword`'s reason: a caller holding no keys says so with {@link NO_KEYS}, so a view that asks
   * at every version is a choice someone wrote rather than a parameter someone forgot.
   */
  keys: ViewKeys,
): {
  /** The live view, or `undefined` while it opens or after it fails. */
  readonly ready: DocumentView | undefined;
  /** Whether the parse threw. Distinct from *not yet*, which `ready` says. */
  readonly failed: boolean;
} {
  const [failed, setFailed] = useState(false);
  // KEYED BY DOCUMENT, so a view is only ever kept across a version of ITS document. The callers
  // remount per document today; this makes another document's pages unrepresentable rather than
  // relying on that.
  const [shown, setShown] = useState<{ readonly docId: DocId; readonly view: DocumentView } | undefined>(undefined);

  const { docId, version, byteLength } = document;

  // EVERY VIEW THIS HOOK OPENED AND HAS NOT CLOSED, for the one path the shown-view effect below
  // cannot reach: a view handed to state in the same batch that unmounts the caller never commits,
  // so that effect never runs for it. The old cleanup closed it directly; this keeps that guarantee.
  // `close` is idempotent.
  const opened = useRef(new Set<DocumentView>());
  useEffect(() => {
    const views = opened.current;
    return (): void => {
      for (const view of views) void view.close();
      views.clear();
    };
  }, []);

  // THE SHOWN VIEW'S LIFETIME, separate from the opening effect's. The cleanup runs when `shown` is
  // replaced, after the commit that renders the replacement, and on unmount.
  useEffect(() => {
    if (shown === undefined) return;
    const views = opened.current;
    return (): void => {
      views.delete(shown.view);
      void shown.view.close();
    };
  }, [shown]);

  useEffect(() => {
    let cancelled = false;
    const stopped = (): boolean => cancelled;
    let view: DocumentView | undefined;
    // A RANGE THE VIEW COULD NOT SERVE (CR-COR-12): the view has closed itself and its parser is waiting for bytes that will
    // not come. The page area empties and the caller's `failed` surface says the document cannot be shown, where it used
    // to stay blank for ever.
    const onFailed = (): void => {
      if (stopped()) return;
      setShown(undefined);
      setFailed(true);
    };

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
        const opened = await openDocumentView({
          client,
          docId,
          version,
          byteLength,
          onVersionMoved,
          onFailed,
          password,
        });
        // KEPT ONLY ONCE THE PARSE TOOK IT, so a key held is one that opened this document.
        keys.hold(password);
        return opened;
      }
    };

    /**
     * Opens the view with a key this person already typed for the document, newest first, or `undefined` when none
     * opens it. Main is not asked: it holds its own key, and these are only for this renderer's parse. A key PDF.js
     * refuses is tried past, since an undo of a protect makes the newest key the wrong one.
     */
    const openWithHeldKey = async (): Promise<DocumentView | undefined> => {
      for (const key of keys.held()) {
        if (stopped()) return undefined;
        try {
          return await openDocumentView({ client, docId, version, byteLength, onVersionMoved, onFailed, password: key.reveal() });
        } catch (cause) {
          if (!needsPasswordToParse(cause)) throw cause;
        }
      }
      return undefined;
    };

    const show = async (): Promise<void> => {
      try {
        try {
          view = await openDocumentView({ client, docId, version, byteLength, onVersionMoved, onFailed });
        } catch (cause) {
          // THE ONE FAILURE THAT IS A QUESTION rather than a defect. Everything
          // else falls through to the outer catch and becomes `failed`.
          if (!needsPasswordToParse(cause)) throw cause;
          if (stopped()) return;
          view = (await openWithHeldKey()) ?? (await openWithPassword());
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
        // which those are. From here the shown-view effect owns the close.
        opened.current.add(view);
        setShown({ docId, view });
        setFailed(false);
      } catch {
        // A parse that fails is a document this renderer cannot show. Not a
        // crash and not silence: the caller says so through `failed`, and the
        // diagnostic belongs to main, the only side that may hold one.
        if (!stopped()) setFailed(true);
      }
    };

    void show();

    // NOTHING IS CLOSED HERE. A view still opening sees `stopped()` on its late path and closes
    // itself; a view already shown belongs to the shown-view effect, and closing it here is what
    // used to empty the page area for the length of every reparse.
    return (): void => {
      cancelled = true;
    };
  }, [byteLength, client, docId, keys, onVersionMoved, requestPassword, version]);

  return { ready: shown?.docId === docId ? shown.view : undefined, failed };
}
