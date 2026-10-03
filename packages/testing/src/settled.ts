import { type Page, expect } from '@playwright/test';

/**
 * Waits until what a rendered case is about to measure has STOPPED CHANGING and means what the case asks, then answers
 * that reading.
 *
 * A wait on an element's presence answers *something exists*; a capture or a measurement needs *the layout it is about
 * is the one on screen*. The two differ whenever the element was already there before the action under test — a
 * canvas drawn at the previous card size, a dialog whose title arrives before its lazy body — and then the wait passes
 * at once and the reading is of the old state. Measured on CI at 6b7a6bd9: Organize's Full page read its first card at
 * 143 px, a thumbnail, because the canvas it waited on had been drawn before the click.
 *
 * So the reading is taken twice, two animation frames apart, and accepted only when both agree and `ready` holds of it.
 * Two frames rather than one because a ResizeObserver callback lands in the frame after the layout that triggered it,
 * and the second frame is the one that shows its effect. Polled with the expectation's own timeout: nothing here sets
 * a longer one, because a state that never settles is the finding.
 */
export async function settled<T>(page: Page, read: () => Promise<T>, ready: (value: T) => boolean, what: string): Promise<T> {
  let last: T | undefined;
  const settling = expect
    .poll(
      async () => {
        const first = await read();
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  resolve();
                });
              });
            }),
        );
        const second = await read();
        last = second;
        return JSON.stringify(first) === JSON.stringify(second) && ready(second);
      },
      { message: `${what} never settled` },
    )
    .toBe(true);
  try {
    await settling;
  } catch (error) {
    // THE LAST READING, which is the evidence of what it was doing instead of settling.
    throw new Error(`${what} never settled; last read ${JSON.stringify(last)}`, { cause: error });
  }
  if (last === undefined) throw new Error(`${what} was never read`);
  return last;
}
