import { useCallback, useRef } from 'react';

/**
 * How near the end a list may be scrolled and still count as AT it, in CSS pixels: a scroll position is fractional
 * at a fractional zoom, and a list scrolled to its end can read a fraction short.
 */
const END_SLACK = 1;

/**
 * A SCROLLING LIST THAT IS AT ITS END STAYS AT ITS END WHEN ITS OWN HEIGHT CHANGES; one the person has scrolled up
 * stays where they put it. Returns a ref callback for the scrolling element.
 *
 * ## The mechanism
 *
 * When a scrolling box gets shorter, the browser keeps its `scrollTop`, so what was at the bottom edge goes out of
 * view below it. Anything can shorten the box: the status bar arriving once a document's pages are known (36 px,
 * measured 2026-10-31 by the assistant pane's visual case, whose conversation lost its last turn's buttons), a window
 * resize, a panel opening below. So the rule keys on the box's own height, never on any one of those causes.
 *
 * Whether the list is at its end is read at each scroll, which is the person's own act, and when the box is first
 * attached; a `ResizeObserver` on the box then puts a list that was at its end back there. Content that grows does not
 * fire it, so an answer streaming in is not followed by this rule, which is about the box and not its contents.
 */
export function useEndKept(): (element: HTMLElement | null) => void {
  const detach = useRef<(() => void) | null>(null);
  return useCallback((element: HTMLElement | null) => {
    detach.current?.();
    detach.current = null;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const atEnd = (): boolean => element.scrollHeight - element.scrollTop - element.clientHeight <= END_SLACK;
    let wasAtEnd = atEnd();
    const scrolled = (): void => {
      wasAtEnd = atEnd();
    };
    const resized = new ResizeObserver(() => {
      if (wasAtEnd) element.scrollTop = element.scrollHeight;
      wasAtEnd = atEnd();
    });
    element.addEventListener('scroll', scrolled, { passive: true });
    resized.observe(element);
    detach.current = () => {
      element.removeEventListener('scroll', scrolled);
      resized.disconnect();
    };
  }, []);
}
