import { useLingui } from '@lingui/react';
import { type ReactElement, useState } from 'react';
import type React from 'react';

import { LINK_OUTLINE_DEFAULT_COLOUR } from '@monstera/contract';

import { type OverlayPage, engineBoxOnScreen } from './annotations/annotationSpace.js';
import { LINK_ON_PAGE_TO_ADDRESS, LINK_ON_PAGE_TO_ADDRESS_CTRL, LINK_ON_PAGE_TO_PAGE, LINK_ON_PAGE_TO_PAGE_CTRL } from './messages/en.js';
import { pdfjsPageOf } from './pageNumbering.js';
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
          // one to open (`document.openLink`). Its hover is the page slot's (`useLinkPointer`), which sees the pointer
          // whatever layer is on top; the button is the link for the keyboard and for a reader of the page.
          <button
            aria-label={i18n._(label, values)}
            className="m-page-link"
            data-page-link={String(index)}
            key={index}
            onClick={() => {
              onFollow({ page, index, link });
            }}
            style={{
              left: `${String(box.left)}px`,
              top: `${String(box.top)}px`,
              width: `${String(box.width)}px`,
              height: `${String(box.height)}px`,
              // ITS EDGE IN ITS OWN COLOUR, the one the Links list's swatch shows (the owner's E1: the page drew every
              // link in the accent's green while the list said blue). The writer's colour where the document gives none.
              '--m-link-colour': cssColourOf(link.colour ?? LINK_OUTLINE_DEFAULT_COLOUR),
            } as React.CSSProperties}
            type="button"
          />
        );
      })}
    </div>
  );
}

/** A link's `/C`, channels 0 to 1, as a CSS colour. */
function cssColourOf(colour: readonly [number, number, number]): string {
  const channel = (value: number): string => String(Math.round(Math.min(1, Math.max(0, value)) * 255));
  return `rgb(${channel(colour[0])} ${channel(colour[1])} ${channel(colour[2])})`;
}

/** What a page slot spreads on its element, and the hover it draws inside it. */
export interface LinkPointer {
  readonly props: Pick<
    React.HTMLAttributes<HTMLDivElement>,
    'onPointerMoveCapture' | 'onPointerLeave' | 'onPointerDownCapture' | 'onMouseDownCapture' | 'onClickCapture'
  > & { readonly 'data-over-link'?: '' };
  readonly hover: ReactElement | null;
}

/**
 * A page's links under the pointer IN EVERY TOOL (the owner's E1, 2026-10-14, by the reviewer's decision, the convention
 * of widely used PDF editors and Word): a hand, and a hover saying where the link goes; a plain click follows it where the
 * page is being read, and where a click is a tool's (Select, the link tools, a drawing tool, a mode) Ctrl+click does.
 *
 * ## On the page slot, in the capture phase
 *
 * The links' buttons sit under the drawing overlay, which every tool mounts and which then takes every press: in the
 * Comment section with Select on, and in Home with a tool left on, the pointer stayed an arrow and no click reached a
 * link (measured in the shim, `linkPointer.pw.ts`). So the slot asks where the pointer is against the links' boxes
 * before any layer sees the event, the one place that hears it whatever is on top. A click it follows is stopped there,
 * so the button under it does not follow it a second time and a tool does not also select or draw.
 *
 * A KEY'S CLICK (`detail` 0) is let through: the focused button is the link, and it follows itself.
 *
 * @param clickFollows whether a plain click follows a link here: true where the page is being read
 */
export function useLinkPointer(
  page: number,
  links: readonly PageLinkOnPage[] | undefined,
  geometry: OverlayPage | undefined,
  clickFollows: boolean,
  onFollow: ((followed: FollowedLink) => void) | undefined,
): LinkPointer {
  const { i18n } = useLingui();
  const [hovered, setHovered] = useState<number | undefined>(undefined);
  if (links === undefined || links.length === 0 || geometry === undefined || onFollow === undefined) {
    return { props: {}, hover: null };
  }
  const boxes = links.map((link) => engineBoxOnScreen(link.bounds, geometry));
  /** The link under a pointer event, by its place on the page, or `undefined`. */
  const under = (event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>): number | undefined => {
    const slot = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - slot.left;
    const y = event.clientY - slot.top;
    const at = boxes.findIndex((box) => x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height);
    return at === -1 ? undefined : at;
  };
  const follows = (event: React.MouseEvent<HTMLDivElement>): boolean => clickFollows || event.ctrlKey || event.metaKey;
  const link = hovered === undefined ? undefined : links[hovered];
  const box = hovered === undefined ? undefined : boxes[hovered];
  let hover: ReactElement | null = null;
  if (link !== undefined && box !== undefined) {
    const values = link.kind === 'internal' ? { page: pdfjsPageOf(link.page) } : { address: hoverAddress(link.uri) };
    const label =
      link.kind === 'internal'
        ? clickFollows
          ? LINK_ON_PAGE_TO_PAGE
          : LINK_ON_PAGE_TO_PAGE_CTRL
        : clickFollows
          ? LINK_ON_PAGE_TO_ADDRESS
          : LINK_ON_PAGE_TO_ADDRESS_CTRL;
    hover = (
      <div
        className="m-tooltip m-link-hover"
        data-link-hover={String(hovered)}
        role="tooltip"
        style={{ left: `${String(box.left)}px`, top: `${String(box.top + box.height)}px` }}
      >
        {i18n._(label, values)}
      </div>
    );
  }
  return {
    props: {
      ...(hovered === undefined ? {} : { 'data-over-link': '' as const }),
      onPointerMoveCapture: (event) => {
        const at = under(event);
        if (at !== hovered) setHovered(at);
      },
      onPointerLeave: () => {
        setHovered(undefined);
      },
      onPointerDownCapture: (event) => {
        // A PRESS THAT WILL FOLLOW starts nothing else: no text selection, no pan, no shape, no pick.
        if (under(event) !== undefined && follows(event)) event.stopPropagation();
      },
      // AND NO TEXT SELECTION, which the browser starts on the mouse's own press whatever the pointer's did.
      onMouseDownCapture: (event) => {
        if (under(event) !== undefined && follows(event)) event.preventDefault();
      },
      onClickCapture: (event) => {
        if (event.detail === 0) return;
        const at = under(event);
        const followed = at === undefined ? undefined : links[at];
        if (at === undefined || followed === undefined || !follows(event)) return;
        event.preventDefault();
        event.stopPropagation();
        onFollow({ page, index: at, link: followed });
      },
    },
    hover,
  };
}
