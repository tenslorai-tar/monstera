import { type RefObject, useEffect, useState } from 'react';

/**
 * The pages, inside `within`, whose text layer holds an end of the document's selection.
 *
 * ## Why a page with a selection in it is wanted when it is off screen
 *
 * A text layer is mounted for the pages near the view, and a selection's two ends are nodes inside those layers. A
 * drag that scrolls the view carries the page it began on out of that set, its layer unmounts, and the browser moves
 * the selection's end to the slot the layer was in — so the selection then ran from the next page's top, or collapsed
 * (measured 2026-10-03, N7). A page holding an end stays wanted until the selection leaves it, which is one page or
 * two, so what is held stays bounded.
 *
 * Read on `selectionchange`, which the browser fires through a drag, and only for layers inside `within`: Side by
 * Side mounts two lists over the same page numbers, and a selection in one must not hold a page in the other.
 *
 * @param within the element the page list's layers are in
 */
export function useSelectedTextPages(within: RefObject<HTMLElement | null>): ReadonlySet<number> {
  const [pages, setPages] = useState<ReadonlySet<number>>(NONE);

  useEffect(() => {
    const owner = within.current?.ownerDocument ?? globalThis.document;
    const read = (): void => {
      const root = within.current;
      const selection = owner.getSelection();
      const found = new Set<number>();
      if (root !== null && selection !== null && selection.rangeCount > 0) {
        for (const node of [selection.anchorNode, selection.focusNode]) {
          const element = node instanceof Element ? node : (node?.parentElement ?? null);
          const layer = element?.closest('[data-text-layer]') ?? null;
          if (layer !== null && root.contains(layer)) found.add(Number(layer.getAttribute('data-text-layer')));
        }
      }
      // THE SAME SET IS THE SAME STATE, so a drag within one page re-renders nothing.
      setPages((previous) =>
        previous.size === found.size && [...found].every((page) => previous.has(page)) ? previous : found.size === 0 ? NONE : found,
      );
    };
    owner.addEventListener('selectionchange', read);
    return (): void => {
      owner.removeEventListener('selectionchange', read);
    };
  }, [within]);

  return pages;
}

const NONE: ReadonlySet<number> = new Set();
