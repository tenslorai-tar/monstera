import { useLingui } from '@lingui/react';
import type { ReactElement } from 'react';

import { type OverlayPage, engineBoxOnScreen } from './annotations/annotationSpace.js';
import { LINK_ON_PAGE_TO_ADDRESS, LINK_ON_PAGE_TO_PAGE } from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';
import { Tooltip } from './primitives/Tooltip.js';
import type { PageLinkOnPage } from './usePageLinks.js';

/** The longest address the hover says whole, in characters as a person counts them. Past it the end is cut. */
export const HOVER_ADDRESS_MAX = 120;

/** Characters as a person counts them: an accented letter or a joined emoji is one, however many code points it is. */
const CHARACTERS = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * An address as the hover says it: whole up to {@link HOVER_ADDRESS_MAX}, then cut at the END with an ellipsis. The
 * start is the scheme and the host, which is what a person reads to decide, and the dialog a press opens shows the
 * address whole. Cut between characters, so neither half of a surrogate pair nor part of a joined character is left.
 */
export function hoverAddress(uri: string): string {
  const characters = Array.from(CHARACTERS.segment(uri), (piece) => piece.segment);
  return characters.length <= HOVER_ADDRESS_MAX ? uri : `${characters.slice(0, HOVER_ADDRESS_MAX - 1).join('')}…`;
}

/** A link a person asked to follow: the page it is on, its place among that page's links, and what it is. */
export interface FollowedLink {
  readonly page: number;
  readonly index: number;
  readonly link: PageLinkOnPage;
}

/**
 * A page's links, drawn where they are (ADR-0167 Decision 1).
 *
 * ## A button per link, and that is what a link IS here
 *
 * A link was nothing on the page: its rectangle is in the document, PDF.js draws no mark for it, and the renderer read
 * links only for a panel. So each one is a button over its rectangle, named with where it goes — a page, or an
 * address — and saying so under the pointer, which is the hover the owner asked for (item 14c). Pressing it follows
 * it, through `onFollow`: a page link goes there, and a web link asks first, which is `followLink`'s and not this
 * layer's, so the panel and the page take one route.
 *
 * ## Outlined only while the document is being edited for comments
 *
 * `outlined` draws each link's edge, for the Comment section, where links are made. Reading, the pointer over a link
 * is a hand and a tooltip, and nothing else marks the page.
 *
 * ## Under the drawing tools
 *
 * It sits below the annotation overlay, which is mounted only while a tool is on: a press then draws, as it should,
 * and with no tool on it follows the link. The layer itself takes no pointer; only the links do.
 */
export function LinkLayer({
  page,
  links,
  geometry,
  outlined,
  onFollow,
}: {
  readonly page: number;
  readonly links: readonly PageLinkOnPage[];
  readonly geometry: OverlayPage;
  readonly outlined: boolean;
  readonly onFollow: (followed: FollowedLink) => void;
}): ReactElement | null {
  const { i18n } = useLingui();
  // NOTHING OVER A PAGE WITH NO LINKS, `TextLayer`'s rule: an empty layer is something that can go wrong silently.
  if (links.length === 0) return null;
  return (
    <div className={outlined ? 'm-link-layer m-link-layer--outlined' : 'm-link-layer'} data-link-layer={String(page)}>
      {links.map((link, index) => {
        const box = engineBoxOnScreen(link.bounds, geometry);
        const values =
          link.kind === 'internal' ? { page: pdfjsPageOf(link.page) } : { address: hoverAddress(link.uri) };
        const label = link.kind === 'internal' ? LINK_ON_PAGE_TO_PAGE : LINK_ON_PAGE_TO_ADDRESS;
        return (
          // THE PLACE IS THE KEY AND THE IDENTITY: a page's links have no other, and the place is how `main` finds the
          // one to open (`document.openLink`).
          <Tooltip key={index} label={label} values={values}>
            <button
              aria-label={i18n._(label, values)}
              className="m-page-link"
              data-page-link={String(index)}
              onClick={() => {
                onFollow({ page, index, link });
              }}
              style={{
                left: `${String(box.left)}px`,
                top: `${String(box.top)}px`,
                width: `${String(box.width)}px`,
                height: `${String(box.height)}px`,
              }}
              type="button"
            />
          </Tooltip>
        );
      })}
    </div>
  );
}
