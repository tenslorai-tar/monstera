import { type Page, expect, test } from '@playwright/test';

import { bridge } from './pageBridge.js';

/**
 * The command palette closes by every route, from every place focus can be — in a real browser.
 *
 * ## Why this is a Playwright run and not another unit case
 *
 * The palette would not close in a live session on 2026-09-17, and its unit cases were green throughout: they fired
 * a key AT an element the case chose, and happy-dom moves focus on no click. Where focus goes when a person clicks is
 * the browser's answer, not the component's, so these cases click where a person clicks and press keys through the
 * keyboard, and assert on whether the palette is there — never on where the case put focus itself.
 *
 * Each case carries its own control: the palette is asserted OPEN after the click and before the key, so a route that
 * closed on the click cannot pass as one that closed on the key. Studio's overlay has its cases beside its own in
 * `renderedScreen.pw.ts`, which already opens a document for it.
 */

const PALETTE = '.m-palette';

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+K');
  await expect(page.locator(PALETTE)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await bridge(page);
  await page.goto('/');
  await expect(page.locator('.m-title-bar')).toBeVisible();
});

test('Escape where focus LANDS on open — the query field', async ({ page }) => {
  await openPalette(page);
  await expect(page.locator('.m-palette-query')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator(PALETTE)).toHaveCount(0);
});

test('Escape after a click on the palette’s HEADER', async ({ page }) => {
  await openPalette(page);
  await page.locator(`${PALETTE} .m-dialog__title`).click();
  await expect(page.locator(PALETTE)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(PALETTE)).toHaveCount(0);
});

test('Escape from wherever TAB takes focus inside it — a control whose tooltip opens takes one first', async ({
  page,
}) => {
  await openPalette(page);
  // THE PRECONDITION IS ASSERTED, because it was only assumed. `openPalette` waits for the palette
  // to be VISIBLE; where focus is at that moment is a separate fact, and this case moves focus with
  // Tab and then asks where it went. Without the line below it is measuring the landing AND the
  // trap at once, and a failure cannot say which.
  //
  // The landing place is the first case's claim; this one is about the trap.
  await expect(page.locator('.m-palette-query')).toBeFocused();
  await page.keyboard.press('Tab');
  // WHEREVER Tab took it, it is inside the palette OR inside the layer the palette's own focused
  // control opened — which is the promise a LAYERED trap makes, and the narrower `contains(.m-palette)`
  // was a statement about DOM position rather than about focus escaping. A tooltip is portaled out
  // of the dialog's subtree, so the narrow test calls a correctly trapped focus an escape the moment
  // the popup rather than its trigger holds it.
  //
  // AND THE FAILURE NAMES WHAT IT FOUND. The CI logs need owner authentication, so a bare `false`
  // there is unreadable from this seat — this carries the tag, the class and both containments into
  // the annotation, which is public.
  //
  // IT WAITS FOR FOCUS TO SETTLE, because focus is legitimately IN TRANSIT for one frame, and that
  // is what failed on CI three times. The annotation of 2026-09-23 named the element: a `SPAN` with
  // no class, in neither the palette nor a tooltip. It is the trap's own after-guard. The query is
  // the palette's LAST tabbable (the results are options, not tab stops), so Tab lands on Base UI's
  // `FocusGuard`, whose `onFocus` moves focus to the first tabbable through `enqueueFocus` — on the
  // next ANIMATION FRAME (`@base-ui/react` 1.7.0, `floating-ui-react/utils/enqueueFocus.mjs`). A
  // read taken before that frame sees the guard; a loaded CI runner takes it before, this machine
  // after, which is why it passed here every time. REPRODUCED here on 2026-09-23 by delaying
  // `requestAnimationFrame` 400 ms in the page: the previous version of this case failed 3 of 3
  // with CI's exact annotation, and this one passed 3 of 3. A 20x CPU throttle did NOT reproduce
  // it — it slows the script and not the gap between the key and the frame.
  //
  // The guard is the only thing allowed to hold focus mid-flight, and it is asserted to be one — a
  // span marked `data-base-ui-focus-guard` beside the palette, under its parent — so a real escape
  // to the page below still fails, on the first read as well as the last.
  const where = (): Promise<{
    tag: string;
    className: string;
    inPalette: boolean;
    inTooltip: boolean;
    guard: boolean;
  }> =>
    page.evaluate((selector) => {
      const active = document.activeElement;
      const palette = document.querySelector(selector);
      return {
        tag: active?.tagName ?? 'none',
        className: active instanceof HTMLElement ? active.className : '',
        inPalette: palette?.contains(active) === true,
        inTooltip: [...document.querySelectorAll('.m-tooltip')].some((layer) => layer.contains(active)),
        // THE TRAP'S OWN GUARD: a focusable span Base UI renders beside the popup, under the same
        // parent, marked by `utils/FocusGuard.mjs`.
        guard:
          active instanceof HTMLSpanElement &&
          active.hasAttribute('data-base-ui-focus-guard') &&
          palette?.parentElement?.contains(active) === true,
      };
    }, PALETTE);
  const first = await where();
  expect(
    first.inPalette || first.inTooltip || first.guard,
    `focus after Tab left the palette's trap: ${JSON.stringify(first)}`,
  ).toBe(true);
  await expect
    .poll(async () => {
      const settled = await where();
      return settled.inPalette || settled.inTooltip;
    }, { message: `focus after Tab never settled inside the palette: ${JSON.stringify(await where())}` })
    .toBe(true);
  await expect(page.locator('.m-palette-query')).not.toBeFocused();

  // TAB REACHES THE CLOSE CONTROL since the results became options rather than tab stops, and
  // focusing it opens its tooltip. Escape then dismisses the TOPMOST layer — the tooltip — and the
  // next one the palette, which is what a layered surface does everywhere. Asserted rather than
  // hidden behind one key press, so a change in either layer is visible here.
  const tooltip = page.locator('.m-tooltip');
  await expect(tooltip).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
  await expect(page.locator(PALETTE)).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator(PALETTE)).toHaveCount(0);
});

test('a press OUTSIDE — on the page below it', async ({ page }) => {
  await openPalette(page);
  await page.mouse.click(640, 700);
  await expect(page.locator(PALETTE)).toHaveCount(0);
});

test('a press on the TITLE BAR — its own control is under the backdrop, and the press still closes it', async ({ page }) => {
  // MEASURED BEFORE OPENING: once the modal is up, the rest of the window is out of the accessibility tree, so the
  // control can no longer be found by its role — which is the trap working, not the control missing.
  const search = await page.locator('.m-title-bar').getByRole('button', { name: /Search commands/u }).boundingBox();
  if (search === null) throw new Error('the title bar carries the command search');
  await openPalette(page);
  await page.mouse.click(search.x + search.width / 2, search.y + search.height / 2);
  await expect(page.locator(PALETTE)).toHaveCount(0);
});

test('its own CHORD, Ctrl+K, pressed while it is open', async ({ page }) => {
  await openPalette(page);
  await page.keyboard.press('Control+K');
  await expect(page.locator(PALETTE)).toHaveCount(0);
  // CONTROL: the chord opens it again, so the line above is a toggle and not a chord that only closes.
  await openPalette(page);
});

test('its CLOSE control', async ({ page }) => {
  await openPalette(page);
  await page.locator(PALETTE).getByRole('button', { name: 'Close' }).click();
  await expect(page.locator(PALETTE)).toHaveCount(0);
});

test('draws no horizontal scrollbar — its field and rows fit the popup', async ({ page }) => {
  // Seen live 2026-09-18: 100%-wide rows under the default content box overflowed the popup by their padding.
  await openPalette(page);
  const overflow = await page.evaluate((selector) => {
    const body = document.querySelector(`${selector} .m-dialog__body`);
    return body === null ? null : body.scrollWidth - body.clientWidth;
  }, PALETTE);
  expect(overflow).toBe(0);
});
