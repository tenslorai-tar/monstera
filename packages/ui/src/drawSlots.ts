/**
 * How many page draws the renderer runs at once (the owner's run 4 item 13d: *"a cap on concurrent render and
 * thumbnail work"*, after a widely used PDF editor's documented model). Every draw — the reading list's pages, the thumbnail strip,
 * Compare and the loupe — goes through `renderPage`, which takes a slot here for the length of the draw, so the cap is
 * one number for all of them (B3a).
 *
 * WHY IT BOUNDS MEMORY: each draw holds a full-size scratch canvas and the page's decoded images until it presents, so
 * twenty pages arriving at once (a scroll, a zoom, a strip opening) held twenty of each at the peak. Two is the owner's
 * low-end machine's core count; a draw waiting for a slot holds nothing.
 */
export const MAX_DRAWS = 2;

let running = 0;
const waiting: (() => void)[] = [];

/**
 * Runs `draw` once a slot is free, and frees it when the draw ends however it ends. A draw superseded while it waits
 * never runs: it is answered `null`, which the caller turns into its own cancellation.
 */
export async function withDrawSlot<T>(signal: AbortSignal, draw: () => Promise<T>): Promise<T | null> {
  if (running >= MAX_DRAWS) {
    const admitted = await new Promise<boolean>((resolve) => {
      const admit = (): void => {
        signal.removeEventListener('abort', give);
        resolve(true);
      };
      const give = (): void => {
        const at = waiting.indexOf(admit);
        if (at >= 0) waiting.splice(at, 1);
        resolve(false);
      };
      waiting.push(admit);
      signal.addEventListener('abort', give, { once: true });
    });
    if (!admitted) return null;
  } else {
    running += 1;
  }
  // A SLOT IS HELD HERE: taken above, or handed over by the draw that freed it (`next`), which did not decrement.
  try {
    if (signal.aborted) return null;
    return await draw();
  } finally {
    const next = waiting.shift();
    if (next === undefined) running -= 1;
    else next();
  }
}

/** The draws running and waiting now, for a case that must see the cap hold. */
export function drawSlotsInUse(): { readonly running: number; readonly waiting: number } {
  return { running, waiting: waiting.length };
}
