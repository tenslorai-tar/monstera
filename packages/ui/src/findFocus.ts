/**
 * Ctrl+F's request for the find field's focus, held until the field takes it.
 *
 * The command showed the Search panel and focused the field one animation frame later, by a selector. Under load React
 * commits the panel after that frame, so the lookup found no field and did nothing, and the words typed next went
 * nowhere — measured: `pagesInUse.pw.ts`' query, typed straight after Ctrl+F, searched no page on the Windows leg of
 * the board at 45bd4554. Held as a request instead, the field takes it in the layout effect of the render that shows
 * it: for a key press React renders synchronously, before the next key event is handled, so no key is typed before
 * the field has the focus.
 */

let pending = false;
const listeners = new Set<() => void>();

export const findFocus = {
  /** Ctrl+F: the find field takes the focus when it next renders, or now if it is shown. */
  request: (): void => {
    pending = true;
    for (const listener of listeners) listener();
  },
  /** Whether a request waits: the field's `useSyncExternalStore` snapshot. */
  getSnapshot: (): boolean => pending,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** The field took the focus: the request is spent, so a later render of the panel takes none. */
  taken: (): void => {
    pending = false;
  },
};
