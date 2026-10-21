import type { DocId } from '@monstera/shared';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

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
 * ## Held in a store of its own, never in the shell's state
 *
 * The holder's reason ([ADR-0257](../../../docs/DECISIONS/0257-a-released-mark-is-held-in-its-final-look-until-the-page-draws-it.md)'s
 * correction of 2026-10-21): as `App` state, finishing the words rendered the whole shell, and a writer's held look
 * reached the page only once that render had committed — 31 to 89 ms after the key, against 6 to 11 for a mark with no
 * words. Here only the pane that draws the editor subscribes (`useWritingOn`), so finishing renders that pane.
 *
 * Nothing is read from the store during a render but through `useSyncExternalStore`, so the registries built with
 * `write` hold a function that reads no ref while they are built — the coupling the compiler's lint refuses.
 */

/** The pending request: the document it belongs to, the request, its draft, and where its answer goes. */
interface PendingWrite {
  readonly id: number;
  readonly docId: DocId;
  readonly request: WriteRequest;
  readonly draft: Draft;
  readonly resolve: (words: string | undefined) => void;
}

/** The pending request as the panes read it: its document, and the request as a page list draws it. */
export interface WritingNow {
  readonly docId: DocId;
  readonly writing: PageWriting;
}

/** The window's one request for words, outside every component's state. */
export interface PageWritings {
  /** Asks `docId`'s pages for words, and settles with them or `undefined` for none. */
  readonly write: (docId: DocId, request: WriteRequest) => Promise<string | undefined>;
  /** Answers the pending request with nothing if its document is not among `open`. */
  readonly settleClosed: (open: readonly DocId[]) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => WritingNow | undefined;
}

/** One number per request in the session, so each is drawn by an editor of its own. Read and moved only in `write`. */
let lastWriteId = 0;

export function createPageWritings(): PageWritings {
  let now: WritingNow | undefined;
  let pending: PendingWrite | undefined;
  const listeners = new Set<() => void>();
  const tell = (): void => {
    for (const listener of listeners) listener();
  };
  const show = (next: PendingWrite | undefined): void => {
    pending = next;
    now =
      next === undefined
        ? undefined
        : {
            docId: next.docId,
            writing: {
              id: next.id,
              request: next.request,
              draft: next.draft,
              onDone: (words) => {
                next.resolve(words);
                // ONLY THIS REQUEST: a second one may already have taken its place.
                if (pending === next) show(undefined);
              },
            },
          };
    tell();
  };
  return {
    write: (docId, request) =>
      new Promise<string | undefined>((resolve) => {
        lastWriteId += 1;
        const previous = pending;
        if (previous !== undefined) {
          const settled = settle(previous.request, previous.draft.read(), 'replaced');
          previous.resolve(settled.stays ? undefined : settled.answer);
        }
        show({ id: lastWriteId, docId, request, draft: draftOf(request.initial), resolve });
      }),
    settleClosed: (open) => {
      if (pending === undefined || open.includes(pending.docId)) return;
      pending.resolve(undefined);
      show(undefined);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => now,
  };
}

export function usePageWriting(
  activeId: DocId | undefined,
  tabs: readonly { readonly docId: DocId }[],
): {
  /** Asks the document on show for words, and settles with them or `undefined` for none. */
  readonly write: Write;
  /** The window's request, for the pane that draws it (`useWritingOn`); never subscribed to here. */
  readonly writings: PageWritings;
} {
  const [writings] = useState(createPageWritings);

  const write = useCallback<Write>(
    (request) => (activeId === undefined ? Promise.resolve(undefined) : writings.write(activeId, request)),
    [activeId, writings],
  );

  // A CLOSED DOCUMENT'S REQUEST answers nothing: its words have no page left to go on. Told here rather than at the
  // next request, so the tool that asked is not left waiting.
  useEffect(() => {
    writings.settleClosed(tabs.map((tab) => tab.docId));
  }, [tabs, writings]);

  return { write, writings };
}

const NO_SUBSCRIBE = (): (() => void) => () => undefined;
const NO_WRITING = (): undefined => undefined;

/** The pending request if it is `docId`'s, for that document's pane: the one place the store is subscribed. */
export function useWritingOn(writings: PageWritings | undefined, docId: DocId): PageWriting | undefined {
  const now = useSyncExternalStore(writings?.subscribe ?? NO_SUBSCRIBE, writings?.getSnapshot ?? NO_WRITING);
  // ONLY THE REQUEST'S OWN DOCUMENT draws it; another on show leaves it waiting with its draft.
  return now?.docId === docId ? now.writing : undefined;
}
