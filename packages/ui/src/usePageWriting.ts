import type { DocId } from '@monstera/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { PageWriting } from './PageList.js';
import { type Draft, type Write, type WriteRequest, draftOf, settle } from './pageWriting.js';

/**
 * The window's one request for words typed on a page (ADR-0154 Decision 2 and its correction), and the means to make
 * one.
 *
 * ## A request belongs to its document
 *
 * Drawn over its page while that document is on show, not drawn while another is, and drawn again from its draft when
 * its document returns. A document **closed** with a request open answers it with nothing, as a dismissed dialog sent
 * nothing, so the tool that asked is not left waiting. Only a second request finishes the first — `settle`'s
 * *replaced*, with the words typed so far — because that is a moment the application is already in.
 *
 * ## `useDialogHost`'s shape, and for its reason
 *
 * State and no refs: the request is replaced inside the state updater, which is where a second `ask` dismisses the
 * first. React may run an updater twice, and the side effect there is settling a promise, which ignores a second
 * settle. A ref read by `write` would be read from a function the registries are built with during render, which is
 * the coupling the compiler's lint refuses — it cannot know no tool calls `write` while it is being constructed.
 */

/** The pending request: the document it belongs to, the request, its draft, and where its answer goes. */
interface PendingWrite {
  readonly id: number;
  readonly docId: DocId;
  readonly request: WriteRequest;
  readonly draft: Draft;
  readonly resolve: (words: string | undefined) => void;
}

/** One number per request in the session, so each is drawn by an editor of its own. Read and moved only in `write`. */
let lastWriteId = 0;

export function usePageWriting(
  activeId: DocId | undefined,
  tabs: readonly { readonly docId: DocId }[],
): {
  /** Asks the document on show for words, and settles with them or `undefined` for none. */
  readonly write: Write;
  /** The document the pending request belongs to, or `undefined` for none. */
  readonly writingDocId: DocId | undefined;
  /** The pending request as a page list draws it, or `undefined` for none. */
  readonly writing: PageWriting | undefined;
} {
  const [pending, setPending] = useState<PendingWrite | undefined>(undefined);

  const write = useCallback<Write>(
    (request) =>
      new Promise<string | undefined>((resolve) => {
        if (activeId === undefined) {
          resolve(undefined);
          return;
        }
        lastWriteId += 1;
        const next: PendingWrite = { id: lastWriteId, docId: activeId, request, draft: draftOf(request.initial), resolve };
        setPending((previous) => {
          if (previous !== undefined) {
            const settled = settle(previous.request, previous.draft.read(), 'replaced');
            previous.resolve(settled.stays ? undefined : settled.answer);
          }
          return next;
        });
      }),
    [activeId],
  );

  // A CLOSED DOCUMENT'S REQUEST answers nothing: its words have no page left to go on. Told here rather than at the
  // next request, so the tool that asked is not left waiting. The state entry stays — writing it here is a state write
  // in an effect body — and is never drawn, since no document on show is its own; the next request replaces it, and
  // settling it again there is a promise ignoring a second settle.
  useEffect(() => {
    if (pending !== undefined && !tabs.some((tab) => tab.docId === pending.docId)) pending.resolve(undefined);
  }, [pending, tabs]);

  const writing = useMemo<PageWriting | undefined>(() => {
    if (pending === undefined) return undefined;
    return {
      id: pending.id,
      request: pending.request,
      draft: pending.draft,
      onDone: (words) => {
        pending.resolve(words);
        // ONLY THIS REQUEST: a second one may already have taken its place.
        setPending((current) => (current === pending ? undefined : current));
      },
    };
  }, [pending]);

  return { write, writingDocId: pending?.docId, writing };
}
