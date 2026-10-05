import { useLingui } from '@lingui/react';
import type { ContractClient } from '@monstera/contract';
import type { DocId } from '@monstera/shared';
import { type ReactElement, useEffect, useState } from 'react';

import {
  LINKS_EMPTY,
  LINKS_EXTERNAL,
  LINKS_LABEL,
  LINKS_TO_PAGE,
  LINKS_TRUNCATED,
  LINKS_UNAVAILABLE,
} from './messages/en.js';
import type { FollowedLink } from './LinkLayer.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { readWholeList } from './readWholeList.js';
import type { PageLinkOnPage } from './usePageLinks.js';

/**
 * The links on the page the reader is looking at.
 *
 * ## Both kinds are controls, and they take the page's ONE route
 *
 * Invariant 24: opening a document runs none of its content, and **no external
 * fetch until the user asks, for that item**. A link into the document jumps; a
 * link out of it is pressed, then named in a dialog, then opened by `main`
 * reading the address from the document (ADR-0167). Both go through `onFollow`,
 * the same function a link pressed on the page goes through, so the panel and
 * the page cannot follow links two different ways.
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
  onFollow,
}: {
  readonly client: ContractClient;
  /** `undefined` with no document open, which renders nothing. */
  readonly docId: DocId | undefined;
  /** The page the reader is on, zero-based. `undefined` with no document. */
  readonly page: number | undefined;
  /** Follows a link, by its page and its place on it: the route a link pressed on the page takes too (ADR-0167). */
  readonly onFollow: (followed: FollowedLink) => void;
}): ReactElement | null {
  const { i18n } = useLingui();
  const [state, setState] = useState<PanelState>({ kind: 'idle' });

  useEffect(() => {
    if (docId === undefined || page === undefined) return;
    let cancelled = false;

    // IN PARTS, read whole (ADR-0130): a link-heavy index page can carry thousands.
    void readWholeList(
      (from) => client['document.pageLinks']({ docId, page, from }),
      (part) => part.links,
    ).then(
      (answer) => {
        if (cancelled) return;
        // A REFUSAL IS ITS OWN STATE, not an empty list. "This page has no
        // links" and "we could not ask" are different things to tell a reader,
        // and collapsing them makes the second invisible — which is the
        // reassuring answer for a document that is busy or poisoned.
        setState(
          answer.ok
            ? { kind: 'links', page, links: answer.value.items, truncated: answer.value.last.truncated }
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
              <button
                type="button"
                className={link.kind === 'internal' ? 'm-links-item' : 'm-links-item m-links-external'}
                data-links-item={String(at)}
                onClick={() => {
                  onFollow({ page: state.page, index: at, link });
                }}
              >
                {link.kind === 'internal' ? (
                  i18n._(LINKS_TO_PAGE, { page: pdfjsPageOf(link.page) })
                ) : (
                  // THE CLAMP IS ON THE TEXT, not on the button: on a padded box, three lines clamped show the top of
                  // the fourth in the padding below them.
                  <span className="m-links-address">{i18n._(LINKS_EXTERNAL, { uri: link.uri })}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.kind === 'links' && state.truncated ? <p className="m-links-empty">{i18n._(LINKS_TRUNCATED)}</p> : null}
    </nav>
  );
}

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
  | {
      readonly kind: 'links';
      readonly page: number;
      /** As the contract carries them, the page layer's shape, so both hand `onFollow` one kind of link. */
      readonly links: readonly PageLinkOnPage[];
      /** Whether the host's walk stopped at its bound, which only a hostile document reaches. */
      readonly truncated: boolean;
    };
