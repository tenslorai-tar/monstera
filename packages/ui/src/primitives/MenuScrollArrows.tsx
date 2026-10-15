import { type ReactElement, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';

import { motionReduced } from '../settings/appearance.js';
import { Icon } from './Icon.js';

/**
 * A menu's items between two arrows that say there is more (the owner's E3): an up arrow at the top while items lie above
 * what is shown, a down arrow at the foot while items lie below, each gone when its end is reached. A press on one
 * scrolls the menu by most of its height; resting the pointer on one scrolls it while it rests.
 *
 * ## One component, inside every menu that can scroll
 *
 * The menu bar's menus, its submenus and folded menus, and the right-click menus all take it (B3a): an arrow that two
 * menus drew their own way would be two answers to *is there more?*. It is placed as the popup's children, so the popup
 * — the scroll container every menu already is (`.m-context-menu`) — is the element it reads and scrolls.
 *
 * ## What it is not
 *
 * Not a control a keyboard reaches, and hidden from assistive technology: a person on the keyboard moves through the
 * items, and focus scrolls the item it lands on into view, clear of the arrows (`scroll-padding-block`). Not a layout
 * change: each arrow takes no room in the column (`.m-menu-arrow`), so a menu that does not scroll is laid out exactly
 * as it was and shows neither. An arrow appears and goes without a transition, and a press's scroll is instant.
 *
 * ## Resting is motion, and reduced motion stops it
 *
 * A pointer resting on an arrow scrolls the menu every frame, which is movement a person did not press for. So when
 * movement is reduced (`motionReduced`: the setting or Windows), resting scrolls nothing and a press still pages, which
 * is the one way to reach the rest of the menu that moves only when asked.
 */
export function MenuScrollArrows({ children }: { readonly children: ReactNode }): ReactElement {
  const top = useRef<HTMLSpanElement>(null);
  const [ends, setEnds] = useState<{ readonly above: boolean; readonly below: boolean }>({ above: false, below: false });
  const resting = useRef<number | undefined>(undefined);

  const menuOf = useCallback((): HTMLElement | null => top.current?.parentElement ?? null, []);

  useLayoutEffect(() => {
    const menu = menuOf();
    if (menu === null) return undefined;
    const read = (): void => {
      const above = menu.scrollTop > 1;
      const below = menu.scrollTop + menu.clientHeight < menu.scrollHeight - 1;
      setEnds((current) => (current.above === above && current.below === below ? current : { above, below }));
    };
    read();
    menu.addEventListener('scroll', read, { passive: true });
    const sized = new ResizeObserver(read);
    sized.observe(menu);
    return (): void => {
      menu.removeEventListener('scroll', read);
      sized.disconnect();
      if (resting.current !== undefined) cancelAnimationFrame(resting.current);
    };
  }, [menuOf]);

  /** Scrolls by most of the menu's height, the way a page key does. */
  const page = (direction: -1 | 1): void => {
    const menu = menuOf();
    if (menu === null) return;
    menu.scrollBy({ top: direction * Math.max(1, menu.clientHeight * 0.8), behavior: 'instant' });
  };
  /** Scrolls a little every frame while the pointer rests on an arrow, unless movement is reduced. */
  const rest = (direction: -1 | 1): void => {
    if (motionReduced(document.documentElement)) return;
    const step = (): void => {
      menuOf()?.scrollBy({ top: direction * REST_STEP, behavior: 'instant' });
      resting.current = requestAnimationFrame(step);
    };
    resting.current = requestAnimationFrame(step);
  };
  const leave = (): void => {
    if (resting.current !== undefined) cancelAnimationFrame(resting.current);
    resting.current = undefined;
  };

  const arrow = (direction: -1 | 1, shown: boolean, ref?: React.RefObject<HTMLSpanElement | null>): ReactElement => (
    <span
      ref={ref}
      aria-hidden="true"
      className={direction === -1 ? 'm-menu-arrow m-menu-arrow--up' : 'm-menu-arrow m-menu-arrow--down'}
      data-menu-arrow={direction === -1 ? 'up' : 'down'}
      data-shown={shown ? 'true' : 'false'}
      onClick={(event) => {
        // NOT A PRESS ON THE MENU: an arrow scrolls and nothing else, so the click goes no further.
        event.preventDefault();
        event.stopPropagation();
        page(direction);
      }}
      onPointerEnter={() => {
        rest(direction);
      }}
      onPointerLeave={leave}
    >
      <Icon name={direction === -1 ? 'ChevronUp' : 'ChevronDown'} size="dense" />
    </span>
  );

  return (
    <>
      {arrow(-1, ends.above, top)}
      {children}
      {arrow(1, ends.below)}
    </>
  );
}

/** How far a resting pointer scrolls each frame, in CSS pixels: an item every five frames or so. */
const REST_STEP = 6;
