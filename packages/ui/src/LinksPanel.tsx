import { useLingui } from '@lingui/react';
import {
  type CommandOfKind,
  type ContractClient,
  LINK_OUTLINES,
  LINK_OUTLINE_DEFAULT_COLOUR,
  type LinkOutline,
} from '@monstera/contract';
import type { DocId, DocVersion, MessageKey } from '@monstera/shared';
import { type ReactElement, useEffect, useState } from 'react';

import {
  LINKS_EMPTY,
  LINKS_EXTERNAL,
  LINKS_LABEL,
  LINKS_OUTLINE_COLOUR,
  LINKS_OUTLINE_DASHED,
  LINKS_OUTLINE_LABEL,
  LINKS_OUTLINE_NONE,
  LINKS_OUTLINE_OTHER,
  LINKS_OUTLINE_THICK,
  LINKS_OUTLINE_THIN,
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
  version,
  onFollow,
  onOutline,
}: {
  readonly client: ContractClient;
  /** `undefined` with no document open, which renders nothing. */
  readonly docId: DocId | undefined;
  /** The page the reader is on, zero-based. `undefined` with no document. */
  readonly page: number | undefined;
  /** The document's version: a change to it (an outline just set, an undo) reads the page's links again. */
  readonly version?: DocVersion | undefined;
  /** Follows a link, by its page and its place on it: the route a link pressed on the page takes too (ADR-0167). */
  readonly onFollow: (followed: FollowedLink) => void;
  /** Sets one link's outline or colour (ADR-0212), as the command that names it by place and version. */
  readonly onOutline: (command: CommandOfKind<'setLinkOutline'>) => void;
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
            ? {
                kind: 'links',
                page,
                // THE VERSION THE LIST WAS READ AT, which is what an outline change names (ADR-0212): the position it
                // sends is a position in THIS list, and a document that has moved since refuses it.
                version: answer.value.version,
                links: answer.value.items,
                truncated: answer.value.last.truncated,
              }
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
  }, [client, docId, page, version]);

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
              <span className="m-links-outline">
                <select
                  aria-label={i18n._(LINKS_OUTLINE_LABEL, { number: at + 1 })}
                  data-links-outline={String(at)}
                  value={link.outline}
                  onChange={(event) => {
                    const chosen = LINK_OUTLINES.find((outline) => outline === event.target.value);
                    if (chosen !== undefined) onOutline({ kind: 'setLinkOutline', page: state.page, index: at, outline: chosen, version: state.version });
                  }}
                >
                  {/* AS THE DOCUMENT HAS IT is shown only while it is the state, so it is a thing to leave and never one to choose. */}
                  {link.outline === 'other' ? <option value="other">{i18n._(LINKS_OUTLINE_OTHER)}</option> : null}
                  {LINK_OUTLINES.map((outline) => (
                    <option key={outline} value={outline}>
                      {i18n._(OUTLINE_NAMES[outline])}
                    </option>
                  ))}
                </select>
                <input
                  type="color"
                  aria-label={i18n._(LINKS_OUTLINE_COLOUR, { number: at + 1 })}
                  data-links-colour={String(at)}
                  value={hexOf(link.colour)}
                  onChange={(event) => {
                    const colour = rgbOf(event.target.value);
                    if (colour !== undefined) onOutline({ kind: 'setLinkOutline', page: state.page, index: at, colour, version: state.version });
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      {state.kind === 'links' && state.truncated ? <p className="m-links-empty">{i18n._(LINKS_TRUNCATED)}</p> : null}
    </nav>
  );
}

/** Each outline's name, keyed by outline so a fifth arrives owing its words. */
const OUTLINE_NAMES: Readonly<Record<LinkOutline, MessageKey>> = {
  none: LINKS_OUTLINE_NONE,
  thin: LINKS_OUTLINE_THIN,
  thick: LINKS_OUTLINE_THICK,
  dashed: LINKS_OUTLINE_DASHED,
};

/** A `/C` as the hex a colour input holds; a link whose document gives none shows the colour the writer would write. */
function hexOf(colour: readonly [number, number, number] | undefined): string {
  const shown = colour ?? LINK_OUTLINE_DEFAULT_COLOUR;
  const channel = (value: number): string => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0');
  return `#${channel(shown[0])}${channel(shown[1])}${channel(shown[2])}`;
}

/** A colour input's hex as the contract's RGB, or nothing for a value that is not six hex digits. */
function rgbOf(hex: string): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(hex);
  if (match === null) return undefined;
  const [, r = '0', g = '0', b = '0'] = match;
  return [parseInt(r, 16) / 255, parseInt(g, 16) / 255, parseInt(b, 16) / 255];
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
      /** The version the links were read at. */
      readonly version: DocVersion;
      /** As the contract carries them, the page layer's shape, so both hand `onFollow` one kind of link. */
      readonly links: readonly PageLinkOnPage[];
      /** Whether the host's walk stopped at its bound, which only a hostile document reaches. */
      readonly truncated: boolean;
    };
