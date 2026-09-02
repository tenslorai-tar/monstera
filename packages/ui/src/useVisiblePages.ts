import { type RefCallback, useCallback, useEffect, useRef, useState } from 'react';

import { FIRST_PAGE } from './pageNumbering.js';

/**
 * Which pages are near enough to a scroller to be worth rendering.
 *
 * ## ONE mechanism, two surfaces, and that is the point of extracting it
 *
 * The page spine and the thumbnail sidebar both want *the pages near this
 * container's viewport*, and they are different containers — one cannot literally
 * share the other's observer, because an `IntersectionObserver` is bound to a
 * root. What they can share is the **answer to the question**, which is this
 * hook. A second bespoke copy in the sidebar would be a second opinion about
 * what *near the viewport* means, and the two would drift on the margin, on the
 * teardown, and on the three-state edge below (B3a).
 *
 * ## Why an observer and not a scroll handler
 *
 * A scroll handler runs on the main thread at the frequency the reader scrolls
 * and then works out what is visible from geometry it reads back — a layout read
 * per event, in the frame already trying to draw. An observer is told by the
 * browser, off that path.
 *
 * ## The first page is seeded VISIBLE, and that is not an optimisation
 *
 * happy-dom fires no intersections and a real browser fires none until layout
 * settles, so a list that started with nothing visible would draw nothing on the
 * first frame in both. Seeding the first page means a document shows something
 * immediately and the observer confirms it rather than contradicting it.
 */
export function useVisiblePages(margin: string): {
  /** The pages currently within `margin` of the container's viewport. */
  readonly visible: ReadonlySet<number>;
  /** Attach to each page's element. Takes the page number. */
  readonly slotRef: (page: number) => RefCallback<HTMLElement>;
  /**
   * The element for a page, or `undefined` if it is not mounted.
   *
   * **A reader and not the ref object**, and that is a correction rather than a
   * preference: handing out the ref made every caller's `useCallback` depend on
   * it, and the React compiler refused to preserve their memoization because a
   * ref in a dependency list is a value it cannot reason about. A stable
   * function has none of that, and it also stops a caller mutating the map.
   */
  readonly slotFor: (page: number) => HTMLElement | undefined;
} {
  const slots = useRef(new Map<number, HTMLElement>());
  const observer = useRef<IntersectionObserver | null>(null);
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set([FIRST_PAGE.kernel]));

  /**
   * A callback ref per page.
   *
   * React calls it with `null` on unmount, which is the one moment the observer
   * must stop watching an element that no longer exists — an observer holding
   * elements from a closed document keeps them alive and reports intersections
   * for pages nothing will draw.
   */
  const slotRef = useCallback((page: number): RefCallback<HTMLElement> => {
    return (element: HTMLElement | null): void => {
      const known = slots.current.get(page);
      if (known !== undefined && observer.current !== null) observer.current.unobserve(known);
      if (element === null) {
        slots.current.delete(page);
        return;
      }
      slots.current.set(page, element);
      element.dataset['page'] = String(page);
      if (observer.current !== null) observer.current.observe(element);
    };
  }, []);

  useEffect(() => {
    const seen = new IntersectionObserver(
      (entries) => {
        setVisible((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const page = Number(
              entry.target instanceof HTMLElement ? (entry.target.dataset['page'] ?? '-1') : '-1',
            );
            if (!Number.isInteger(page) || page < 0) continue;
            if (entry.isIntersecting) next.add(page);
            else next.delete(page);
          }
          return next;
        });
      },
      { rootMargin: margin },
    );
    observer.current = seen;
    // ELEMENTS THAT ALREADY EXIST, because the refs run before this effect on
    // the first render: an observer that only watched what arrived after it
    // would never see the pages the first paint laid out.
    for (const element of slots.current.values()) seen.observe(element);

    return (): void => {
      seen.disconnect();
      observer.current = null;
    };
  }, [margin]);

  const slotFor = useCallback((page: number): HTMLElement | undefined => {
    return slots.current.get(page);
  }, []);

  return { visible, slotRef, slotFor };
}
