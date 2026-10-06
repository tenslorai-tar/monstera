import { type Locator, type Page, expect } from '@playwright/test';

/**
 * Waits until the application is drawn and hears its keys: the start screen's footer, which names F1.
 *
 * The keys are heard by a listener the application attaches in an effect of its first commit (`useShortcuts`), and a
 * press sent straight after `goto` can reach the page before the bundle has mounted at all — then the key is lost and
 * the dialog it opens is "not found", which reads as a broken dialog rather than an early key. Measured on CI's Windows
 * leg on 2026-10-03 (run 37110797082): F1 straight after `goto`, and no Help centre within five seconds, where the
 * same press after this wait passed in the same run.
 */
export async function startScreenListening(page: Page): Promise<void> {
  await expect(page.locator('.m-start-footer')).toContainText('Press F1 for help');
}

/**
 * Waits until the page pane has shown its first frame.
 *
 * Until then its children are `visibility: hidden` (`app.css`, `.m-page-pane[data-first-frame='pending']`) while the
 * pages are laid out and drawn, but the text layer's lines are already mounted. A wait on those lines' count or text
 * does not need visibility, so it passes over a pane a person cannot see, and a press or a drag then lands on the
 * loading state (the sweep of 2026-10-03, its M2).
 */
export async function pageShown(page: Page): Promise<void> {
  await expect(page.locator('.m-page-pane[data-first-frame="shown"]').first()).toBeAttached();
}

/**
 * Waits until a Base UI menu has decided whether the focus a test moved out of its trigger left the menu.
 *
 * Base UI 1.7.0 decides it on a `setTimeout(0)` after the trigger's blur, against the trigger's OWN popup
 * (`floating-ui-react/hooks/useFocus.mjs`, `onBlur`), and Chromium runs input ahead of timers. So a key sent straight
 * after `locator.focus()` on an item can open that item's submenu and move the focus into it before the check runs;
 * the check then finds the focus in the submenu's popup, which is portalled outside the parent's, and closes the whole
 * menu. Measured 2026-10-04 at 760 × 560, *More* then *Tools*: 8 of 60 back-to-back rounds closed, every one for
 * `trigger-focus` on the trigger's `focusout`, 30 to 60 ms after the submenu had the focus.
 *
 * A `setTimeout(0)` started after the blur runs after that check, since timers of equal delay run in the order they
 * were started (the HTML standard's timer initialisation steps), so this resolves once the decision is made.
 */
export async function focusSettled(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  }));
}

/**
 * Waits until a Base UI popup (a menu, a tooltip, a select's list) has been PLACED, and answers its box.
 *
 * Before it is placed, its positioner sits at the window's top left with an inline `opacity: 0`
 * (`@base-ui/react/internals/useAnchorPositioning.js`), and Playwright counts opacity 0 as visible — so a box read
 * once the popup is "visible" can be the unplaced one, and a case asking whether a menu fits the window passes on a
 * box at the origin. This waits for no ancestor of the popup to carry that opacity and for the box to settle.
 */
export async function popupPlaced(page: Page, popup: Locator, what: string): Promise<{ x: number; y: number; width: number; height: number }> {
  return settled(
    page,
    () =>
      popup.evaluate((element) => {
        let node: HTMLElement | null = element instanceof HTMLElement ? element : null;
        let hidden = false;
        while (node !== null) {
          if (node.style.opacity === '0') hidden = true;
          node = node.parentElement;
        }
        const box = element.getBoundingClientRect();
        return { hidden, x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    (now) => !now.hidden && now.width > 0,
    what,
  ).then(({ x, y, width, height }) => ({ x, y, width, height }));
}

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
