import { type Page, expect } from '@playwright/test';

/**
 * Waits until the opened document is DRAWN: the page and its thumbnail each hold a canvas. The ONE statement of when a
 * window with a document open is ready to capture; every visual case that opens one takes it from here.
 *
 * Measured 2026-09-15, three zero-tolerance comparisons of one build: the first
 * matched all 33 images, the second failed two and the third one — `dark-section-comment`
 * at 0.42 of its pixels, whose received image held no page, no thumbnail and a status
 * bar still laying out. Playwright's stability rule is *two consecutive identical
 * frames*, and a document that has not started drawing is two identical frames. So
 * readiness is asserted on the thing that is late, never on how long to wait.
 *
 * And measured again 2026-10-31, by a case that had not taken this wait: the assistant pane's History, captured as
 * `.m-context-panel`, came back 340 by 696 against its 340 by 660 baseline on CI's Windows leg (run 41207675823). The
 * status bar is 36 tall (`--status-bar`) and mounts only once PDF.js reports the page count (`App.tsx`), so a capture
 * taken before then gives its height to the panel. Six rounds of that case's steps on a CPU slowed eight times: with
 * this wait, a status bar and 660 in all six; without it, no status bar in five and 696 in one.
 */
export async function documentDrawn(page: Page): Promise<void> {
  await expect.poll(() => page.locator('canvas:visible').count()).toBeGreaterThanOrEqual(2);
}
