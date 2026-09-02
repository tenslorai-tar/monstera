import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';
import { type ReactElement, useEffect, useState } from 'react';

import {
  LINKS_EMPTY,
  LINKS_EXTERNAL,
  LINKS_LABEL,
  LINKS_TO_PAGE,
  LINKS_UNAVAILABLE,
} from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';

/**
 * The links on the page the reader is looking at.
 *
 * ## An INTERNAL link is a control; an EXTERNAL one is not
 *
 * Invariant 24: opening a document runs none of its content, and **no external
 * fetch until the user asks, for that item**. So a link into the document gets
 * a button that jumps, and a link out of it is shown as its URI with nothing to
 * press. That is not a placeholder — a control that opened a browser is a
 * separate decision with its own confirmation, and offering one that quietly
 * did nothing would be the display-only defect.
 *
 * The split is not computed here. The channel carries `kind` because MuPDF is
 * what knows, and a panel working it out from the URI would be a second opinion
 * about the one question this invariant rests on (B3a).
 *
 * ## ONE PAGE, which is the channel's shape and this panel's job
 *
 * A links panel shows where the reader can go from where they are. Fetching
 * every link in a thousand-page document to show twelve is what invariant 11
 * forbids per operation, and it is also not what a reader asked.
 */
export function LinksPanel({
  client,
  docId,
  page,
  onJump,
}: {
  readonly client: ContractClient;
  /** `undefined` with no document open, which renders nothing. */
  readonly docId: DocId | undefined;
  /** The page the reader is on, zero-based. `undefined` with no document. */
  readonly page: number | undefined;
  /** Takes the reader to a page, recording the jump. */
  readonly onJump: (page: number) => void;
}): ReactElement | null {
  const { i18n } = useLingui();
  const [state, setState] = useState<PanelState>({ kind: 'idle' });

  useEffect(() => {
    if (docId === undefined || page === undefined) return;
    let cancelled = false;

    void client['document.pageLinks']({ docId, page }).then(
      (answer) => {
        if (cancelled) return;
        // A REFUSAL IS ITS OWN STATE, not an empty list. "This page has no
        // links" and "we could not ask" are different things to tell a reader,
        // and collapsing them makes the second invisible — which is the
        // reassuring answer for a document that is busy or poisoned.
        setState(
          answer.ok
            ? { kind: 'links', page, links: answer.value.links }
            : { kind: 'unavailable', page },
        );
      },
      () => {
        if (!cancelled) setState({ kind: 'unavailable', page });
      },
    );

    return (): void => {
      cancelled = true;
    };
  }, [client, docId, page]);

  // THE STATE CARRIES THE PAGE IT DESCRIBES, and this is where that is spent.
  //
  // Clearing the state when the page changes would be a `setState` inside the
  // effect's synchronous body, which the React compiler reports as a cascading
  // render — correctly. Comparing instead means the panel shows nothing rather
  // than the PREVIOUS page's links while the new answer is in flight, which is
  // the defect that would otherwise have been invisible: stale links look
  // exactly like current ones.
  if (docId === undefined || page === undefined || state.kind === 'idle') return null;
  if (state.page !== page) return null;

  return (
    <nav className="m-links-panel" aria-label={i18n._(LINKS_LABEL)}>
      {state.kind === 'unavailable' ? (
        <p className="m-links-empty">{i18n._(LINKS_UNAVAILABLE)}</p>
      ) : state.links.length === 0 ? (
        <p className="m-links-empty">{i18n._(LINKS_EMPTY)}</p>
      ) : (
        <ul className="m-links-list">
          {state.links.map((link, at) => (
            // THE INDEX IS THE KEY, and it is the right one here: a page's
            // links have no identity of their own, the list is replaced whole
            // when the page changes, and nothing in it is reordered or removed
            // in place. A key invented from the URI would collide on a page
            // that links to the same place twice, which is common.
            <li key={at}>
              {link.kind === 'internal' ? (
                <button
                  type="button"
                  className="m-links-item"
                  onClick={() => {
                    onJump(link.page);
                  }}
                >
                  {i18n._(LINKS_TO_PAGE, { page: pdfjsPageOf(link.page) })}
                </button>
              ) : (
                <span className="m-links-external">
                  {i18n._(LINKS_EXTERNAL, { uri: link.uri })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

/** One link, as the contract carries it. */
type PanelLink =
  | { readonly kind: 'internal'; readonly page: number }
  | { readonly kind: 'external'; readonly uri: string };

/**
 * What the panel is showing.
 *
 * Three states rather than a list plus a flag: `idle` renders nothing,
 * `unavailable` says the ask was refused, and `links` carries an answer that
 * may legitimately be empty. A list plus `failed: boolean` would make
 * *refused, and here are no links* representable, which is a state nothing can
 * produce and every reader has to rule out (B5).
 */
type PanelState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'unavailable'; readonly page: number }
  | { readonly kind: 'links'; readonly page: number; readonly links: readonly PanelLink[] };
